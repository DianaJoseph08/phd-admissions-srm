// Core Client Application - PhD Admissions SPA
// Initialize Theme from LocalStorage immediately to avoid flash
(function() {
    const savedTheme = localStorage.getItem('phd_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
})();

let state = {
    token: localStorage.getItem('phd_token') || null,
    user: JSON.parse(localStorage.getItem('phd_user')) || null,
    activeTab: 'dashboard',
    candidates: [],
    selectedCandidate: null,
    transferRequests: [],
    emailLogs: [],
    analytics: null,
    activeCandidateFilter: 'Complete Applications',
    institutionsList: [], // Cached for transfers
    sortColumn: null,
    sortOrder: 'asc',
    supervisorSortColumn: 'name',
    supervisorSortOrder: 'asc',
    supervisorsList: [],
    activeUserCampus: 1,
    activeUserInst: 'admin',
    activeCandidateCampus: null,
    activeCandidateInst: null
};

// Study mode definitions (used for grouping & export)
const STUDY_MODES = [
    { key: 'fulltime_wf', label: 'Full Time — With Fellowship',        match: (m,c) => AdmissionStudyPolicy.isFullTimeWithFellowship(c || {mode_of_study:m}) },
    { key: 'fulltime_ss', label: 'Full Time — Without Fellowship / Self-supporting',        match: (m,c) => AdmissionStudyPolicy.isFullTimeWithoutFellowship(c || {mode_of_study:m}) },
    { key: 'fulltime_unspecified', label: 'Full Time — Fellowship Not Specified', match: (m,c) => AdmissionStudyPolicy.classifyStudyMode(c || {mode_of_study:m}) === 'full_time_unspecified' },
    { key: 'pte_acad',    label: 'Part Time External (academic)',      match: m => { const lower = m.toLowerCase(); return lower.includes('part time') && lower.includes('academic'); } },
    { key: 'pte_ind',     label: 'Part Time External (industry)',      match: m => { const lower = m.toLowerCase(); return lower.includes('part time') && lower.includes('industry'); } },
    { key: 'pti',         label: 'Part Time Internal',                 match: m => { const lower = m.toLowerCase(); return lower.includes('part time') && lower.includes('internal'); } },
    // Retain incomplete and unfamiliar source values in every view/export that groups by mode.
    { key: 'unclassified', label: 'Study Mode Not Provided / Other', match: (value,candidate) => !STUDY_MODES.some(mode => mode.key !== 'unclassified' && mode.match(String(value || ''),candidate)) },
];

// Workflow & Status Helper Functions
function isCandidateEligible(c) {
    if (!c) return false;
    if (c.selection_status === 'Not Selected' || c.status === 'Entrance Exam Absent') return false;
    if (['Eligible', 'Verified Eligible', 'Marks Entered', 'Entrance Exam Attended'].includes(c.status)) return true;
    // When HOD has verified eligibility and forwarded downstream to RC / Dean / Admin
    if (c.status === 'HOD Verified Eligible' && c.current_owner !== 'HOD') return true;
    if (c.status_reason === 'Eligible' && ['Under RC Review', 'Under Dean Review', 'Returned to RC', 'Returned to Dean'].includes(c.status)) return true;
    return false;
}

function isCandidateIneligible(c) {
    if (!c) return false;
    if (c.selection_status === 'Not Selected' || c.status === 'Entrance Exam Absent') return false;
    if (['Not Eligible', 'Verified Ineligible', 'Evaluated (Failed Cutoff)'].includes(c.status)) return true;
    // When HOD has verified ineligibility and forwarded downstream
    if (c.status === 'HOD Verified Ineligible' && c.current_owner !== 'HOD') return true;
    if (c.status_reason === 'Not Eligible' && ['Under RC Review', 'Under Dean Review', 'Returned to RC', 'Returned to Dean'].includes(c.status)) return true;
    return false;
}

function isCandidateRanked(c) {
    if (!c || c.status === 'Entrance Exam Absent' || c.status === 'Evaluated (Failed Cutoff)') return false;
    return Number(c.rank)>0 || ['Ranked','Ranks Released','Under Dean Review (Ranks)','Under RC Review (Ranks)','Guide Allocation Open','Guide Allocated','Selection Finalized','Under Dean Final Review','Returned to HOD (Guides)','Returned to RC (Guides)','Returned to Dean (Final)','Approved Guides'].includes(c.status);
}
function rankAwaitingAdminRelease(c) { return ['Ranked','Ranks Released','Under Dean Review (Ranks)','Under RC Review (Ranks)'].includes(c.status); }
function canAllotInterviewPanel(c) {
    return !!c && String(c.form_status||'').toLowerCase()!=='incomplete' && !['Selected','Not Selected'].includes(c.selection_status) && (['HOD Verified Eligible','Verified Eligible','Eligible','Entrance Exam Attended','Marks Entered'].includes(c.status) || c.status_reason==='Eligible' && ['Under RC Review','Under Dean Review','Returned to RC','Returned to Dean'].includes(c.status));
}
function supervisorNameKey(value) { return String(value||'').normalize('NFKC').toLowerCase().replace(/^\s*dr\.?\s*/,'').replace(/[^\p{L}\p{N}]/gu,''); }
function isFullTimeApplicant(c) { return AdmissionStudyPolicy.isFullTimeApplicant(c); }
function canSelectWithinAllotment(c) {
    c=(state.candidates||[]).find(item=>Number(item.id)===Number(c.id)) || c;
    if (c.selection_status==='Selected' || !AdmissionStudyPolicy.isFullTimeWithFellowship(c)) return true;
    const v=(state.vacancies||[]).find(v=>Number(v.department_id)===Number(c.department_id));
    return v && v.ft_allowed!=null && Number(v.ft_wf_allocated||0)<Number(v.ft_allowed);
}
function selectionLimitText(deptId) {
    const v=(state.vacancies||[]).find(v=>Number(v.department_id)===Number(deptId));
    if(!v)return 'Loading full-time with fellowship allotment…';
    return v.ft_allowed==null ? 'Full-time with fellowship allotment: not yet set by Super Admin' : 'Full-time with fellowship allotment: '+v.ft_allowed+' · Selected: '+Number(v.ft_wf_allocated||0)+' · Remaining: '+Math.max(0,Number(v.ft_allowed)-Number(v.ft_wf_allocated||0));
}

function isCandidateComplete(c) {
    if (!c) return false;
    if ((c.form_status || '').toLowerCase() === 'incomplete') return false;
    if (c.status === 'Incomplete') return false;
    if (c.status === 'Entrance Exam Absent') return false;
    if (['Selected', 'Not Selected'].includes(c.selection_status)) return false;
    if (isCandidateEligible(c) || isCandidateIneligible(c) || isCandidateRanked(c)) return false;
    return true;
}

window.isCandidateEligible = isCandidateEligible;
window.isCandidateIneligible = isCandidateIneligible;
window.isCandidateRanked = isCandidateRanked;
window.isCandidateComplete = isCandidateComplete;

// API Requester Helper
async function api(url, method = 'GET', data = null, isMultipart = false) {
    const headers = {};
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (!isMultipart) {
        headers['Content-Type'] = 'application/json';
    }

    const options = {
        method,
        headers
    };

    if (data) {
        options.body = isMultipart ? data : JSON.stringify(data);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.error || `HTTP error! status: ${response.status}`);
        error.data = err;
        throw error;
    }
    return response.json();
}

