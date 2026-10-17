const bulkForwardButtons = [['forward','bulk-forward-btn','bulk-forward-count'],['incomplete','bulk-forward2-btn','bulk-forward2-count'],['eligibility','bulk-verify-btn','bulk-verify-count'],['ranks','bulk-release-btn','bulk-release-count'],['selections','bulk-admin-btn','bulk-admin-count']];
function candidateBulkForwardKey(c) {
    if (!c) return null;
    const role = state.user.role, owner = c.current_owner;
    const mapped = c.institution_id && c.department_id && ![100,101].includes(Number(c.institution_id)) && ![100,101].includes(Number(c.department_id));
    if (['admin','super_admin'].includes(role) && mapped && rankAwaitingAdminRelease(c)) return 'ranks';
    if (['admin','super_admin'].includes(role) && owner === 'Admin' && mapped) {
        if (c.status === 'Incomplete') return 'incomplete';
        if (['Pending Verification','Complete'].includes(c.status)) return 'forward';
        if (c.status === 'Ranked') return 'ranks';
    }
    const verdict = isCandidateEligible(c) || isCandidateIneligible(c) || ['Eligible','Not Eligible'].includes(c.status_reason) || ['Verified Eligible','Verified Ineligible','HOD Verified Eligible','HOD Verified Ineligible'].includes(c.status);
    if (role === 'coordinator' && ['RC','Coordinator'].includes(owner)) {
        if (['Selection Finalized','Returned to RC (Guides)'].includes(c.status)) return 'selections';

        if (['Under RC Review','Returned to RC','Under Coordinator Review','Verified Eligible','Verified Ineligible','HOD Verified Eligible','HOD Verified Ineligible'].includes(c.status)) return verdict ? 'eligibility' : 'forward';
    }
    if (role === 'dean' && owner === 'Dean') {
        if (['Under Dean Final Review','Returned to Dean (Final)'].includes(c.status)) return 'selections';

        if (['Under Dean Review','Returned to Dean','Under Dean Initial Review','Verified Eligible','Verified Ineligible','HOD Verified Eligible','HOD Verified Ineligible'].includes(c.status)) return verdict ? 'eligibility' : 'forward';
    }
    if (role === 'hod' && owner === 'HOD' && Number(c.department_id) === Number(state.user.department_id) && String(c.form_status || '').toLowerCase() !== 'incomplete') {
        if (['HOD Verified Eligible','HOD Verified Ineligible'].includes(c.status)) return 'forward';
        if (['Guide Allocated','Guide Allocation Open','Returned to HOD (Guides)'].includes(c.status) && ['Selected','Not Selected'].includes(c.selection_status)) return 'selections';
    }
    return null;
}
function candidateBulkForwardAction(key) {
    const role = state.user.role;
    const actions = ['admin','super_admin'].includes(role) ? {
        forward:['/api/admin/forward-to-dean','Forward to Dean'],incomplete:['/api/admin/forward-incomplete-to-hod','Forward Incomplete to HoD'],ranks:['/api/admin/release-ranks-to-all','Release Ranks to All']
    } : role === 'dean' ? {
        forward:['/api/dean/forward-to-rc','Forward to RC'],eligibility:['/api/dean/forward-eligibility-to-admin','Forward Eligibility to Admin'],selections:['/api/dean/forward-selections-to-admin','Forward Selections to Admin']
    } : role === 'coordinator' ? {
        forward:['/api/rc/forward-to-hod','Forward to HoD'],eligibility:['/api/rc/forward-to-dean','Forward Eligibility to Dean'],selections:['/api/rc/forward-selections-to-dean','Forward Selections to Dean']
    } : {forward:['/api/hod/forward-to-rc','Forward Eligibility to RC'],selections:['/api/hod/forward-selections-to-rc','Forward Selections to RC']};
    const action = actions[key];
    return action ? {url:action[0],label:action[1]} : null;
}
let bulkForwardInFlight = false;
async function runCandidateBulkForward(key) {
    if (bulkForwardInFlight) return;
    const action = candidateBulkForwardAction(key);
    const ids = _getCheckedIds(c => candidateBulkForwardKey(c) === key);
    if (!action || !ids.length) return showToast('Select applications ready for this workflow step.', 'error');
    bulkForwardInFlight = true;
    const buttons = [...document.querySelectorAll('#bulk-action-btn-container button')];
    buttons.forEach(button => button.disabled = true);
    try {
        const result = await api(action.url,'POST',{candidateIds:ids,campus_id:state.activeCandidateCampus});
        showToast(result.message || action.label + ': ' + ids.length + ' application(s).');
        await loadTabSpecificData();
    } catch(error) { showToast(error.message,'error'); }
    finally { bulkForwardInFlight = false; buttons.forEach(button => button.disabled = false); }
}

// --- CANDIDATES DATA ---
let candidateSearchTimeout;
window.handleCandidateTableSearch = function(query) {
    clearTimeout(candidateSearchTimeout);
    candidateSearchTimeout = setTimeout(() => {
        state.candidateSearchQuery = query;
        renderCandidatesTable();
        const searchInput = document.getElementById('candidate-table-search');
        if (searchInput) {
            searchInput.focus();
            const val = searchInput.value;
            searchInput.value = '';
            searchInput.value = val;
        }
    }, 300);
}