// Toast Feedback Notifications
function showToast(message, type = 'success') {
    const existing = document.querySelector('.alert-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `alert-toast ${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Excel Export Helpers (Super Admin) ──────────────────────────────────────
function exportInstitutionBreakdowns() {
    const rows = (state.analytics.institutions || []).map(i => ({
        'Campus': i.campus,
        'Faculty / Institution': i.inst_name,
        'Total Applied': i.count,
        'Eligible': i.eligible_count || 0,
        'Ineligible': i.ineligible_count || 0,
        'Present (Exam)': i.present_count || 0,
        'Absent (Exam)': i.absent_count || 0,
        'Selected (Total)': i.selected_count || 0,
        'Selected (FT-WF)': i.selected_ft_wf || 0,
        'Selected (FT-SS)': i.selected_ft_ss || 0,
        'Selected (PTE-Acad)': i.selected_pte_acad || 0,
        'Selected (PTE-Ind)': i.selected_pte_ind || 0,
        'Selected (PTI)': i.selected_pti || 0
    }));
    if (!rows.length) return showToast('No data to export.', 'error');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 36 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Institution Breakdowns');
    XLSX.writeFile(wb, 'Institution_Breakdowns.xlsx');
}

function exportVacancies() {
    let scoped = state.vacancies || [];
    if (state.user && state.user.campus_id && state.user.role !== 'super_admin') {
        const userCampId = Number(state.user.campus_id);
        const userCampName = userCampId === 1 ? 'ramapuram' : (userCampId === 2 ? 'trichy' : '');
        scoped = scoped.filter(v => {
            if (v.campus_id) return Number(v.campus_id) === userCampId;
            if (v.campus_name && userCampName) {
                return v.campus_name.toLowerCase().trim() === userCampName;
            }
            return true;
        });
    }
    const rows = scoped.map(v => ({
        'Campus': v.campus_name,
        'Institution': v.institution_name,
        'Department': v.department_name,
        'Total Vacancy': v.total_vacancy,
        'FT With Fellowship Allowed': v.ft_allowed !== null && v.ft_allowed !== undefined ? v.ft_allowed : '',
        'FT Filled': v.full_time_allocated,
        'PT Filled': v.part_time_allocated,
        'Total Filled': v.total_allocated,
        'Remaining': v.remaining_vacancy
    }));
    if (!rows.length) return showToast('No vacancy data to export.', 'error');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 36 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Dept Vacancies');
    XLSX.writeFile(wb, 'Department_Supervisor_Vacancies.xlsx');
}
// ─────────────────────────────────────────────────────────────────────────────

// Save FT Allowed intake for a department (Super Admin only)
async function saveFtAllowed(departmentId, inputEl) {
    const statusEl = document.getElementById(`ft-allowed-status-${departmentId}`);
    const rawVal = inputEl.value.trim();
    const val = rawVal === '' ? null : Number(rawVal);

    if (rawVal !== '' && (!Number.isSafeInteger(val) || val < 0)) {
        if (statusEl) { statusEl.textContent = '⚠'; statusEl.style.color = 'var(--warning)'; }
        return;
    }

    // Optimistically update state so re-render keeps the value
    const dept = (state.vacancies || []).find(v => v.department_id === departmentId);
    if (dept) {
        dept.ft_allowed = val;
        // Adjust remaining_vacancy if total/FT capacity utilization changes
        // (Just recalculate locally, though the API will return the precise count on refresh)
    }
    if (state.user && state.user.role === 'super_admin') {
        updateSuperAdminVacancyAnalysis();
    }

    try {
        await api('/api/vacancies/ft-allowed', 'PUT', { department_id: departmentId, ft_allowed: val });
        if (statusEl) {
            statusEl.textContent = '✓';
            statusEl.style.color = 'var(--success)';
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        }
    } catch (e) {
        if (statusEl) { statusEl.textContent = '⚠'; statusEl.style.color = 'var(--warning)'; }
        showToast(`Failed to save FT Allowed: ${e.message}`, 'error');
    }
}

// Refresh transfer pending counts for notification badges
async function refreshTransferPendingCount() {
    if (!state.user || !state.token) return;
    const transferCountToken = state.token;
    try {
        const res = await api('/api/transfers/pending-counts');
        if (state.token !== transferCountToken) return;
        state.transferPendingCount = res.count || 0;
        const summary = document.getElementById('pending-transfer-summary');
        if (summary) summary.hidden = state.transferPendingCount === 0;
        const total = document.getElementById('pending-transfer-total');
        if (total) total.textContent = state.transferPendingCount;
        const actionTotal = document.querySelector('#pending-action-summary .action-summary-total strong');
        if (actionTotal && typeof candidateNeedsMyAction === 'function') actionTotal.textContent = (state.candidates || []).filter(c => candidateNeedsMyAction(c)).length + state.transferPendingCount;
        const badgeEl = document.getElementById('sidebar-transfer-badge');
        if (badgeEl) {
            if (state.transferPendingCount > 0) {
                badgeEl.innerText = state.transferPendingCount;
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }
        }
    } catch (e) {
        // silent fail
    }
}
window.refreshTransferPendingCount = refreshTransferPendingCount;

// Navigation / Route Switching
function navigateToTab(tabName) {
    state.activeTab = tabName;
    renderApp();
    return loadTabSpecificData();
}

// Load dynamic data based on active view
async function loadTabSpecificData() {
    if (!state.token) return;

    try {
        // Refresh transfer pending counts
        await refreshTransferPendingCount();

        // Refresh settings so deadlines/warnings always stay synchronized
        try {
            const sRes = await api('/api/settings');
            if (sRes && sRes.settings) {
                state.settings = sRes.settings;
            }
        } catch (sErr) {}

        if (['dashboard','overview'].includes(state.activeTab)) {
            const destination=state.activeTab,token=state.token;
            const [metadata,candidateResult,vacancyResult]=await Promise.all([
                api('/api/admin/metadata'),api('/api/candidates'),api('/api/vacancies').catch(()=>({vacancies:[]}))
            ]);
            if(state.activeTab!==destination||state.token!==token)return;
            state.metadata=metadata;state.candidates=candidateResult.candidates||[];state.vacancies=vacancyResult.vacancies||[];
            if(destination==='overview')renderOverviewPage();
            else {
                if(state.user.role==='hod') {
                    try {state.hodPanels=(await api('/api/hod/panels')).panels||[];}
                    catch {state.hodPanels=[];}
                    if(state.activeTab!==destination||state.token!==token)return;
                }
                renderDashboardMetrics();
            }
        } else if (state.activeTab === 'important_dates') {
            renderImportantDatesPage();
        } else if (state.activeTab === 'candidates') {
            const [candidateResult,vacancyResult] = await Promise.all([api('/api/candidates'),api('/api/vacancies')]);
            state.candidates = candidateResult.candidates;
            state.vacancies = vacancyResult.vacancies || [];
            if (!state.metadata) {
                state.metadata = await api('/api/admin/metadata');
            }
            renderCandidatesTable();
        } else if (state.activeTab === 'transfers') {
            const reqs = await api('/api/transfers/my-requests');
            state.transferRequests = reqs.requests || [];
            renderTransferRequestsTable();
        } else if (state.activeTab === 'emails') {
            const logs = await api('/api/admin/email-log');
            state.emailLogs = logs.logs;
            renderEmailLogsTable();
        } else if (state.activeTab === 'users') {
            if (['admin', 'super_admin'].includes(state.user.role)) {
                const res = await api('/api/admin/users');
                state.usersList = res.users;
                if (!state.metadata) {
                    state.metadata = await api('/api/admin/metadata');
                }
                renderUsersTable();
            }
        } else if (state.activeTab === 'supervisors') {
            if (state.user.role === 'hod') {
                const res = await api('/api/hod/supervisors');
                state.hodSupervisors = res.supervisors || [];
                renderHodSupervisorsTable();
            } else if (state.user.role === 'coordinator') {
                const res = await api('/api/coordinator/supervisors');
                state.supervisorsList = res.supervisors || [];
                renderCoordinatorSupervisorsPage();
            }
        } else if (state.activeTab === 'panels') {
            if (state.user.role === 'hod') {
                await loadHodInterviewPanels();
            } else if (state.user.role === 'coordinator') {
                await loadCoordinatorInterviewPanels();
            }
        } else if (state.activeTab === 'regulations') {
            renderRegulationsPage();
        } else if (state.activeTab === 'entrance_exam_docs') {
            state.candidates = (await api('/api/candidates')).candidates;
            if (!state.metadata) {
                state.metadata = await api('/api/admin/metadata');
            }
            renderEntranceExamDocsPage();
        } else if (state.activeTab === 'question_papers') {
            if (state.user.role === 'hod') {
                const res = await api('/api/hod/question-papers');
                state.hodQuestionPapers = res.questionPapers || [];
                renderHodQuestionPapersPage();
            } else if (['admin', 'super_admin'].includes(state.user.role)) {
                const res = await api('/api/admin/question-papers');
                state.adminQuestionPapers = res.departments || [];
                if (!state.metadata) {
                    state.metadata = await api('/api/admin/metadata');
                }
                renderAdminQuestionPapersPage();
            }
        } else if (state.activeTab === 'audit_logs') {
            await renderAuditLogs();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Initialize Application
async function initApp() {
    if (state.token) {
        try {
            // Verify session is active
            const me = await api('/api/auth/me');
            state.user = me.user;
            state.settings = me.settings || {};
            localStorage.setItem('phd_user', JSON.stringify(me.user));
            if (typeof initSocket === 'function') initSocket();
            navigateToTab('dashboard');
        } catch (err) {
            handleLogout();
        }
    } else {
        renderLoginScreen();
    }
}

// Global Date and Deadline Formatting Helper
function formatDeadlineDate(dateStr) {
    if (!dateStr) return 'Not Set';
    const parts = String(dateStr).split('-');
    let d;
    if (parts.length === 3) {
        d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    } else {
        d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 'Not Set';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getDeadlineStatus(deadlineKey, taskName) {
    const rawDate = state.settings?.[deadlineKey];
    if (!rawDate) {
        return { isSet: false, isPast: false, badgeHtml: '', dateStr: 'Not Set', deadlineDate: null };
    }

    const parts = String(rawDate).split('-');
    let deadlineDate;
    if (parts.length === 3) {
        deadlineDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 23, 59, 59, 999);
    } else {
        deadlineDate = new Date(rawDate);
        deadlineDate.setHours(23, 59, 59, 999);
    }

    if (isNaN(deadlineDate.getTime())) {
        return { isSet: false, isPast: false, badgeHtml: '', dateStr: 'Not Set', deadlineDate: null };
    }

    const formatted = deadlineDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const today = new Date();
    const isPast = today > deadlineDate;

    let badgeHtml = '';
    if (isPast) {
        badgeHtml = `
            <div class="deadline-banner deadline-passed" style="background-color: rgba(220, 53, 69, 0.1); color: var(--danger-color); border: 1px solid rgba(220, 53, 69, 0.25); padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.25rem; font-size: 0.9rem; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-clock" style="font-size: 1.05rem; color: var(--danger-color);"></i>
                <span>Deadline for ${taskName || 'this task'} passed on ${formatted}.</span>
            </div>`;
    } else {
        badgeHtml = `
            <div class="deadline-banner deadline-active" style="background-color: rgba(255, 193, 7, 0.1); color: #b28900; border: 1px solid rgba(255, 193, 7, 0.3); padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.25rem; font-size: 0.9rem; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <i class="fa-solid fa-hourglass-half" style="font-size: 1.05rem; color: #b28900;"></i>
                <span>The last date to complete ${taskName || 'this task'} is <strong style="color: #946c00;">${formatted}</strong>.</span>
                <span style="color: #d32f2f; margin-left: 6px; font-weight: 500;">Warning: After this date, the option will be disabled.</span>
            </div>`;
    }

    return { isSet: true, isPast, badgeHtml, dateStr: formatted, deadlineDate };
}

window.formatDeadlineDate = formatDeadlineDate;
window.getDeadlineStatus = getDeadlineStatus;