function renderCandidatesTable() {
    try {
        const mainContent = document.getElementById('main-content');

        // 1. Determine Accessible Institutions for the active user
        function getUserAccessibleInstitutions(user, metadata) {
            if (!metadata || !metadata.institutions) return [];
            const allInsts = metadata.institutions;

            if (user.role === 'super_admin') {
                const campId = state.activeCandidateCampus || 1;
                return allInsts.filter(inst => inst.campus_id === campId);
            }

            if (user.role === 'admin') {
                return allInsts.filter(inst => inst.campus_id === user.campus_id);
            }

            if (user.role === 'dean') {
                const deanInsts = allInsts.filter(inst => inst.dean_username === user.username);
                return deanInsts;
            }

            if (user.role === 'coordinator') {
                const coordInsts = allInsts.filter(inst => 
                    inst.coord_username === user.username || 
                    (user.institution_id && inst.id === user.institution_id)
                );
                if (coordInsts.length > 0) return coordInsts;
                return allInsts.filter(inst => inst.campus_id === user.campus_id);
            }

            if (user.role === 'hod') {
                if (user.institution_id) {
                    return allInsts.filter(inst => inst.id === user.institution_id);
                }
                return [];
            }

            return allInsts;
        }

        // Initialize activeCandidateCampus
        if (state.user.role === 'super_admin') {
            if (!state.activeCandidateCampus) state.activeCandidateCampus = 1;
        } else {
            state.activeCandidateCampus = state.user.campus_id || 1;
        }

        const accessibleInsts = getUserAccessibleInstitutions(state.user, state.metadata);
        const validInstIds = accessibleInsts.map(inst => inst.id);

        if (!state.activeCandidateInst || !validInstIds.includes(state.activeCandidateInst)) {
            state.activeCandidateInst = validInstIds.length > 0 ? validInstIds[0] : null;
        }

        // 2. Base candidate pool for the active campus & institution
        let instCandidates = state.candidates || [];
        if (state.user.role === 'hod') {
            // HOD strictly sees only candidates of their corresponding department
            instCandidates = instCandidates.filter(c => {
                if (state.user.department_id) return c.department_id === state.user.department_id;
                return true;
            });
        } else {
            if (state.activeCandidateInst) {
                instCandidates = instCandidates.filter(c => c.institution_id === state.activeCandidateInst);
            }
        }

        // Compact department picker; pending work remains visible in every option.
        const departmentNames = new Set((state.metadata?.departments || []).filter(d => d.institution_id === state.activeCandidateInst).map(d => d.name));
        instCandidates.forEach(c => departmentNames.add(c.department_name || 'Unassigned / Pending Mapping'));
        let selectedDepartmentId = 0;
        if (state.user.role === 'hod') {
            const ownDepartment = state.metadata?.departments.find(d => d.id === state.user.department_id);
            state.activeCandidateDept = ownDepartment?.name || instCandidates[0]?.department_name || 'My Department';
            selectedDepartmentId = state.user.department_id;
        } else if (!state.activeCandidateDept || state.activeCandidateDept !== 'All' && !departmentNames.has(state.activeCandidateDept)) {
            state.activeCandidateDept = 'All';
        }
        if (state.activeCandidateDept !== 'All' && state.user.role !== 'hod') selectedDepartmentId = state.metadata?.departments.find(d => d.institution_id === state.activeCandidateInst && d.name === state.activeCandidateDept)?.id || instCandidates.find(c => c.department_name === state.activeCandidateDept)?.department_id || 0;
        const departmentOptions = state.user.role === 'hod' ? [state.activeCandidateDept] : ['All', ...[...departmentNames].sort()];
        const deptTabsHtml = `<div class="candidate-scope-field">
            <div class="candidate-scope-label"><label for="candidate-department">Department</label><span class="candidate-scope-pending">${pendingActionCount(state.activeCandidateInst,selectedDepartmentId) ? pendingActionBadge(state.activeCandidateInst,selectedDepartmentId) + ' awaiting action' : 'No pending actions'}</span></div>
            <select id="candidate-department" class="form-select" onchange="switchCandidateDeptTab(this.value)" ${state.user.role === 'hod' ? 'disabled' : ''}>
                ${departmentOptions.map(name => {
                    const pool = name === 'All' ? instCandidates : instCandidates.filter(c => (c.department_name || 'Unassigned / Pending Mapping') === name);
                    const pending = pool.filter(c => candidateNeedsMyAction(c)).length;
                    return '<option value="'+pendingEscape(name)+'" '+(state.activeCandidateDept === name ? 'selected' : '')+'>'+pendingEscape(name === 'All' ? 'All Departments' : name)+(pending ? ' · '+pending+' pending' : '')+'</option>';
                }).join('')}
            </select>
        </div>`;

        // 4. Candidates for the selected department
        let deptCandidates = instCandidates;
        if (state.user.role === 'hod') {
            deptCandidates = instCandidates;
        } else if (state.activeCandidateDept && state.activeCandidateDept !== 'All') {
            deptCandidates = instCandidates.filter(c => (c.department_name || 'Unassigned / Pending Mapping') === state.activeCandidateDept);
        }

        deptCandidates = deptCandidates.filter(candidateMatchesStudyMode);

        // 5. Status Filter Buttons (Row 4) with dynamic counts from deptCandidates
        const filters = ['Needs My Action', 'Complete Applications', 'Incomplete Applications', 'Eligible', 'Not Eligible', 'Ranked', 'Selected', 'Not Selected'];
        
        // Ensure activeCandidateFilter defaults to 'Complete Applications'
        if (!state.activeCandidateFilter || state.activeCandidateFilter === 'All' || state.activeCandidateFilter === 'Pending Verification' || !filters.includes(state.activeCandidateFilter)) {
            state.activeCandidateFilter = 'Complete Applications';
        }

        function getStatusFilteredCount(filterName, pool) {
            if (filterName === 'Needs My Action') return pool.filter(c => candidateNeedsMyAction(c)).length;
            if (filterName === 'Complete Applications') return pool.filter(c => isCandidateComplete(c)).length;
            if (filterName === 'Incomplete Applications') return pool.filter(c => (c.form_status || '').toLowerCase() === 'incomplete').length;
            if (filterName === 'Selected') return pool.filter(c => c.selection_status === 'Selected').length;
            if (filterName === 'Not Selected') return pool.filter(c => c.selection_status === 'Not Selected' || c.status === 'Entrance Exam Absent').length;
            if (filterName === 'Eligible') return pool.filter(c => isCandidateEligible(c) && !isCandidateRanked(c)).length;
            if (filterName === 'Not Eligible') return pool.filter(c => isCandidateIneligible(c)).length;
            if (filterName === 'Ranked') return pool.filter(c => isCandidateRanked(c)).length;
            return pool.filter(c => c.status === filterName).length;
        }

        const filterButtons = filters.map(f => {
            let icon = '';
            if (f === 'Complete Applications') icon = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> ';
            if (f === 'Incomplete Applications') icon = '<i class="fa-solid fa-circle-exclamation" style="color:var(--danger);"></i> ';
            if (f === 'Eligible') icon = '<i class="fa-solid fa-user-check" style="color:var(--success);"></i> ';
            if (f === 'Not Eligible') icon = '<i class="fa-solid fa-user-xmark" style="color:var(--danger);"></i> ';
            if (f === 'Ranked') icon = '<i class="fa-solid fa-ranking-star" style="color:#f59e0b;"></i> ';
            const count = getStatusFilteredCount(f, deptCandidates);
            return `
                <button class="tab-btn ${state.activeCandidateFilter === f ? 'active' : ''}" onclick="filterCandidates('${f}')" style="font-family: Cambria, Georgia, serif;">
                    ${icon}${f} <span style="font-size: 0.8rem; opacity: 0.85; margin-left: 3px;">(${count})</span>
                </button>
            `;
        }).join('');

        // 6. Filter by Status & Search Query
        let list = deptCandidates;
        if (state.activeCandidateFilter) {
            if (state.activeCandidateFilter === 'Needs My Action') {
                list = list.filter(c => candidateNeedsMyAction(c));
            } else if (state.activeCandidateFilter === 'Complete Applications') {
                list = list.filter(c => isCandidateComplete(c));
            } else if (state.activeCandidateFilter === 'Incomplete Applications') {
                list = list.filter(c => (c.form_status || '').toLowerCase() === 'incomplete');
            } else if (state.activeCandidateFilter === 'Selected') {
                list = list.filter(c => c.selection_status === 'Selected');
            } else if (state.activeCandidateFilter === 'Not Selected') {
                list = list.filter(c => c.selection_status === 'Not Selected' || c.status === 'Entrance Exam Absent');
            } else if (state.activeCandidateFilter === 'Eligible') {
                list = list.filter(c => isCandidateEligible(c) && !isCandidateRanked(c));
            } else if (state.activeCandidateFilter === 'Not Eligible') {
                list = list.filter(c => isCandidateIneligible(c));
            } else if (state.activeCandidateFilter === 'Ranked') {
                list = list.filter(c => isCandidateRanked(c));
            } else {
                list = list.filter(c => c.status === state.activeCandidateFilter);
            }
        }

        if (state.candidateSearchQuery) {
            const q = state.candidateSearchQuery.toLowerCase();
            list = list.filter(c => 
                (c.registered_name && c.registered_name.toLowerCase().includes(q)) ||
                (c.email && c.email.toLowerCase().includes(q)) ||
                (c.application_no && c.application_no.toLowerCase().includes(q)) ||
                (c.mobile && c.mobile.toLowerCase().includes(q))
            );
        }

        // Sort List by application number (or ID)
        list = sortCandidatesList(list);

        // 7. Campus Tabs (Row 1) & Institution Tabs (Row 2)
        let campusTabsHtml = '';
        let subTabsHtml = '';

        if (state.user.role === 'super_admin') {
            const campuses = [
                { id: 1, name: 'Ramapuram Campus' },
                { id: 2, name: 'Trichy Campus' }
            ];
            const campusButtons = campuses.map(c => `
                <button class="tab-btn ${state.activeCandidateCampus === c.id ? 'active' : ''}" onclick="switchCandidateCampusTab(${c.id})">
                    <i class="fa-solid fa-building-columns"></i> ${c.name}
                </button>
            `).join('');

            campusTabsHtml = `
                <div class="tabs-header" style="margin-bottom: 1rem;">
                    ${campusButtons}
                </div>
            `;
        }

        if (accessibleInsts.length) {
            subTabsHtml = `<div class="candidate-scope-field">
                <div class="candidate-scope-label"><label for="candidate-institute">Institute</label><span class="candidate-scope-pending">${pendingActionCount(state.activeCandidateInst) ? pendingActionBadge(state.activeCandidateInst) + ' awaiting action' : 'No pending actions'}</span></div>
                <select id="candidate-institute" class="form-select" onchange="switchCandidateInstTab(Number(this.value))">
                    ${accessibleInsts.map(inst => '<option value="'+inst.id+'" '+(state.activeCandidateInst === inst.id ? 'selected' : '')+'>'+pendingEscape(inst.is_routing_office ? inst.name+' — Unmapped Applications' : inst.name)+(pendingActionCount(inst.id) ? ' · '+pendingActionCount(inst.id)+' pending' : '')+'</option>').join('')}
                </select>
            </div>`;
        }

        let htmlContent = `
            <div class="candidate-page-heading">
                <h2 style="font-size: 1.8rem;">PhD Applicants Manager</h2>
                    ${(state.user.role === 'admin' || state.user.role === 'super_admin') ? (() => {
                        const pendingCount = (state.candidates || []).filter(c => c.status === 'Under HOD Verification' && c.current_owner === 'HOD').length;
                        return `
                        <button
                            id="remind-deans-btn"
                            class="btn"
                            onclick="openAdminDeanReminderModal()"
                            title="Send consolidated reminder emails to Deans/VPs with CC to Research Coordinators"
                            style="background: linear-gradient(135deg, #7c3aed, #a855f7); color:#fff; border:none; display:flex; align-items:center; gap:6px; position:relative; ${pendingCount === 0 ? 'opacity:0.6;' : ''}"
                        >
                            <i class="fa-solid fa-paper-plane"></i> Remind Deans & RCs
                            ${pendingCount > 0 ? `<span style="position:absolute; top:-7px; right:-7px; background:#ef4444; color:#fff; font-size:0.65rem; font-weight:700; padding:2px 5px; border-radius:9px; line-height:1;">${pendingCount}</span>` : ''}
                        </button>
                        `;
                    })() : ''}
                    ${(state.user.role === 'dean' || state.user.role === 'coordinator') ? (() => {
                        const pendingCount = (state.candidates || []).filter(c => c.status === 'Under HOD Verification' && c.current_owner === 'HOD').length;
                        return `
                        <button
                            id="remind-hods-btn"
                            class="btn"
                            onclick="openFacultyHodReminderModal()"
                            title="Send department-wise reminder emails to HODs with pending eligibility checks"
                            style="background: linear-gradient(135deg, #7c3aed, #a855f7); color:#fff; border:none; display:flex; align-items:center; gap:6px; position:relative; ${pendingCount === 0 ? 'opacity:0.6;' : ''}"
                        >
                            <i class="fa-solid fa-bell"></i> Remind HODs
                            ${pendingCount > 0 ? `<span style="position:absolute; top:-7px; right:-7px; background:#ef4444; color:#fff; font-size:0.65rem; font-weight:700; padding:2px 5px; border-radius:9px; line-height:1;">${pendingCount}</span>` : ''}
                        </button>
                        `;
                    })() : ''}
                    <div style="display:flex; gap: 6px; border-left: 1px solid var(--glass-border); padding-left: 8px; margin-left: 4px;">
                        <button class="btn btn-secondary" onclick="downloadCandidatesExcel(getFilteredCandidateList(), 'PhD_Applicants_' + (state.activeCandidateFilter || 'Complete_Applications').replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.xlsx')" title="Download as Excel (.xlsx)">
                            <i class="fa-solid fa-file-excel" style="color: #22c55e;"></i> Excel
                        </button>
                        <button class="btn btn-secondary" onclick="openInstituteApplicationsExport(state.activeCandidateInst)" title="All application statuses, summary and department sheets"><i class="fa-solid fa-file-excel" style="color:#22c55e;"></i> Institute Excel</button>
                        <button class="btn btn-secondary" onclick="downloadCandidatesPDF()" title="Download as PDF">
                            <i class="fa-solid fa-file-pdf" style="color: #ef4444;"></i> PDF
                        </button>
                        <button class="btn btn-secondary" onclick="downloadCandidatesDocsZip(getFilteredCandidateList(), 'PhD_Documents_' + (state.activeCandidateFilter || 'Complete_Applications').replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.zip')" title="Download Documents ZIP">
                            <i class="fa-solid fa-file-zip" style="color: #3b82f6;"></i> Zip Docs
                        </button>
                    </div>
                </div>
            </div>

            ${campusTabsHtml}
            <div class="candidate-scope-panel">${subTabsHtml}${deptTabsHtml}</div>
            ${renderStudyModeFilter()}
            ${state.user.role === 'hod' ? (getDeadlineStatus('deadline_eligibility', 'Candidate Eligibility Verification').badgeHtml || '') : ''}

            <div class="tabs-header candidate-status-controls">
                <div class="candidate-status-tabs">
                    ${filterButtons}
                </div>
                <div class="search-container" style="margin-left: 1rem; flex-shrink: 0; position: relative;">
                    <i class="fa-solid fa-search" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted);"></i>
                    <input type="text" id="candidate-table-search" placeholder="Search Name, Email, App No..." value="${state.candidateSearchQuery || ''}" oninput="handleCandidateTableSearch(this.value)" style="padding: 8px 12px 8px 32px; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--input-bg); color: var(--text); width: 250px; font-size: 0.9rem;">
                    ${state.candidateSearchQuery ? `<i class="fa-solid fa-times" onclick="handleCandidateTableSearch('')" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); cursor: pointer;"></i>` : ''}
                </div>
            </div>
            <div class="candidate-bulk-toolbar" aria-label="Bulk applicant actions">
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <label style="cursor:pointer"><input id="select-all-visible-candidates" type="checkbox" onchange="globalSelectAll(this.checked)"> Select All Ready Applications</label>
                    <span id="bulk-selected-summary" role="status">0 selected</span>
                    <button id="bulk-clear-selection" class="btn btn-secondary" type="button" onclick="globalSelectAll(false)" hidden>Clear Selection</button>
                </div>
                    <div id="bulk-action-btn-container" style="display: none; gap: 8px; flex-wrap: wrap;">
                        ${['admin', 'super_admin'].includes(state.user.role) ? `
                            <button class="btn btn-primary animate-fade-in" id="bulk-forward-btn" onclick="executeBulkForward()" style="background-color: var(--primary); border-color: var(--primary); display: none;">
                                <i class="fa-solid fa-share-from-square"></i> Forward to Dean (<span id="bulk-forward-count">0</span>)
                            </button>
                            <button class="btn btn-info animate-fade-in" id="bulk-forward2-btn" onclick="executeBulkForward2()" style="display: none;">
                                <i class="fa-solid fa-share-from-square"></i> Forward Incomplete to HOD (<span id="bulk-forward2-count">0</span>)
                            </button>
                            <button class="btn btn-primary animate-fade-in" id="bulk-release-btn" onclick="executeRankedBulkRelease()" style="display: none;">
                                <i class="fa-solid fa-share-from-square"></i> Release Rank to All (<span id="bulk-release-count">0</span>)
                            </button>
                            <button class="btn btn-warning animate-fade-in" id="bulk-return-btn" onclick="executeBulkReturn()" style="display: none;">
                                <i class="fa-solid fa-reply"></i> Return to Dean for query (<span id="bulk-return-count">0</span>)
                            </button>
                            <button class="btn btn-warning animate-fade-in" id="bulk-return2-btn" onclick="executeBulkReturn2()" style="display: none;">
                                <i class="fa-solid fa-reply"></i> Return Selections to Dean (<span id="bulk-return2-count">0</span>)
                            </button>
                            <button class="btn btn-danger animate-fade-in" id="bulk-delete-btn" onclick="executeBulkDelete()" style="background-color: #ef4444; border-color: #ef4444; display: none;">
                                <i class="fa-solid fa-trash"></i> Bulk Delete (<span id="bulk-delete-count">0</span>)
                            </button>
                        ` : ''}
                        ${state.user.role === 'coordinator' ? `
                            <button class="btn btn-primary animate-fade-in" id="bulk-forward-btn" onclick="executeBulkForward()" style="display: none;">
                                <i class="fa-solid fa-share-from-square"></i> Forward to HOD (<span id="bulk-forward-count">0</span>)
                            </button>
                            <button class="btn btn-success animate-fade-in" id="bulk-verify-btn" onclick="executeBulkVerifyForward()" style="display: none;">
                                <i class="fa-solid fa-paper-plane"></i> Forward Eligibility Status to Dean (<span id="bulk-verify-count">0</span>)
                            </button>
                            <button class="btn btn-warning animate-fade-in" id="bulk-return-btn" onclick="executeBulkReturn()" style="display: none;">
                                <i class="fa-solid fa-reply"></i> Return to HOD for query (<span id="bulk-return-count">0</span>)
                            </button>
                            <button class="btn btn-success animate-fade-in" id="bulk-admin-btn" onclick="executeRankedBulkForwardAdmin()" style="display: none;">
                                <i class="fa-solid fa-paper-plane"></i> Forward Selections to Dean (<span id="bulk-admin-count">0</span>)
                            </button>
                            <button class="btn btn-warning animate-fade-in" id="bulk-return2-btn" onclick="executeBulkReturn2()" style="display: none;">
                                <i class="fa-solid fa-reply"></i> Return Selections to HOD (<span id="bulk-return2-count">0</span>)
                            </button>
                        ` : ''}
                        ${state.user.role === 'dean' ? `
                            <button class="btn btn-primary animate-fade-in" id="bulk-forward-btn" onclick="executeBulkForward()" style="display: none;">
                                <i class="fa-solid fa-share-from-square"></i> Forward to RC (<span id="bulk-forward-count">0</span>)
                            </button>
                            <button class="btn btn-success animate-fade-in" id="bulk-verify-btn" onclick="executeBulkVerifyForward()" style="display: none;">
                                <i class="fa-solid fa-paper-plane"></i> Forward Eligibility Status to Admin (<span id="bulk-verify-count">0</span>)
                            </button>
                            <button class="btn btn-warning animate-fade-in" id="bulk-return-btn" onclick="executeBulkReturn()" style="display: none;">
                                <i class="fa-solid fa-reply"></i> Return to RC for query (<span id="bulk-return-count">0</span>)
                            </button>
                            <button class="btn btn-success animate-fade-in" id="bulk-admin-btn" onclick="executeRankedBulkForwardAdmin()" style="display: none;">
                                <i class="fa-solid fa-paper-plane"></i> Approve Selections to Admin (<span id="bulk-admin-count">0</span>)
                            </button>
                            <button class="btn btn-warning animate-fade-in" id="bulk-return2-btn" onclick="executeBulkReturn2()" style="display: none;">
                                <i class="fa-solid fa-reply"></i> Return Selections to RC (<span id="bulk-return2-count">0</span>)
                            </button>
                        ` : ''}
                        ${state.user.role === 'hod' ? `
                            <button class="btn btn-success animate-fade-in" id="bulk-forward-btn" onclick="executeBulkForward()" style="display: none;">
                                <i class="fa-solid fa-paper-plane"></i> Forward Eligibility Status to RC (<span id="bulk-forward-count">0</span>)
                            </button>
                            <button class="btn btn-primary animate-fade-in" id="bulk-admin-btn" onclick="executeRankedBulkForwardAdmin()" style="display: none;">
                                <i class="fa-solid fa-paper-plane"></i> Forward Selections to RC (<span id="bulk-admin-count">0</span>)
                            </button>
                        ` : ''}
                    </div>

            </div>
        `;

        if (list.length === 0) {
            const filterLabel = state.activeCandidateFilter || 'Complete Applications';
            const deptLabel = (state.activeCandidateDept && state.activeCandidateDept !== 'All') ? `in Department of ${state.activeCandidateDept}` : 'in this institution';
            htmlContent += `
                <div class="table-container animate-fade-in" style="margin-top: 1rem;">
                    <p style="text-align:center; color:var(--text-muted); padding: 2rem;">No applicants match "${filterLabel}" ${deptLabel}.</p>
                </div>
            `;
        } else {
            const modeColors = {
                fulltime:  'var(--success)',
                pti:       'var(--info)',
                pte_acad:  '#a78bfa',
                pte_ind:   '#fb923c',
                pt_other:  '#94a3b8',
            };
            const modeIcons = {
                fulltime:  'fa-solid fa-clock',
                pti:       'fa-solid fa-building-user',
                pte_acad:  'fa-solid fa-university',
                pte_ind:   'fa-solid fa-industry',
                pt_other:  'fa-solid fa-clock-rotate-left',
            };

            // Group the filtered list by department
            const groupsToRender = {};
            list.forEach(c => {
                const dName = c.department_name || 'Unassigned / Pending Mapping';
                if (!groupsToRender[dName]) groupsToRender[dName] = [];
                groupsToRender[dName].push(c);
            });

            const deptKeys = Object.keys(groupsToRender).sort();

            deptKeys.forEach(dName => {
                const deptList = groupsToRender[dName];
                const instName = (deptList[0] && deptList[0].institution_name) || '';
                const isMappingQueue = deptList.every(c => [100,101].includes(Number(c.institution_id)));

                htmlContent += `
                    <div class="card" style="margin-top: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); padding: 1.5rem; border-radius: 12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.2rem; border-bottom: 2px solid var(--glass-border); padding-bottom: 8px;">
                            <h3 style="color: var(--primary); font-size: 1.4rem; margin:0;">
                                <i class="fa-solid fa-building"></i> Department of ${dName} <span style="font-size:0.85rem; color:var(--text-muted); font-weight:normal;">(${instName})</span>
                            </h3>
                            <div style="display:flex; gap:6px; align-items:center;">
                                ${!isMappingQueue && ['admin', 'super_admin'].includes(state.user.role) ? `
                                    <button class="btn btn-success" style="padding:4px 10px; font-size:0.78rem;" onclick="${transferAction('generateDeptRanks', Number(deptList[0].department_id), dName)}" title="Generate Ranks for Department of ${dName}">
                                        <i class="fa-solid fa-ranking-star"></i> Generate Ranks
                                    </button>
                                ` : ''}
                                ${['admin','super_admin'].includes(state.user.role) && state.candidates.some(c=>Number(c.department_id)===Number(deptList[0].department_id)&&rankAwaitingAdminRelease(c)) ? '<button type="button" class="btn btn-primary" onclick="releaseDeptRanks('+Number(deptList[0].department_id)+')">Release Ranks to All</button>' : ''}
                                <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.78rem;" onclick="downloadDeptExcel('${instName ? instName.replace(/'/g, "\\'") : ''}', '${dName ? dName.replace(/'/g, "\\'") : ''}')">
                                    <i class="fa-solid fa-file-excel" style="color:#22c55e;"></i> Excel
                                </button>
                                <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.78rem;" onclick="downloadDeptPDF('${instName ? instName.replace(/'/g, "\\'") : ''}', '${dName ? dName.replace(/'/g, "\\'") : ''}')">
                                    <i class="fa-solid fa-file-pdf" style="color:#ef4444;"></i> PDF
                                </button>
                                <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.78rem;" onclick="downloadCandidatesDocsZip(getFilteredCandidateList(true).filter(c => c.institution_name === '${instName ? instName.replace(/'/g, "\\'") : ''}' && c.department_name === '${dName ? dName.replace(/'/g, "\\'") : ''}'), 'PhD_Documents_' + '${dName ? dName.replace(/'/g, "\\'") : ''}'.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.zip')" title="Download Department Documents ZIP">
                                    <i class="fa-solid fa-file-zip" style="color:#3b82f6;"></i> Zip Docs
                                </button>
                            </div>
                        </div>
                `;

                if (['Ranked','Selected','Not Selected'].includes(state.activeCandidateFilter)) htmlContent += '<p data-selection-limit="'+Number(deptList[0].department_id)+'" style="color:var(--text-secondary);margin-bottom:12px">'+selectionLimitText(deptList[0].department_id)+'</p>';
                const activeModes = STUDY_MODES.filter(mode => deptList.some(c => mode.match(c.mode_of_study || '',c)));
                if (activeModes.length === 0) {
                    htmlContent += `
                        <div style="text-align: center; color: var(--text-muted); padding: 1.5rem; font-size: 0.85rem;">
                            <i class="fa-solid fa-inbox" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>
                            No candidates found for this department under current filter.
                        </div>
                    `;
                } else {
                    activeModes.forEach(mode => {
                        const candidates = deptList.filter(c => mode.match(c.mode_of_study || '',c));
                        const color = modeColors[mode.key] || 'var(--primary)';
                        const icon  = modeIcons[mode.key] || 'fa-solid fa-graduation-cap';
                        htmlContent += `
                            <div style="margin-top: 1rem; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 5px; background: ${color}22; color: ${color}; font-size: 0.75rem;">
                                        <i class="${icon}"></i>
                                    </span>
                                    <span style="color: var(--text-primary); font-size: 0.9rem; font-weight: 600;">
                                        ${mode.label}
                                    </span>
                                    <span class="badge" style="font-size: 0.68rem; padding: 1px 7px; background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border); color: var(--text-muted);">
                                        ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </div>
                        ` + renderMiniRankTable(candidates);
                    });
                }

                htmlContent += `</div>`;
            });
        }

        mainContent.innerHTML = htmlContent;
        updateBulkActionVisibility();
    } catch (err) {
        document.getElementById('main-content').innerHTML = `<div style="color:var(--danger); padding:2rem; background:var(--bg-secondary); border-radius:8px; margin-top:2rem;"><h3>Error rendering candidates</h3><pre style="white-space:pre-wrap;">${err.stack}</pre></div>`;
        console.error('Render Candidates Table Error:', err);
    }
}

function filterCandidates(filter) {
    state.activeCandidateFilter = filter;
    renderCandidatesTable();
}

function switchCandidateDeptTab(deptName) {
    state.activeCandidateDept = deptName;
    renderCandidatesTable();
}
window.switchCandidateDeptTab = switchCandidateDeptTab;

// --- BULK SELECTION HANDLERS ---
function toggleSelectAllCandidates(sourceCheckbox, idsStr) {
    const ids = idsStr.split(',').map(id => parseInt(id));
    const checkboxes = document.querySelectorAll('.candidate-checkbox');
    checkboxes.forEach(cb => {
        const id = parseInt(cb.value);
        if (ids.includes(id) && !cb.disabled) {
            cb.checked = sourceCheckbox.checked;
        }
    });
    updateBulkActionVisibility();
}

function globalSelectAll(select) {
    const checkboxes = document.querySelectorAll('.candidate-checkbox');
    checkboxes.forEach(cb => {
        if (!cb.disabled) {
            cb.checked = select;
        }
    });
    const headerCheckboxes = document.querySelectorAll('.select-all-candidates');
    headerCheckboxes.forEach(cb => {
        cb.checked = select;
    });
    updateBulkActionVisibility();
}
window.globalSelectAll = globalSelectAll;

// ══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Opens a modal asking for a mandatory remark/query before a return action.
 * Calls cb(remark) on confirm. Shows error if remark is empty.
 */
function showRemarkModal(title, placeholder, cb) {
    const existing = document.getElementById('remark-modal-overlay');
    if (existing) existing.remove();

    const html = `
    <div id="remark-modal-overlay" style="display:flex;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:12px;padding:2rem;width:90%;max-width:540px;box-shadow:0 10px 25px rgba(0,0,0,.2);">
        <h4 style="margin:0 0 .75rem;color:#1e293b;">${title}</h4>
        <p style="margin:0 0 1rem;font-size:.875rem;color:#64748b;">This remark will be visible to the recipient and is <strong>mandatory</strong>.</p>
        <textarea id="remark-modal-text" rows="4" placeholder="${placeholder}"
          style="width:100%;box-sizing:border-box;padding:.75rem;border:1px solid #cbd5e1;border-radius:8px;font-size:.875rem;resize:vertical;"></textarea>
        <div id="remark-modal-error" style="color:#ef4444;font-size:.8rem;margin-top:.25rem;display:none;">Please enter a remark before proceeding.</div>
        <div style="display:flex;gap:.75rem;margin-top:1rem;justify-content:flex-end;">
          <button onclick="document.getElementById('remark-modal-overlay').remove()"
            style="padding:.5rem 1rem;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">Cancel</button>
          <button id="remark-modal-confirm" style="padding:.5rem 1.25rem;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;">Return with Query</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('remark-modal-confirm').addEventListener('click', () => {
        const txt = document.getElementById('remark-modal-text').value.trim();
        if (!txt) {
            document.getElementById('remark-modal-error').style.display = 'block';
            return;
        }
        document.getElementById('remark-modal-overlay').remove();
        cb(txt);
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK ACTION VISIBILITY — updated for new workflow
// ══════════════════════════════════════════════════════════════════════════════

function updateBulkActionVisibility() {
    const checkedBoxes = document.querySelectorAll('.candidate-checkbox:checked');
    const container = document.getElementById('bulk-action-btn-container');
    if (!container) return;
    const totalCount = checkedBoxes.length;
    const clearButton = document.getElementById('bulk-clear-selection');
    if (clearButton) clearButton.hidden = totalCount === 0;
    const ready = [...document.querySelectorAll('.candidate-checkbox:not(:disabled)')];
    const summary = document.getElementById('bulk-selected-summary');
    if (summary) summary.textContent = totalCount + ' selected / ' + ready.length + ' ready';
    const global = document.getElementById('select-all-visible-candidates');
    if (global) { global.disabled = ready.length === 0; global.checked = ready.length > 0 && ready.every(cb => cb.checked); global.indeterminate = totalCount > 0 && !global.checked; }
    document.querySelectorAll('.select-all-candidates').forEach(header => { const rows = [...header.closest('table').querySelectorAll('.candidate-checkbox:not(:disabled)')]; header.checked = rows.length > 0 && rows.every(cb => cb.checked); header.indeterminate = rows.some(cb => cb.checked) && !header.checked; });
    if (totalCount > 0) container.style.display = 'flex';
    else { container.style.display = 'none'; return; }

    // Hide all by default
    ['bulk-forward-btn','bulk-verify-btn','bulk-release-btn','bulk-admin-btn',
     'bulk-delete-btn','bulk-forward2-btn','bulk-return-btn','bulk-return2-btn']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

    const role = state.user.role;

    if (['admin', 'super_admin'].includes(role)) {
        let fwdDeanCount = 0, fwdHodCount = 0, releaseRankCount = 0, returnDeanCount = 0, returnSelectionsCount = 0, deleteCount = 0;
        checkedBoxes.forEach(cb => {
            const c = state.candidates.find(i => i.id === parseInt(cb.value));
            if (!c) return;
            deleteCount++;
            if (c.current_owner === 'Admin' && c.status === 'Approved Guides') { returnSelectionsCount++; return; }
            if (c.current_owner === 'Admin' && (['Pending Verification', 'Complete'].includes(c.status) || isCandidateComplete(c))) fwdDeanCount++;
            if (c.current_owner === 'Admin' && c.status === 'Incomplete') fwdHodCount++;
            if (rankAwaitingAdminRelease(c)) releaseRankCount++;
            if (c.current_owner === 'Admin' && (['Eligible', 'Not Eligible', 'Marks Entered'].includes(c.status) || (c.status_reason && ['Eligible', 'Not Eligible'].includes(c.status_reason)))) returnDeanCount++;
        });
        _showBulkBtn('bulk-forward-btn',  'bulk-forward-count',  fwdDeanCount);
        _showBulkBtn('bulk-forward2-btn', 'bulk-forward2-count', fwdHodCount);
        _showBulkBtn('bulk-release-btn',  'bulk-release-count',  releaseRankCount);
        _showBulkBtn('bulk-return-btn',   'bulk-return-count',   returnDeanCount);
        _showBulkBtn('bulk-delete-btn',   'bulk-delete-count',   deleteCount);
        _showBulkBtn('bulk-return2-btn', 'bulk-return2-count', returnSelectionsCount);

    } else if (role === 'coordinator') {
        let fwdHodCount = 0, fwdDeanCount = 0, returnHodCount = 0, ranksHodCount = 0, selDeanCount = 0, returnSelCount = 0;
        checkedBoxes.forEach(cb => {
            const c = state.candidates.find(i => i.id === parseInt(cb.value));
            if (!c || rankAwaitingAdminRelease(c) || (c.current_owner !== 'RC' && c.current_owner !== 'Coordinator')) return;
            if (['Selection Finalized', 'Returned to RC (Guides)'].includes(c.status)) { selDeanCount++; returnSelCount++; return; }
            if (['Under RC Review', 'Returned to RC', 'Under Coordinator Review'].includes(c.status) && !c.status_reason && !isCandidateEligible(c) && !isCandidateIneligible(c)) fwdHodCount++;
            if (isCandidateEligible(c) || isCandidateIneligible(c) || c.status_reason || ['Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status)) {
                fwdDeanCount++;
                returnHodCount++;
            }
            
            if (['Selection Finalized', 'Returned to RC (Guides)'].includes(c.status)) { selDeanCount++; returnSelCount++; }
        });
        _showBulkBtn('bulk-forward-btn',  'bulk-forward-count',  fwdHodCount);
        _showBulkBtn('bulk-verify-btn',   'bulk-verify-count',   fwdDeanCount);
        _showBulkBtn('bulk-return-btn',   'bulk-return-count',   returnHodCount);
        _showBulkBtn('bulk-release-btn',  'bulk-release-count',  ranksHodCount);
        _showBulkBtn('bulk-admin-btn',    'bulk-admin-count',    selDeanCount);
        _showBulkBtn('bulk-return2-btn',  'bulk-return2-count',  returnSelCount);

    } else if (role === 'dean') {
        let fwdRcCount = 0, fwdAdminCount = 0, returnRcCount = 0, rankRcCount = 0, selAdminCount = 0, returnSelCount = 0;
        checkedBoxes.forEach(cb => {
            const c = state.candidates.find(i => i.id === parseInt(cb.value));
            if (!c || rankAwaitingAdminRelease(c) || c.current_owner !== 'Dean') return;
            if (['Under Dean Final Review', 'Returned to Dean (Final)'].includes(c.status)) { selAdminCount++; returnSelCount++; return; }
            if (['Under Dean Review', 'Under Dean Initial Review'].includes(c.status) && !c.status_reason && !isCandidateEligible(c) && !isCandidateIneligible(c)) fwdRcCount++;
            if (isCandidateEligible(c) || isCandidateIneligible(c) || c.status_reason || ['Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status)) {
                fwdAdminCount++;
                returnRcCount++;
            }
            
            if (['Under Dean Final Review', 'Returned to Dean (Final)'].includes(c.status)) { selAdminCount++; returnSelCount++; }
        });
        _showBulkBtn('bulk-forward-btn',  'bulk-forward-count',  fwdRcCount);
        _showBulkBtn('bulk-verify-btn',   'bulk-verify-count',   fwdAdminCount);
        _showBulkBtn('bulk-return-btn',   'bulk-return-count',   returnRcCount);
        _showBulkBtn('bulk-release-btn',  'bulk-release-count',  rankRcCount);
        _showBulkBtn('bulk-admin-btn',    'bulk-admin-count',    selAdminCount);
        _showBulkBtn('bulk-return2-btn',  'bulk-return2-count',  returnSelCount);

    } else if (role === 'hod') {
        let fwdRcCount = 0, selRcCount = 0;
        checkedBoxes.forEach(cb => {
            const c = state.candidates.find(i => i.id === parseInt(cb.value));
            if (!c || c.current_owner !== 'HOD') return;
            if (['HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status)) fwdRcCount++;
            if (['Guide Allocated', 'Guide Allocation Open', 'Returned to HOD (Guides)'].includes(c.status) && ['Selected', 'Not Selected'].includes(c.selection_status)) selRcCount++;
        });
        _showBulkBtn('bulk-forward-btn',  'bulk-forward-count',  fwdRcCount);
        _showBulkBtn('bulk-admin-btn',    'bulk-admin-count',    selRcCount);
    }
    for (const [key, btnId, countId] of bulkForwardButtons) {
        const button = document.getElementById(btnId);
        if (button) button.style.display = 'none';
        const count = _getCheckedIds(c => candidateBulkForwardKey(c) === key).length;
        _showBulkBtn(btnId, countId, count);
        if (button && count) button.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Bulk '+candidateBulkForwardAction(key).label+' (<span id="'+countId+'">'+count+'</span>)';
    }
}

function _showBulkBtn(btnId, countId, count) {
    if (count <= 0) return;
    const btn = document.getElementById(btnId);
    const cnt = document.getElementById(countId);
    if (btn) btn.style.display = 'inline-flex';
    if (cnt) cnt.innerText = count;
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK EXECUTE FUNCTIONS — each calls correct API
// ══════════════════════════════════════════════════════════════════════════════

function _getCheckedIds(filter) {
    return Array.from(document.querySelectorAll('.candidate-checkbox:checked'))
        .map(cb => parseInt(cb.value))
        .filter(id => filter(state.candidates.find(i => i.id === id)));
}

// Admin: forward Pending Verification → Dean
async function executeBulkForward() {
    return runCandidateBulkForward('forward');
}window.executeBulkForward = executeBulkForward;

// Admin: forward Incomplete → HOD directly
async function executeBulkForwardIncompleteHod() {
    return runCandidateBulkForward('incomplete');
}window.executeBulkForwardIncompleteHod = executeBulkForwardIncompleteHod;

// Second forward button — context-dependent
async function executeBulkForward2() {
    const role = state.user.role;
    if (['admin', 'super_admin'].includes(role)) {
        // Admin forward incomplete to HOD
        await executeBulkForwardIncompleteHod();
    } else if (role === 'coordinator') {
        // RC → Dean (after HOD)
        const ids = _getCheckedIds(c => c && (c.current_owner === 'RC' || c.current_owner === 'Coordinator') && (isCandidateEligible(c) || isCandidateIneligible(c) || c.status_reason || ['Under RC Review','Returned to RC','Under Coordinator Review','Verified Eligible','Verified Ineligible','HOD Verified Eligible','HOD Verified Ineligible'].includes(c.status)));
        if (!ids.length) return showToast('No forwardable candidates selected', 'error');
        try { await api('/api/rc/forward-to-dean', 'POST', { candidateIds: ids }); showToast('Forwarded to Dean.'); loadTabSpecificData(); }
        catch(e) { showToast(e.message, 'error'); }
    } else if (role === 'dean') {
        // Dean → Admin (eligibility finalised)
        const ids = _getCheckedIds(c => c && c.current_owner === 'Dean' && (isCandidateEligible(c) || isCandidateIneligible(c) || c.status_reason || ['Under Dean Review', 'Returned to Dean', 'Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status)));
        if (!ids.length) return showToast('No candidates ready to forward to Admin', 'error');
        try { await api('/api/dean/forward-eligibility-to-admin', 'POST', { candidateIds: ids }); showToast('Eligibility forwarded to Admin.'); loadTabSpecificData(); }
        catch(e) { showToast(e.message, 'error'); }
    }
}
window.executeBulkForward2 = executeBulkForward2;

// Verify forward (RC → Dean after HOD / Dean → Admin eligibility)
async function executeBulkVerifyForward() {
    return runCandidateBulkForward('eligibility');
}window.executeBulkVerifyForward = executeBulkVerifyForward;

// Return with remark — context-dependent
async function executeBulkReturn() {
    const role = state.user.role;
    if (role === 'coordinator') {
        const ids = _getCheckedIds(c => c && (c.current_owner === 'RC' || c.current_owner === 'Coordinator'));
        if (!ids.length) return showToast('No candidates selected', 'error');
        showRemarkModal('Return to HOD with Query', 'Describe the issue or query for the HOD...', async (remark) => {
            try { await api('/api/rc/return-to-hod', 'POST', { candidateIds: ids, remark }); showToast('Returned to HOD with query.'); loadTabSpecificData(); }
            catch(e) { showToast(e.message, 'error'); }
        });
    } else if (role === 'dean') {
        const ids = _getCheckedIds(c => c && c.current_owner === 'Dean');
        if (!ids.length) return showToast('No candidates selected', 'error');
        showRemarkModal('Return to RC with Query', 'Describe the issue or query for the RC...', async (remark) => {
            try { await api('/api/dean/return-to-rc', 'POST', { candidateIds: ids, remark }); showToast('Returned to RC with query.'); loadTabSpecificData(); }
            catch(e) { showToast(e.message, 'error'); }
        });
    } else if (['admin', 'super_admin'].includes(role)) {
        const ids = _getCheckedIds(c => c && c.current_owner === 'Admin' && (['Eligible','Not Eligible', 'Marks Entered'].includes(c.status) || (c.status_reason && ['Eligible', 'Not Eligible'].includes(c.status_reason))));
        if (!ids.length) return showToast('No eligible/ineligible candidates selected', 'error');
        showRemarkModal('Return to Dean with Query', 'Describe your query or concern...', async (remark) => {
            try { await api('/api/admin/return-to-dean', 'POST', { candidateIds: ids, remark }); showToast('Returned to Dean with query.'); loadTabSpecificData(); }
            catch(e) { showToast(e.message, 'error'); }
        });
    }
}
window.executeBulkReturn = executeBulkReturn;

// Department-level rank generation for Admin
async function generateDeptRanks(deptId, deptName) {
    if (!confirm(`Are you sure you want to generate ranks for Department of ${deptName}?`)) return;
    try {
        const res = await api('/api/admin/generate-ranks', 'POST', { department_id: deptId, campus_id:state.activeCandidateCampus });
        showToast(res.message || `Ranks generated for ${deptName}.`);
        state.activeCandidateFilter='Ranked';
        loadTabSpecificData();
    } catch(err) {
        showToast(err.message, 'error');
    }
}
window.generateDeptRanks = generateDeptRanks;

// Explicit Rank Release Chain: Admin -> Dean -> RC -> HOD
async function executeRankedBulkRelease() {
    return runCandidateBulkForward('ranks');
}window.executeRankedBulkRelease = executeRankedBulkRelease;

// Phase 2: selections forward
async function executeRankedBulkForwardAdmin() {
    return runCandidateBulkForward('selections');
}window.executeRankedBulkForwardAdmin = executeRankedBulkForwardAdmin;

// Phase 2: return selections with remark
async function executeBulkReturn2() {
    const role = state.user.role;
    if (role === 'dean') {
        const ids = _getCheckedIds(c => c && c.current_owner === 'Dean' && ['Under Dean Final Review', 'Returned to Dean (Final)'].includes(c.status));
        if (!ids.length) return showToast('No selections to return', 'error');
        showRemarkModal('Return Guide Selections to RC with Query', 'Describe the issue with the guide selections...', async (remark) => {
            try { await api('/api/dean/return-selections-to-rc', 'POST', { candidateIds: ids, remark }); showToast('Selections returned to RC with query.'); loadTabSpecificData(); }
            catch(e) { showToast(e.message, 'error'); }
        });
    } else if (role === 'coordinator') {
        const ids = _getCheckedIds(c => c && c.current_owner === 'RC' && ['Selection Finalized','Returned to RC (Guides)'].includes(c.status));
        if (!ids.length) return showToast('No selections to return', 'error');
        showRemarkModal('Return Guide Selections to HOD with Query', 'Describe the issue with the guide allocations...', async (remark) => {
            try { await api('/api/rc/return-selections-to-hod', 'POST', { candidateIds: ids, remark }); showToast('Selections returned to HOD with query.'); loadTabSpecificData(); }
            catch(e) { showToast(e.message, 'error'); }
        });
    } else if (['admin', 'super_admin'].includes(role)) {
        const ids = _getCheckedIds(c => c && c.current_owner === 'Admin' && c.status === 'Approved Guides');
        if (!ids.length) return showToast('No approved guides to return', 'error');
        showRemarkModal('Return Guide Selections to Dean with Query', 'Describe your query or concern...', async (remark) => {
            try { await api('/api/admin/return-selections-to-dean', 'POST', { candidateIds: ids, remark }); showToast('Returned to Dean with query.'); loadTabSpecificData(); }
            catch(e) { showToast(e.message, 'error'); }
        });
    }
}
window.executeBulkReturn2 = executeBulkReturn2;

// Admin forward ranked to Dean (Phase 2)
async function forwardRanksToRc(candidateIds) {
    try {
        await api('/api/admin/generate-ranks', 'POST');
        await api('/api/admin/release-ranks-to-all', 'POST', { candidateIds });
        showToast('Ranks generated and released to all relevant users.');
        loadTabSpecificData();
    } catch(err) { showToast(err.message, 'error'); }
}
window.forwardRanksToRc = forwardRanksToRc;

// HOD forward to RC (eligibility)
async function forwardHodToRc(candidateIds) {
    try {
        await api('/api/hod/forward-to-rc', 'POST', { candidateIds });
        showToast('Candidates forwarded to Research Coordinator.');
        loadTabSpecificData();
    } catch(err) { showToast(err.message, 'error'); }
}
window.forwardHodToRc = forwardHodToRc;

// HOD forward selections to RC (Phase 2)
async function forwardSelectionsToCoordinator(candidateId) {
    const body = candidateId ? { candidateIds: [candidateId] } : { candidateIds: [] };
    try {
        const res = await api('/api/hod/forward-selections-to-rc', 'POST', body);
        showToast(res.message || 'Selections forwarded to RC.');
        loadTabSpecificData();
    } catch(err) { showToast(err.message, 'error'); }
}
window.forwardSelectionsToCoordinator = forwardSelectionsToCoordinator;

// Legacy aliases kept for backward compatibility with any inline onclick handlers
async function returnToHod(candidateIds) {
    showRemarkModal('Return to HOD with Query', 'Describe the issue or query...', async (remark) => {
        try { await api('/api/rc/return-to-hod', 'POST', { candidateIds, remark }); showToast('Returned to HOD.'); loadTabSpecificData(); }
        catch(e) { showToast(e.message, 'error'); }
    });
}
window.returnToHod = returnToHod;

async function returnToCoordinator(candidateIds) {
    showRemarkModal('Return to RC with Query', 'Describe the issue or query...', async (remark) => {
        try { await api('/api/admin/return-to-dean', 'POST', { candidateIds, remark }); showToast('Returned.'); loadTabSpecificData(); }
        catch(e) { showToast(e.message, 'error'); }
    });
}
window.returnToCoordinator = returnToCoordinator;

async function forwardSelectionToDean(candidateIds) {
    try { await api('/api/rc/forward-selections-to-dean', 'POST', { candidateIds }); showToast('Selections forwarded to Dean.'); loadTabSpecificData(); }
    catch(e) { showToast(e.message, 'error'); }
}
window.forwardSelectionToDean = forwardSelectionToDean;

async function forwardRanksToHod(candidateIds) {
    try { await api('/api/rc/forward-ranks-to-hod', 'POST', { candidateIds }); showToast('Ranks forwarded to HODs.'); loadTabSpecificData(); }
    catch(e) { showToast(e.message, 'error'); }
}
window.forwardRanksToHod = forwardRanksToHod;

async function generateRanksAndRelesae() {
    try {
        await api('/api/admin/generate-ranks', 'POST');
        showToast('Ranks generated. Use Release Ranks to All to open HoD selection.');
        loadTabSpecificData();
    } catch(err) { showToast(err.message, 'error'); }
}

async function forwardDeanToAdmin(candidateIds) {
    try { await api('/api/dean/forward-eligibility-to-admin', 'POST', { candidateIds }); showToast('Forwarded to Admin.'); loadTabSpecificData(); }
    catch(e) { showToast(e.message, 'error'); }
}
async function returnDeanToRc(candidateIds) {
    showRemarkModal('Return to RC with Query', 'Describe your query...', async (remark) => {
        try { await api('/api/dean/return-to-rc', 'POST', { candidateIds, remark }); showToast('Returned to RC.'); loadTabSpecificData(); }
        catch(e) { showToast(e.message, 'error'); }
    });
}
async function forwardDeanSelectionsToAdmin(candidateIds) {
    try { await api('/api/dean/forward-selections-to-admin', 'POST', { candidateIds }); showToast('Forwarded to Admin.'); loadTabSpecificData(); }
    catch(e) { showToast(e.message, 'error'); }
}
async function returnDeanSelectionsToRc(candidateIds) {
    showRemarkModal('Return Selections to RC with Query', 'Describe your query...', async (remark) => {
        try { await api('/api/dean/return-selections-to-rc', 'POST', { candidateIds, remark }); showToast('Returned selections to RC.'); loadTabSpecificData(); }
        catch(e) { showToast(e.message, 'error'); }
    });
}
window.forwardDeanToAdmin = forwardDeanToAdmin;
window.returnDeanToRc = returnDeanToRc;
window.forwardDeanSelectionsToAdmin = forwardDeanSelectionsToAdmin;
window.returnDeanSelectionsToRc = returnDeanSelectionsToRc;

async function changeSelectionStatus(candidateId, status) {
    if (!status) return;
    try {
        const res = await api(`/api/hod/candidates/${candidateId}/selection`, 'POST', { selection_status: status });
        showToast(res.message || 'Selection status updated successfully.');
        await loadTabSpecificData();
    } catch (err) { showToast(err.message || 'Failed to update selection status', 'error'); }
}
window.changeSelectionStatus = changeSelectionStatus;

window.toggleSelectAllCandidates = toggleSelectAllCandidates;
window.updateBulkActionVisibility = updateBulkActionVisibility;
window.updateRankedBulkActionVisibility = updateBulkActionVisibility;
window.toggleSelectAllRanked = toggleSelectAllCandidates;
window.handleSort = handleSort;
window.getSortIcon = getSortIcon;
window.sortCandidatesList = sortCandidatesList;
window.showRemarkModal = showRemarkModal;

function sortCandidatesList(list) {
    const sorted = [...list];
    const col = state.sortColumn;
    const order = state.sortOrder;
    
    if (col) {
        sorted.sort((a, b) => {
            let valA = a[col];
            let valB = b[col];
            
            // Treat null/undefined values consistently (put at the end)
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            
            if (typeof valA === 'string') {
                return order === 'asc' 
                    ? valA.localeCompare(valB) 
                    : valB.localeCompare(valA);
            } else {
                return order === 'asc' 
                    ? valA - valB 
                    : valB - valA;
            }
        });
    } else {
        // Default sort: Rankwise (rank ascending, nulls at the bottom)
        // If rank is identical/null, sort by score descending.
        sorted.sort((a, b) => {
            const rA = a.rank;
            const rB = b.rank;
            
            if (rA !== null && rA !== undefined && rB !== null && rB !== undefined) {
                if (rA !== rB) return rA - rB;
            } else if (rA !== null && rA !== undefined) {
                return -1;
            } else if (rB !== null && rB !== undefined) {
                return 1;
            }
            
            // Fallback to score descending
            const sA = a.total_marks || 0;
            const sB = b.total_marks || 0;
            return sB - sA;
        });
    }
    return sorted;
}

function handleSort(col) {
    if (state.sortColumn === col) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortColumn = col;
        state.sortOrder = 'asc';
    }
    renderCandidatesTable();
}

function getSortIcon(col) {
    if (state.sortColumn === col) {
        return state.sortOrder === 'asc' 
            ? ' <i class="fa-solid fa-arrow-up-1-9" style="color: var(--primary); margin-left: 4px;"></i>' 
            : ' <i class="fa-solid fa-arrow-down-9-1" style="color: var(--primary); margin-left: 4px;"></i>';
    }
    return ' <i class="fa-solid fa-sort" style="color: var(--text-muted); opacity: 0.5; margin-left: 4px;"></i>';
}

// Bind to window scope for inline HTML onclick attributes
window.toggleSelectAllCandidates = toggleSelectAllCandidates;
window.updateBulkActionVisibility = updateBulkActionVisibility;
window.executeBulkForward = executeBulkForward;
window.executeBulkVerifyForward = executeBulkVerifyForward;
window.toggleSelectAllRanked = toggleSelectAllCandidates;
window.updateRankedBulkActionVisibility = updateBulkActionVisibility;
window.executeRankedBulkRelease = executeRankedBulkRelease;
window.executeRankedBulkForwardAdmin = executeRankedBulkForwardAdmin;
window.forwardRanksToHod = forwardRanksToHod;
window.forwardSelectionToDean = forwardSelectionToDean;
window.handleSort = handleSort;
window.getSortIcon = getSortIcon;
window.sortCandidatesList = sortCandidatesList;
window.returnToHod = returnToHod;
window.returnToCoordinator = returnToCoordinator;

async function forwardCandidates(candidateIds) {
    try {
        await api('/api/candidates/forward', 'POST', { candidateIds });
        showToast('Candidates forwarded successfully down the workflow chain.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function forwardVerifiedToDean(candidateIds) {
    try {
        await api('/api/coordinator/forward-to-dean', 'POST', { candidateIds });
        showToast('Candidate verification reports forwarded to Dean.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function returnToHod(candidateIds) {
    try {
        await api('/api/coordinator/return-to-hod', 'POST', { candidateIds });
        showToast('Returned candidate(s) to HOD for correction.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function returnToCoordinator(candidateIds) {
    try {
        await api('/api/admin/return-to-coordinator', 'POST', { candidateIds });
        showToast('Returned candidate(s) to Coordinator for correction.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function forwardRanksToHod(candidateIds = null) {
    try {
        await api('/api/coordinator/forward-ranks-to-hod', 'POST', { candidateIds });
        showToast('Ranks forwarded to HODs for guide allocation.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function forwardSelectionToDean(candidateIds = null) {
    try {
        await api('/api/coordinator/forward-selections-to-dean', 'POST', { candidateIds });
        showToast('Guide selections forwarded to Dean.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function changeSelectionStatus(candidateId, status) {
    if (!status) return;
    try {
        const res = await api(`/api/hod/candidates/${candidateId}/selection`, 'POST', { selection_status: status });
        showToast(res.message || 'Selection status updated successfully.');
        await loadTabSpecificData();
    } catch (err) {
        showToast(err.message || 'Failed to update selection status', 'error');
    }
}
window.changeSelectionStatus = changeSelectionStatus;

async function forwardSelectionsToCoordinator(candidateId) {
    try {
        const body = candidateId ? { candidateIds: [candidateId] } : {};
        const res = await api('/api/hod/forward-selections', 'POST', body);
        showToast(res.message || 'Selections forwarded to Coordinator.');
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.forwardSelectionsToCoordinator = forwardSelectionsToCoordinator;

// ══════════════════════════════════════════════════════════════════════════════
// TWO-TIER CANDIDATE VERIFICATION REMINDERS (UI)
// 1. Admin: Review and send consolidated emails to Deans/VPs (CC to RC)
// 2. Dean / VP / RC: Review and send department-wise emails to HODs (cross-CC)
// ══════════════════════════════════════════════════════════════════════════════

function safeEmailText(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────────────
// TIER 1: ADMIN CONSOLIDATED REMINDER MODAL (WITH CONTENT PREVIEW)
// ──────────────────────────────────────────────────────────────────────────────
async function openAdminDeanReminderModal() {
    const existing = document.getElementById('admin-dean-remind-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'admin-dean-remind-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 680px; width: 95%;">
            <div class="modal-header">
                <h3 style="display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-paper-plane" style="color:#7c3aed;"></i>
                    Consolidated Reminders to Deans / VPs & Coordinators
                </h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body" id="admin-dean-modal-body" style="padding: 1.5rem;">
                <div style="text-align:center; padding: 2.5rem 1rem;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x" style="color:#7c3aed;"></i>
                    <p style="margin-top:12px; color:var(--text-secondary); font-size:0.9rem;">
                        Fetching pending verifications and compiling email drafts...
                    </p>
                </div>
            </div>
            <div class="modal-footer" id="admin-dean-modal-footer" style="display:flex; justify-content:flex-end; gap: 10px; padding: 1rem 1.5rem; border-top: 1px solid var(--glass-border);">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    try {
        const res = await api('/api/admin/remind-deans/preview', 'GET');
        const bodyEl = document.getElementById('admin-dean-modal-body');
        const footerEl = document.getElementById('admin-dean-modal-footer');

        if (!res.drafts || res.drafts.length === 0) {
            bodyEl.innerHTML = `
                <div style="text-align:center; padding: 2rem 1rem;">
                    <i class="fa-solid fa-circle-check" style="font-size:3rem; color:var(--success); margin-bottom:12px;"></i>
                    <h4 style="margin:0 0 6px 0; color:var(--text-primary);">All HOD Verifications Complete</h4>
                    <p style="color:var(--text-muted); font-size:0.9rem; margin:0;">
                        There are currently no candidates pending HOD eligibility review in your campus. No reminders needed!
                    </p>
                </div>
            `;
            return;
        }

        // Store drafts on window for switching tabs
        window.__adminReminderDrafts = res.drafts;

        bodyEl.innerHTML = `
            <div style="background: rgba(124, 58, 237, 0.08); border: 1px solid rgba(124, 58, 237, 0.25); border-radius: 10px; padding: 12px 16px; margin-bottom: 1.2rem;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color: var(--text-primary); font-size: 0.95rem;">
                            <i class="fa-solid fa-envelope-open-text" style="color:#7c3aed; margin-right:6px;"></i>
                            Review Email Content Before Sending
                        </strong>
                        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 3px;">
                            ${res.total_pending} candidate(s) pending across ${res.drafts.length} faculty/institution(s). Please review each email draft below.
                        </div>
                    </div>
                    <span class="badge" style="background:#7c3aed; color:#fff; font-size:0.8rem; padding: 4px 10px; border-radius:12px;">
                        ${res.drafts.length} Draft(s)
                    </span>
                </div>
            </div>

            <!-- Tab Buttons -->
            <div style="display:flex; gap: 8px; margin-bottom: 1rem; overflow-x: auto; padding-bottom: 4px;" id="admin-draft-tabs">
                ${res.drafts.map((d, idx) => `
                    <button type="button" class="btn ${idx === 0 ? 'btn-primary' : 'btn-secondary'} admin-draft-tab-btn"
                        id="admin-tab-btn-${idx}"
                        onclick="switchAdminDraftTab(${idx})"
                        style="font-size:0.8rem; padding: 6px 12px; white-space: nowrap; border-radius: 8px; display:flex; align-items:center; gap:6px;">
                        <i class="fa-solid fa-building-columns"></i>
                        <span>${safeEmailText(d.institution_name)}</span>
                        <span class="badge" style="background:${idx === 0 ? '#fff' : 'rgba(124,58,237,0.15)'}; color:${idx === 0 ? '#7c3aed' : 'var(--text-primary)'}; font-size:0.72rem; padding:1px 6px; border-radius:8px;">${d.candidate_count}</span>
                    </button>
                `).join('')}
            </div>

            <!-- Draft Content Cards -->
            <div id="admin-draft-cards">
                ${res.drafts.map((d, idx) => `
                    <div id="admin-draft-card-${idx}" class="admin-draft-card" style="display: ${idx === 0 ? 'block' : 'none'}; border: 1px solid var(--glass-border); border-radius: 10px; padding: 14px; background: rgba(0,0,0,0.02);">
                        <div style="display:flex; flex-direction:column; gap: 8px; margin-bottom: 12px; font-size:0.85rem;">
                            <div style="display:flex; align-items:center;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">FROM:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.from_name)}</span>
                                <span style="color:var(--text-secondary); margin-left:6px;">&lt;${safeEmailText(d.from_email)}&gt;</span>
                                <span class="badge" style="background:rgba(16,185,129,0.15); color:var(--success); font-size:0.7rem; padding:2px 6px; border-radius:6px; margin-left:8px;">
                                    <i class="fa-solid fa-check-circle"></i> Saved Sender Account
                                </span>
                            </div>
                            <div style="display:flex; align-items:center;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">TO:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.to_name)}</span>
                                <span style="color:#7c3aed; font-weight:600; margin-left:6px;">&lt;${safeEmailText(d.to_email)}&gt;</span>
                                <span class="badge" style="background:rgba(124,58,237,0.15); color:#7c3aed; font-size:0.7rem; padding:2px 6px; border-radius:6px; margin-left:8px;">
                                    <i class="fa-solid fa-user-tie"></i> Saved Dean/VP Email
                                </span>
                            </div>
                            <div style="display:flex; align-items:center;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">CC:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.cc_name)}</span>
                                <span style="color:#2563eb; font-weight:600; margin-left:6px;">&lt;${safeEmailText(d.cc_email)}&gt;</span>
                                <span class="badge" style="background:rgba(37,99,235,0.15); color:#2563eb; font-size:0.7rem; padding:2px 6px; border-radius:6px; margin-left:8px;">
                                    <i class="fa-solid fa-users"></i> Saved Coordinator Email
                                </span>
                            </div>
                            <div style="display:flex; align-items:flex-start; margin-top:4px;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">SUBJECT:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.subject)}</span>
                            </div>
                        </div>

                        <!-- Email Body Box -->
                        <div style="position:relative;">
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                                <i class="fa-solid fa-file-lines"></i> Email Message Content (As will be delivered):
                            </div>
                            <div style="background: var(--bg-primary); border: 1px solid var(--glass-border); border-radius: 8px; padding: 12px; font-family: monospace, monospace; font-size: 0.82rem; white-space: pre-wrap; color: var(--text-primary); max-height: 220px; overflow-y: auto; line-height: 1.55; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">${safeEmailText(d.body)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div id="admin-dean-send-result" style="display:none; margin-top:1rem;"></div>
        `;

        footerEl.innerHTML = `
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button id="admin-send-emails-btn" class="btn" onclick="executeAdminDeanReminder(this, ${res.drafts.length})"
                style="background: linear-gradient(135deg, #7c3aed, #a855f7); color:#fff; border:none; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-paper-plane"></i> Send Consolidated Emails (${res.drafts.length})
            </button>
        `;
    } catch (err) {
        document.getElementById('admin-dean-modal-body').innerHTML = `
            <div style="background: rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:1rem; color:var(--danger); font-size:0.9rem;">
                <i class="fa-solid fa-circle-xmark"></i> Failed to generate preview: ${err.message}
            </div>
        `;
    }
}

function switchAdminDraftTab(selectedIdx) {
    const drafts = window.__adminReminderDrafts || [];
    drafts.forEach((_, idx) => {
        const card = document.getElementById(`admin-draft-card-${idx}`);
        const btn = document.getElementById(`admin-tab-btn-${idx}`);
        if (card) card.style.display = (idx === selectedIdx) ? 'block' : 'none';
        if (btn) {
            if (idx === selectedIdx) {
                btn.className = 'btn btn-primary admin-draft-tab-btn';
            } else {
                btn.className = 'btn btn-secondary admin-draft-tab-btn';
            }
        }
    });
}
window.switchAdminDraftTab = switchAdminDraftTab;
window.openAdminDeanReminderModal = openAdminDeanReminderModal;

async function executeAdminDeanReminder(btn, draftsCount) {
    const resultDiv = document.getElementById('admin-dean-send-result');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Emails...';

    try {
        const res = await api('/api/admin/remind-deans', 'POST');
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); border-radius: 10px; padding: 1rem;">
                <p style="margin:0; font-weight:600; color: var(--success);">
                    <i class="fa-solid fa-circle-check"></i> Consolidated Reminders Sent Successfully!
                </p>
                <ul style="margin: 0.5rem 0 0; padding-left: 1.2rem; font-size:0.85rem; color:var(--text-secondary); line-height:1.5;">
                    <li>Faculties / Deans notified: <strong>${res.institutions_count || draftsCount}</strong> (Research Coordinators CC'd)</li>
                    <li>Total pending candidates covered: <strong>${res.total_pending || 0}</strong></li>
                    <li>Delivered directly to saved Dean & Coordinator accounts: <strong>${res.deans_sent || 0}</strong> ${res.logged > 0 ? `(${res.logged} logged)` : ''}</li>
                </ul>
                <p style="margin: 0.5rem 0 0; font-size:0.8rem; color:var(--text-muted);">
                    <i class="fa-solid fa-clock-rotate-left"></i> Full dispatch records have been archived in <strong>Email Logs</strong>.
                </p>
            </div>
        `;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Sent';
        showToast(res.message || 'Consolidated reminder emails sent successfully!', 'success');
    } catch (err) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `<div style="background: rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:0.8rem; color:var(--danger); font-size:0.85rem;"><i class="fa-solid fa-circle-xmark"></i> ${err.message}</div>`;
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Retry';
    }
}
window.executeAdminDeanReminder = executeAdminDeanReminder;


// ──────────────────────────────────────────────────────────────────────────────
// TIER 2: DEAN / VP / RC DEPARTMENT-WISE REMINDER MODAL (WITH CONTENT PREVIEW)
// ──────────────────────────────────────────────────────────────────────────────
async function openFacultyHodReminderModal() {
    const existing = document.getElementById('faculty-hod-remind-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'faculty-hod-remind-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 680px; width: 95%;">
            <div class="modal-header">
                <h3 style="display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-bell" style="color:#a855f7;"></i>
                    Send Department-wise Reminder Emails to HODs
                </h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body" id="faculty-hod-modal-body" style="padding: 1.5rem;">
                <div style="text-align:center; padding: 2.5rem 1rem;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x" style="color:#a855f7;"></i>
                    <p style="margin-top:12px; color:var(--text-secondary); font-size:0.9rem;">
                        Fetching department verifications and preparing drafts...
                    </p>
                </div>
            </div>
            <div class="modal-footer" id="faculty-hod-modal-footer" style="display:flex; justify-content:flex-end; gap: 10px; padding: 1rem 1.5rem; border-top: 1px solid var(--glass-border);">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    try {
        const res = await api('/api/faculty/remind-hods/preview', 'GET');
        const bodyEl = document.getElementById('faculty-hod-modal-body');
        const footerEl = document.getElementById('faculty-hod-modal-footer');

        if (!res.drafts || res.drafts.length === 0) {
            bodyEl.innerHTML = `
                <div style="text-align:center; padding: 2rem 1rem;">
                    <i class="fa-solid fa-circle-check" style="font-size:3rem; color:var(--success); margin-bottom:12px;"></i>
                    <h4 style="margin:0 0 6px 0; color:var(--text-primary);">All HOD Verifications Complete</h4>
                    <p style="color:var(--text-muted); font-size:0.9rem; margin:0;">
                        All HODs in your faculty have completed their candidate eligibility checks. No reminders needed!
                    </p>
                </div>
            `;
            return;
        }

        window.__facultyReminderDrafts = res.drafts;

        bodyEl.innerHTML = `
            <div style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 10px; padding: 12px 16px; margin-bottom: 1.2rem;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color: var(--text-primary); font-size: 0.95rem;">
                            <i class="fa-solid fa-envelope-open-text" style="color:#a855f7; margin-right:6px;"></i>
                            Review Department HOD Emails Before Sending
                        </strong>
                        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 3px;">
                            ${res.total_pending} candidate(s) pending across ${res.drafts.length} department(s). Each HOD will receive their specific candidate list.
                        </div>
                    </div>
                    <span class="badge" style="background:#a855f7; color:#fff; font-size:0.8rem; padding: 4px 10px; border-radius:12px;">
                        ${res.drafts.length} Department(s)
                    </span>
                </div>
            </div>

            <!-- Tab Buttons -->
            <div style="display:flex; gap: 8px; margin-bottom: 1rem; overflow-x: auto; padding-bottom: 4px;" id="faculty-draft-tabs">
                ${res.drafts.map((d, idx) => `
                    <button type="button" class="btn ${idx === 0 ? 'btn-primary' : 'btn-secondary'} faculty-draft-tab-btn"
                        id="faculty-tab-btn-${idx}"
                        onclick="switchFacultyDraftTab(${idx})"
                        style="font-size:0.8rem; padding: 6px 12px; white-space: nowrap; border-radius: 8px; display:flex; align-items:center; gap:6px;">
                        <i class="fa-solid fa-graduation-cap"></i>
                        <span>${safeEmailText(d.department_name)}</span>
                        <span class="badge" style="background:${idx === 0 ? '#fff' : 'rgba(168,85,247,0.15)'}; color:${idx === 0 ? '#a855f7' : 'var(--text-primary)'}; font-size:0.72rem; padding:1px 6px; border-radius:8px;">${d.candidate_count}</span>
                    </button>
                `).join('')}
            </div>

            <!-- Draft Content Cards -->
            <div id="faculty-draft-cards">
                ${res.drafts.map((d, idx) => `
                    <div id="faculty-draft-card-${idx}" class="faculty-draft-card" style="display: ${idx === 0 ? 'block' : 'none'}; border: 1px solid var(--glass-border); border-radius: 10px; padding: 14px; background: rgba(0,0,0,0.02);">
                        <div style="display:flex; flex-direction:column; gap: 8px; margin-bottom: 12px; font-size:0.85rem;">
                            <div style="display:flex; align-items:center;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">FROM:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.from_name)}</span>
                                <span style="color:var(--text-secondary); margin-left:6px;">&lt;${safeEmailText(d.from_email)}&gt;</span>
                                <span class="badge" style="background:rgba(16,185,129,0.15); color:var(--success); font-size:0.7rem; padding:2px 6px; border-radius:6px; margin-left:8px;">
                                    <i class="fa-solid fa-check-circle"></i> Saved Sender Account
                                </span>
                            </div>
                            <div style="display:flex; align-items:center;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">TO:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.to_name)}</span>
                                <span style="color:#a855f7; font-weight:600; margin-left:6px;">&lt;${safeEmailText(d.to_email)}&gt;</span>
                                <span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7; font-size:0.7rem; padding:2px 6px; border-radius:6px; margin-left:8px;">
                                    <i class="fa-solid fa-user-gear"></i> Saved HOD Email
                                </span>
                            </div>
                            <div style="display:flex; align-items:center;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">CC:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.cc_name || 'N/A')}</span>
                                ${d.cc_email ? `<span style="color:#2563eb; font-weight:600; margin-left:6px;">&lt;${safeEmailText(d.cc_email)}&gt;</span>` : ''}
                                <span class="badge" style="background:rgba(37,99,235,0.15); color:#2563eb; font-size:0.7rem; padding:2px 6px; border-radius:6px; margin-left:8px;">
                                    <i class="fa-solid fa-users"></i> ${state.user.role === 'dean' ? 'Research Coordinator' : 'Dean / VP'}
                                </span>
                            </div>
                            <div style="display:flex; align-items:flex-start; margin-top:4px;">
                                <span style="color:var(--text-muted); font-weight:600; width:75px;">SUBJECT:</span>
                                <span style="font-weight:600; color:var(--text-primary);">${safeEmailText(d.subject)}</span>
                            </div>
                        </div>

                        <!-- Email Body Box -->
                        <div style="position:relative;">
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                                <i class="fa-solid fa-file-lines"></i> Email Message Content (As will be delivered):
                            </div>
                            <div style="background: var(--bg-primary); border: 1px solid var(--glass-border); border-radius: 8px; padding: 12px; font-family: monospace, monospace; font-size: 0.82rem; white-space: pre-wrap; color: var(--text-primary); max-height: 220px; overflow-y: auto; line-height: 1.55; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">${safeEmailText(d.body)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div id="faculty-hod-send-result" style="display:none; margin-top:1rem;"></div>
        `;

        footerEl.innerHTML = `
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button id="faculty-send-emails-btn" class="btn" onclick="executeFacultyHodReminder(this, ${res.drafts.length})"
                style="background: linear-gradient(135deg, #7c3aed, #a855f7); color:#fff; border:none; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-bell"></i> Send HOD Reminders (${res.drafts.length})
            </button>
        `;
    } catch (err) {
        document.getElementById('faculty-hod-modal-body').innerHTML = `
            <div style="background: rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:1rem; color:var(--danger); font-size:0.9rem;">
                <i class="fa-solid fa-circle-xmark"></i> Failed to generate preview: ${err.message}
            </div>
        `;
    }
}

function switchFacultyDraftTab(selectedIdx) {
    const drafts = window.__facultyReminderDrafts || [];
    drafts.forEach((_, idx) => {
        const card = document.getElementById(`faculty-draft-card-${idx}`);
        const btn = document.getElementById(`faculty-tab-btn-${idx}`);
        if (card) card.style.display = (idx === selectedIdx) ? 'block' : 'none';
        if (btn) {
            if (idx === selectedIdx) {
                btn.className = 'btn btn-primary faculty-draft-tab-btn';
            } else {
                btn.className = 'btn btn-secondary faculty-draft-tab-btn';
            }
        }
    });
}
window.switchFacultyDraftTab = switchFacultyDraftTab;
window.openFacultyHodReminderModal = openFacultyHodReminderModal;

async function executeFacultyHodReminder(btn, draftsCount) {
    const resultDiv = document.getElementById('faculty-hod-send-result');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Emails...';

    try {
        const res = await api('/api/faculty/remind-hods', 'POST');
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); border-radius: 10px; padding: 1rem;">
                <p style="margin:0; font-weight:600; color: var(--success);">
                    <i class="fa-solid fa-circle-check"></i> Department Reminders Sent Successfully!
                </p>
                <ul style="margin: 0.5rem 0 0; padding-left: 1.2rem; font-size:0.85rem; color:var(--text-secondary); line-height:1.5;">
                    <li>HODs notified: <strong>${res.reminded || draftsCount}</strong> (cross-CC attached)</li>
                    <li>Total pending candidates covered: <strong>${res.total_pending || 0}</strong></li>
                    <li>Departments reminded: <strong>${res.dept_count || draftsCount}</strong></li>
                </ul>
                <p style="margin: 0.5rem 0 0; font-size:0.8rem; color:var(--text-muted);">
                    <i class="fa-solid fa-clock-rotate-left"></i> Full dispatch records have been archived in <strong>Email Logs</strong>.
                </p>
            </div>
        `;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Sent';
        showToast(res.message || 'Department reminder emails sent successfully!', 'success');
    } catch (err) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `<div style="background: rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:0.8rem; color:var(--danger); font-size:0.85rem;"><i class="fa-solid fa-circle-xmark"></i> ${err.message}</div>`;
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bell"></i> Retry';
    }
}
window.executeFacultyHodReminder = executeFacultyHodReminder;

// Backwards compatibility
function sendHodReminderEmail() {
    if (state.user.role === 'admin' || state.user.role === 'super_admin') {
        openAdminDeanReminderModal();
    } else {
        openFacultyHodReminderModal();
    }
}
window.sendHodReminderEmail = sendHodReminderEmail;

// Eligibility verification modal for HOD
async function verifyCandidateModal(candidateId) {
    try {
        const c = (state.candidates || []).find(item => item.id == candidateId);
        if (!c) {
            showToast('Candidate not found', 'error');
            return;
        }

        // Fetch candidate details & documents
        let docs = [];
        try {
            const res = await api(`/api/candidates/${candidateId}/documents`);
            docs = res.documents || [];
        } catch (e) {
            console.error('Could not fetch candidate documents', e);
        }

        let docsListHtml = docs.length === 0 
            ? '<p style="color:var(--text-muted); font-size:0.8rem; margin:0;">No documents uploaded yet.</p>'
            : docs.map(d => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 4px 8px; background: rgba(255,255,255,0.04); border-radius: 4px; margin-bottom: 4px;">
                    <span style="font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;">
                        <i class="fa-solid fa-file-pdf" style="color:#ef4444; margin-right:4px;"></i>${d.filename}
                    </span>
                    <a href="/api/documents/preview/${encodeURIComponent(d.filename)}" target="_blank" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:0.72rem; text-decoration:none;">
                        View <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                </div>
            `).join('');

        const dl = getDeadlineStatus('deadline_eligibility', 'Candidate Eligibility Verification');
        const isPastDeadline = dl.isPast;

        const modal = document.createElement('div');
        modal.className = 'modal-overlay animate-fade-in';
        modal.id = 'verify-candidate-modal';
        modal.innerHTML = `
            <div class="modal-card" style="max-width: 520px; width: 95%;">
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--glass-border); padding-bottom: 10px; margin-bottom: 14px;">
                    <h3 style="margin:0; font-size:1.15rem; color:var(--primary);"><i class="fa-solid fa-user-check"></i> Verify Candidate Eligibility</h3>
                    <button class="btn btn-secondary btn-close-modal" style="padding:4px 8px;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="modal-body" style="line-height: 1.5;">
                    ${dl.badgeHtml}

                    <div style="background: var(--bg-tertiary); padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; border: 1px solid var(--glass-border);">
                        <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary);">${c.registered_name}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                            App No: <strong>${c.application_no}</strong> | Mode: ${c.mode_of_study || '—'}
                        </div>
                    </div>

                    <div style="margin-bottom: 14px;">
                        <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); margin-bottom:6px; display:block;">Uploaded Documents</label>
                        <div style="max-height: 120px; overflow-y: auto; padding: 4px; background: rgba(0,0,0,0.15); border-radius: 6px; border: 1px solid var(--glass-border);">
                            ${docsListHtml}
                        </div>
                    </div>

                    ${isPastDeadline ? `
                        <div style="background-color: var(--bg-tertiary); padding: 1.25rem; border-radius: 8px; border: 1px dashed var(--glass-border); text-align: center; margin-bottom: 14px;">
                            <i class="fa-solid fa-lock" style="font-size: 1.8rem; color: var(--text-muted); margin-bottom: 0.5rem;"></i>
                            <h4 style="margin: 0 0 0.4rem 0;">Verification Locked</h4>
                            <p style="color: var(--text-secondary); margin: 0; font-size: 0.88rem;">The deadline for candidate eligibility verification passed on ${dl.dateStr}.</p>
                        </div>
                        <div style="display:flex; justify-content:flex-end; gap:8px;">
                            <button type="button" class="btn btn-secondary btn-close-modal" style="padding: 6px 14px;">Close</button>
                        </div>
                    ` : `
                    <form id="hod-verify-form">
                        <div class="form-group" style="margin-bottom: 12px;">
                            <label style="font-weight: 600; font-size: 0.85rem; display:block; margin-bottom: 6px;">Eligibility Verdict <span style="color:var(--danger)">*</span></label>
                            <div style="display:flex; gap: 20px; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--glass-border);">
                                <label style="display:flex; align-items:center; gap: 6px; cursor:pointer; font-size: 0.9rem;">
                                    <input type="radio" name="verify_eligibility" value="Eligible" ${c.status === 'HOD Verified Ineligible' ? '' : 'checked'} style="cursor:pointer;">
                                    <span style="color: var(--success); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Eligible</span>
                                </label>
                                <label style="display:flex; align-items:center; gap: 6px; cursor:pointer; font-size: 0.9rem;">
                                    <input type="radio" name="verify_eligibility" value="Not Eligible" ${c.status === 'HOD Verified Ineligible' ? 'checked' : ''} style="cursor:pointer;">
                                    <span style="color: var(--danger); font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> Not Eligible</span>
                                </label>
                            </div>
                        </div>

                        <div style="display:flex; gap: 10px; margin-bottom: 12px;">
                            <div class="form-group" style="flex:1;">
                                <label for="verify-pg" style="font-size:0.8rem;">PG Percentage (%)</label>
                                <input type="number" step="0.01" id="verify-pg" class="form-control" placeholder="e.g. 78.5" value="${c.pg_percentage || ''}">
                            </div>
                            <div class="form-group" style="flex:1;">
                                <label for="verify-ug" style="font-size:0.8rem;">UG Percentage (%)</label>
                                <input type="number" step="0.01" id="verify-ug" class="form-control" placeholder="e.g. 82.0" value="${c.ug_percentage || ''}">
                            </div>
                        </div>

                        <div class="form-group" style="margin-bottom: 16px;">
                            <label for="verify-reason" style="font-size:0.8rem; font-weight:600;">Remarks / Reason <span id="reason-req" style="color:var(--danger); display:none;">*</span></label>
                            <textarea id="verify-reason" class="form-control" rows="2" placeholder="Enter remarks or justification...">${transferEscape(c.status_reason || '')}</textarea>
                        </div>

                        <div style="display:flex; justify-content:flex-end; gap:8px;">
                            <button type="button" class="btn btn-secondary btn-close-modal" style="padding: 6px 14px;">Cancel</button>
                            <button type="submit" class="btn btn-primary" style="padding: 6px 18px;"><i class="fa-solid fa-check"></i> Save Verification</button>
                        </div>
                    </form>
                    `}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', () => modal.remove()));

        if (isPastDeadline) return;

        const form = modal.querySelector('#hod-verify-form');
        const reasonReq = modal.querySelector('#reason-req');
        const radios = form.querySelectorAll('input[name="verify_eligibility"]');

        const updateReq = () => {
            const val = form.querySelector('input[name="verify_eligibility"]:checked').value;
            if (val === 'Not Eligible') {
                reasonReq.style.display = 'inline';
            } else {
                reasonReq.style.display = 'none';
            }
        };
        radios.forEach(r => r.addEventListener('change', updateReq));
        updateReq();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const eligibility = form.querySelector('input[name="verify_eligibility"]:checked').value;
            const reason = document.getElementById('verify-reason').value;
            const pg_percentage = document.getElementById('verify-pg').value;
            const ug_percentage = document.getElementById('verify-ug').value;

            if (eligibility === 'Not Eligible' && !reason.trim()) {
                showToast('Please provide a reason for ineligibility.', 'error');
                return;
            }

            try {
                const res = await api(`/api/candidates/${candidateId}/verify`, 'POST', {
                    eligibility,
                    reason,
                    pg_percentage,
                    ug_percentage
                });
                showToast(res.message || `Eligibility status marked as ${eligibility}`);
                modal.remove();
                await loadTabSpecificData();
            } catch (err) {
                showToast(err.message || 'Failed to submit verification', 'error');
            }
        });
    } catch (err) {
        showToast(err.message || 'Error opening verification modal', 'error');
    }
}
window.verifyCandidateModal = verifyCandidateModal;

// Marks entry and exam attendance modal
async function markAttendanceModal(candidateId) {
    try {
        const data = await api(`/api/candidates/${candidateId}`);
        const c = data.candidate;
        const panel = data.panel;
        
        let supervisorsData = { supervisors: [] };
        if (c.department_id) {
            try {
                supervisorsData = await api(`/api/admin/supervisors/department/${c.department_id}`);
            } catch(e) { console.error("Could not load supervisors", e); }
        }
        const supervisors = supervisorsData.supervisors;
        const supervisorOptions = supervisors.map(s => `<option value="${s.name}">${s.name} (${s.designation})</option>`).join('');

        if (!c) return;

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        
        let interviewInputsHtml = '';
        let panelMembersCount = 3;
        
        if (panel && panel.members && panel.members.length > 0) {
            panelMembersCount = panel.members.length;
            interviewInputsHtml = panel.members.map((m, idx) => {
                const existingVal = c[`interview_marks_${idx + 1}`] !== null && c[`interview_marks_${idx + 1}`] !== undefined ? c[`interview_marks_${idx + 1}`] : '';
                return `
                    <div>
                        <label style="font-size:0.75rem; display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-bottom: 4px;" title="${m.name} (${m.designation})">
                            <strong>${m.name}</strong><br><span style="color:var(--text-muted)">${m.designation}</span>
                        </label>
                        <input type="number" id="int-${idx + 1}" class="form-control" min="0" max="30" step="0.5" value="${existingVal}">
                    </div>
                `;
            }).join('');
        } else {
            interviewInputsHtml = [1, 2, 3].map(i => {
                const existingVal = c[`interview_marks_${i}`] !== null && c[`interview_marks_${i}`] !== undefined ? c[`interview_marks_${i}`] : '';
                return `
                    <div>
                        <label style="font-size:0.75rem; display:block; margin-bottom: 4px;"><strong>Panelist ${i}</strong><br><span style="color:var(--text-muted)">Evaluation (30)</span></label>
                        <input type="number" id="int-${i}" class="form-control" min="0" max="30" step="0.5" value="${existingVal}">
                    </div>
                `;
            }).join('');
        }

        modal.innerHTML = `
            <div class="modal-content animate-fade-in-up" style="max-width: 550px;">
                <div class="modal-header">
                    <h3>Entrance Exam & Marks Entry</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="marks-entry-form">
                        <p style="font-size:0.9rem; margin-bottom: 1rem;">Candidate: <strong>${c.registered_name} (${c.application_no})</strong></p>
                        ${panel ? `<p style="font-size:0.85rem; color:var(--info); margin-bottom: 1rem;"><i class="fa-solid fa-users"></i> Assigned Panel: <strong>${panel.panel_name}</strong> (${panelMembersCount} Members)</p>` : ''}
                        
                        <div class="form-group">
                            <label for="exam-attendance">Attendance Status</label>
                            <select id="exam-attendance" class="form-control">
                                <option value="Absent" ${c.exam_attendance === 'Absent' ? 'selected' : ''}>Absent</option>
                                <option value="Present" ${c.exam_attendance === 'Present' ? 'selected' : ''}>Present</option>
                                <option value="Exempted" ${c.exam_attendance === 'Exempted' ? 'selected' : ''}>Exempted (NET/GATE)</option>
                            </select>
                        </div>

                        <div id="marks-fields-panel" style="display: ${c.exam_attendance === 'Absent' ? 'none' : 'block'};">
                            <div class="form-group" id="written-marks-group" style="display: ${c.exam_attendance === 'Exempted' ? 'none' : 'block'};">
                                <label for="written-marks">Written Exam Mark (Out of 50)</label>
                                <input type="number" id="written-marks" class="form-control" min="0" max="50" step="0.5" value="${c.written_marks !== null && c.written_marks !== undefined ? c.written_marks : ''}">
                            </div>
                            <div class="form-group">
                                <label style="margin-bottom: 8px; display:block;">Interview Evaluation Marks (Out of 30)</label>
                                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-top: 6px;">
                                    ${interviewInputsHtml}
                                </div>
                            </div>
                            
                            <hr style="border-color: var(--glass-border); margin: 15px 0;">
                            
                            <div class="form-group">
                                <label style="margin-bottom: 8px; display:block;">Candidate Preferences (Optional)</label>
                                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                                    <div>
                                        <label for="pref-1" style="font-size:0.75rem; color:var(--text-muted);">First Preference</label>
                                        <select id="pref-1" class="form-control">
                                            <option value="">-- Select Supervisor --</option>
                                            ${supervisorOptions}
                                        </select>
                                    </div>
                                    <div>
                                        <label for="pref-2" style="font-size:0.75rem; color:var(--text-muted);">Second Preference</label>
                                        <select id="pref-2" class="form-control">
                                            <option value="">-- Select Supervisor --</option>
                                            ${supervisorOptions}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <button type="submit" class="btn btn-primary" style="width:100%; margin-top:1.2rem;">
                            Save Exam Records <i class="fa-solid fa-floppy-disk"></i>
                        </button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const select = document.getElementById('exam-attendance');
        const marksPanel = document.getElementById('marks-fields-panel');
        const writtenGroup = document.getElementById('written-marks-group');

        select.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'Absent') {
                marksPanel.style.display = 'none';
            } else if (val === 'Exempted') {
                marksPanel.style.display = 'block';
                writtenGroup.style.display = 'none';
            } else {
                marksPanel.style.display = 'block';
                writtenGroup.style.display = 'block';
            }
        });

        document.getElementById('marks-entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const attendance = select.value;
            
            try {
                await api(`/api/admin/candidates/${candidateId}/attendance`, 'POST', { attendance });
                
                if (attendance !== 'Absent') {
                    const written_marks = document.getElementById('written-marks') ? document.getElementById('written-marks').value : '';
                    
                    const payload = {
                        written_marks,
                        interview_marks_1: document.getElementById('int-1') ? document.getElementById('int-1').value : '',
                        interview_marks_2: document.getElementById('int-2') ? document.getElementById('int-2').value : '',
                        interview_marks_3: document.getElementById('int-3') ? document.getElementById('int-3').value : '',
                        interview_marks_4: document.getElementById('int-4') ? document.getElementById('int-4').value : '',
                        interview_marks_5: document.getElementById('int-5') ? document.getElementById('int-5').value : '',
                        preference_1: document.getElementById('pref-1') ? document.getElementById('pref-1').value : '',
                        preference_2: document.getElementById('pref-2') ? document.getElementById('pref-2').value : ''
                    };

                    await api(`/api/admin/candidates/${candidateId}/marks`, 'POST', payload);
                }
                showToast('Exam records saved successfully.');
                modal.remove();
                loadTabSpecificData();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Assign guide / supervisor modal
async function assignSupervisorModal(candidateId) {
    const c = state.candidates.find(item => item.id === candidateId);
    if (!c) return;

    try {
        state.vacancies=(await api('/api/vacancies')).vacancies || [];
        const res = await api('/api/hod/supervisors');
        const supervisors = res.supervisors || [];

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        
        let guideSelectionHtml = '';
        const eligibleSupervisors = supervisors.filter(s => s.is_eligible === 'Yes');
        if (eligibleSupervisors.length > 0) {
            // Sort: available first, then full
            const sorted = [...eligibleSupervisors].sort((a, b) => {
                const limitA = Math.min(2, a.vacancy);
                const limitB = Math.min(2, b.vacancy);
                const sessionAvailA = Math.max(0, limitA - a.allocated_count);
                const sessionAvailB = Math.max(0, limitB - b.allocated_count);
                return sessionAvailB - sessionAvailA;
            });
            guideSelectionHtml = `
                <div class="form-group">
                    <label for="guide-select">Select Supervisor from Directory</label>
                    <select id="guide-select" class="form-control" onchange="onModalSupervisorSelect(this.value)" required>
                        <option value="">-- Choose Supervisor --</option>
                        ${sorted.map(s => {
                            const totalAvail = s.vacancy - s.allocated_count;
                            const sessionLimit = Math.min(2, s.vacancy);
                            const sessionAvail = Math.max(0, sessionLimit - s.allocated_count);
                            const isFull = totalAvail <= 0 || sessionAvail <= 0;
                            
                            let statusText = `Session: ${sessionAvail}/${sessionLimit} free | Total: ${totalAvail}/${s.vacancy} free`;
                            if (totalAvail <= 0) statusText = `⚠ No vacancies`;
                            else if (sessionAvail <= 0) statusText = `⚠ Session limit (${sessionLimit}) reached`;

                            let prefBadge = '';
                            const p1 = supervisorNameKey(c.preference_1);
                            const p2 = supervisorNameKey(c.preference_2);
                            const sLower = supervisorNameKey(s.name);
                            if (p1 && sLower === p1) prefBadge = ' ⭐ [1st Preference]';
                            else if (p2 && sLower === p2) prefBadge = ' 🥈 [2nd Preference]';
                            
                            return `<option value="${s.id}" data-name="${s.name.replace(/"/g, '&quot;')}" ${isFull ? 'disabled style="color:var(--text-muted);"' : ''} data-desg="${s.designation}">${s.name}${prefBadge} (${s.designation || 'Faculty'}) — ${statusText}</option>`;
                        }).join('')}
                        <option value="manual">── Enter Manually ──</option>
                    </select>
                    <p style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">Supervisors with no vacancies or who reached the 2-candidate session limit are shown as disabled.</p>
                </div>
            `;
        }

        const pref1Display = transferEscape(c.preference_1) || '<em style="color:var(--text-muted)">Not Specified</em>';
        const pref2Display = transferEscape(c.preference_2) || '<em style="color:var(--text-muted)">Not Specified</em>';

        modal.innerHTML = `
            <div class="modal-content animate-fade-in-up" style="max-width: 540px;">
                <div class="modal-header">
                    <h3>Assign Research Supervisor</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="assign-supervisor-form">
                        <p style="font-size:0.9rem; margin-bottom:0.75rem;">Candidate: <strong>${c.registered_name} (${c.application_no})</strong> — Rank: <strong>#${c.rank || 'N/A'}</strong></p>

                        <div style="background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25); border-radius: 8px; padding: 10px 12px; margin-bottom: 1rem; font-size: 0.85rem;">
                            <div style="font-weight:600; color:var(--primary); margin-bottom:4px;"><i class="fa-solid fa-list-check"></i> Candidate Preferences:</div>
                            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                                <span><strong>1st Preference:</strong></span>
                                <span style="font-weight:500;">${pref1Display}</span>
                            </div>
                            <div style="display:flex; justify-content:space-between;">
                                <span><strong>2nd Preference:</strong></span>
                                <span style="font-weight:500;">${pref2Display}</span>
                            </div>
                        </div>
                        
                        <p data-selection-limit="${Number(c.department_id)}" role="status">${selectionLimitText(c.department_id)}</p>
                        ${guideSelectionHtml}

                        <div id="manual-guide-fields" style="display: ${eligibleSupervisors.length > 0 ? 'none' : 'block'};">
                            <div class="form-group">
                                <label for="guide-name">Supervisor Name</label>
                                <input type="text" id="guide-name" class="form-control" placeholder="Dr. John Doe" oninput="window.checkSupervisorPreferenceMatch && window.checkSupervisorPreferenceMatch()">
                            </div>
                            <div class="form-group">
                                <label for="guide-desg">Designation</label>
                                <input type="text" id="guide-desg" class="form-control" placeholder="Professor">
                            </div>
                            <div class="form-group">
                                <label for="guide-aff">Affiliation</label>
                                <input type="text" id="guide-aff" class="form-control" placeholder="SRMIST">
                            </div>
                        </div>

                        <div class="form-group" style="margin-top: 1rem;">
                            <label for="allocation-remark" id="allocation-remark-label">Allocation Remark / Reason <span id="remark-asterisk" style="color:#ef4444; display:none;">*</span></label>
                            <textarea id="allocation-remark" class="form-control" rows="3" placeholder="Enter reason for supervisor allocation...">${transferEscape(c.allocation_remark || '')}</textarea>
                            <p id="allocation-remark-help" style="font-size:0.75rem; color:var(--text-muted); margin-top:3px;">Select a supervisor above to determine if remark is required.</p>
                        </div>

                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">
                            Allocate Supervisor <i class="fa-solid fa-circle-check"></i>
                        </button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        window.checkSupervisorPreferenceMatch = function() {
            const sel = document.getElementById('guide-select');
            const remarkAsterisk = document.getElementById('remark-asterisk');
            const remarkHelp = document.getElementById('allocation-remark-help');
            if (!remarkAsterisk || !remarkHelp) return;

            let selectedName = '';
            if (sel && sel.value && sel.value !== 'manual') {
                const opt = sel.options[sel.selectedIndex];
                selectedName = opt.getAttribute('data-name') || opt.text || '';
            } else {
                selectedName = (document.getElementById('guide-name') ? document.getElementById('guide-name').value : '') || '';
            }

            const p1 = supervisorNameKey(c.preference_1);
            const p2 = supervisorNameKey(c.preference_2);
            const cur = supervisorNameKey(selectedName);

            document.getElementById('allocation-remark').required = !!cur && !!(p1 || p2) && !(p1 ? cur === p1 : cur === p2);
            if (!cur) {
                remarkAsterisk.style.display = 'none';
                remarkHelp.style.color = 'var(--text-muted)';
                remarkHelp.innerText = 'Select a supervisor above to determine if remark is required.';
                return;
            }

            if (p1 && cur === p1) {
                remarkAsterisk.style.display = 'none';
                remarkHelp.style.color = 'var(--success)';
                remarkHelp.innerHTML = '<i class="fa-solid fa-circle-check"></i> Candidate\'s 1st preference selected. Remark is optional.';
            } else if (p1 && p2 && cur === p2) {
                remarkAsterisk.style.display = 'inline';
                remarkHelp.style.color = '#f59e0b';
                remarkHelp.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>2nd preference selected.</strong> Mandatory remark: Explain why 1st preference was not allotted (e.g., no vacancy, rank priority, etc.).';
            } else if ((p1 || p2) && !(p2 && !p1 && cur === p2)) {
                remarkAsterisk.style.display = 'inline';
                remarkHelp.style.color = '#ef4444';
                remarkHelp.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>Allocated outside candidate preferences.</strong> Mandatory remark: Explain why candidate was not allotted either preferred guide.';
            } else {
                remarkAsterisk.style.display = 'none';
                remarkHelp.style.color = 'var(--text-muted)';
                remarkHelp.innerText = 'Candidate has no preferences recorded. Remark is optional.';
            }
        };

        window.onModalSupervisorSelect = function(val) {
            const manualFields = document.getElementById('manual-guide-fields');
            
            if (val === 'manual' || !val) {
                manualFields.style.display = 'block';
                document.getElementById('guide-name').required = (val === 'manual');
                document.getElementById('guide-desg').required = (val === 'manual');
                document.getElementById('guide-aff').required = (val === 'manual');
            } else {
                manualFields.style.display = 'none';
                document.getElementById('guide-name').required = false;
                document.getElementById('guide-desg').required = false;
                document.getElementById('guide-aff').required = false;
            }
            window.checkSupervisorPreferenceMatch();
        };

        window.checkSupervisorPreferenceMatch();

        document.getElementById('assign-supervisor-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const selectVal = document.getElementById('guide-select') ? document.getElementById('guide-select').value : 'manual';
            let supervisor_id = null;
            let supervisor_name = '';
            let supervisor_designation = '';
            let supervisor_affiliation = '';

            if (selectVal && selectVal !== 'manual') {
                supervisor_id = parseInt(selectVal);
                const sel = document.getElementById('guide-select');
                supervisor_name = sel.options[sel.selectedIndex].getAttribute('data-name') || '';
                supervisor_designation = sel.options[sel.selectedIndex].getAttribute('data-desg') || '';
            } else {
                supervisor_name = document.getElementById('guide-name').value;
                supervisor_designation = document.getElementById('guide-desg').value;
                supervisor_affiliation = document.getElementById('guide-aff').value;
            }

            const remarkVal = (document.getElementById('allocation-remark').value || '').trim();
            const isRemarkRequired = document.getElementById('remark-asterisk').style.display !== 'none';

            if (isRemarkRequired && !remarkVal) {
                showToast('A remark / reason is mandatory when allocating a supervisor other than 1st preference.', 'error');
                document.getElementById('allocation-remark').focus();
                return;
            }

            if (!canSelectWithinAllotment(c)) return showToast('The department full-time with fellowship allotment is filled or not configured. Ask Super Admin to update it.', 'error');

            // Enforce rankwise warning check
            const deptCandidates = state.candidates.filter(item => 
                item.department_id === c.department_id && 
                ['Guide Allocation Open', 'Guide Allocated'].includes(item.status) && item.selection_status !== 'Not Selected'
            );
            
            const isFt = AdmissionStudyPolicy.isFullTimeApplicant(c);
            const rankPool = AdmissionStudyPolicy.classifyStudyMode(c);
            const higherUnallocated = deptCandidates.find(item => {
                if (AdmissionStudyPolicy.classifyStudyMode(item) !== rankPool) return false;
                
                const hasHigherRank = item.rank && c.rank && item.rank < c.rank;
                const notAllocated = !item.supervisor_name;
                
                return hasHigherRank && notAllocated;
            });

            if (higherUnallocated) {
                const proceed = confirm(`Warning: Candidate ${higherUnallocated.registered_name} (Rank #${higherUnallocated.rank}, ${isFt ? 'Full-Time' : 'Part-Time'}) has a higher rank and has not been allocated a guide yet. Are you sure you want to allocate a guide to ${c.registered_name} (Rank #${c.rank}) first?`);
                if (!proceed) return;
            }

            // Check if a higher-ranked candidate requested the same supervisor and hasn't been allotted yet
            if (supervisor_name) {
                const sLower = supervisor_name.trim().toLowerCase();
                const higherCandidateWithSamePref = deptCandidates.find(item => {
                    if (!item.rank || !c.rank || item.rank >= c.rank) return false;
                    if (item.supervisor_name) return false; // already allotted
                    const itemP1 = (item.preference_1 || '').toLowerCase();
                    const itemP2 = (item.preference_2 || '').toLowerCase();
                    return (itemP1 && supervisorNameKey(itemP1)===supervisorNameKey(sLower)) || (itemP2 && supervisorNameKey(itemP2)===supervisorNameKey(sLower));
                });

                if (higherCandidateWithSamePref) {
                    const confirmHigher = confirm(`Important Notice: Higher ranked candidate ${higherCandidateWithSamePref.registered_name} (Rank #${higherCandidateWithSamePref.rank}) also requested ${supervisor_name} as a preference and has not received an allocation yet. Are you sure you want to allot this supervisor to Rank #${c.rank}? (Please ensure justification is written in the remarks.)`);
                    if (!confirmHigher) return;
                }
            }

            try {
                await api('/api/hod/assign-supervisor', 'POST', {
                    candidate_id: candidateId,
                    supervisor_name,
                    supervisor_designation,
                    supervisor_affiliation,
                    supervisor_id,
                    allocation_remark: remarkVal
                });
                showToast('Supervisor successfully allocated.');
                modal.remove();
                loadTabSpecificData();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function executeBulkDelete() {
    const checkedBoxes = document.querySelectorAll('.candidate-checkbox:checked');
    const candidateIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
    
    if (candidateIds.length === 0) {
        showToast('No candidates selected', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to permanently delete ${candidateIds.length} candidate(s)? This action cannot be undone and will delete all associated documents.`)) {
        return;
    }
    
    await deleteCandidates(candidateIds);
}

async function deleteCandidates(candidateIds) {
    try {
        const res = await api('/api/admin/candidates', 'DELETE', { candidateIds });
        showToast(res.message || 'Candidates deleted successfully.', 'success');
        
        // Remove from local state
        state.candidates = state.candidates.filter(c => !candidateIds.includes(c.id));
        
        // Ensure checkboxes are unselected
        document.querySelectorAll('.select-all-candidates').forEach(cb => cb.checked = false);
        document.querySelectorAll('.candidate-checkbox').forEach(cb => cb.checked = false);
        
        updateBulkActionVisibility();
        renderCandidatesTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}


async function forwardDeanToAdmin(candidateIds) {
    if (confirm(`Are you sure you want to forward ${candidateIds.length} candidate(s) to the Admin for final eligibility approval?`)) {
        await api('/api/dean/forward-to-admin', 'POST', { candidateIds });
        showToast('Candidates forwarded to Admin.');
        await loadTabSpecificData();
    }
}
async function returnDeanToRc(candidateIds) {
    if (confirm(`Are you sure you want to return ${candidateIds.length} candidate(s) to the Coordinator?`)) {
        await api('/api/dean/return-to-rc', 'POST', { candidateIds });
        showToast('Candidates returned to Coordinator.');
        await loadTabSpecificData();
    }
}
async function forwardDeanSelectionsToAdmin(candidateIds) {
    if (confirm(`Are you sure you want to forward ${candidateIds.length} guide selection(s) to Admin?`)) {
        await api('/api/dean/forward-selections-to-admin', 'POST', { candidateIds });
        showToast('Selections forwarded to Admin.');
        await loadTabSpecificData();
    }
}
async function returnDeanSelectionsToRc(candidateIds) {
    if (confirm(`Are you sure you want to return ${candidateIds.length} guide selection(s) to the Coordinator?`)) {
        await api('/api/dean/return-selections-to-rc', 'POST', { candidateIds });
        showToast('Selections returned to Coordinator.');
        await loadTabSpecificData();
    }
}
window.forwardDeanToAdmin = forwardDeanToAdmin;
window.returnDeanToRc = returnDeanToRc;
window.forwardDeanSelectionsToAdmin = forwardDeanSelectionsToAdmin;
window.returnDeanSelectionsToRc = returnDeanSelectionsToRc;

async function releaseDeptRanks(departmentId) {
    try { const result=await api('/api/admin/release-ranks-to-all','POST',{department_id:departmentId,campus_id:state.activeCandidateCampus});showToast(result.message);await loadTabSpecificData(); } catch(error){showToast(error.message,'error');}
}
window.releaseDeptRanks=releaseDeptRanks;
