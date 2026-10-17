// --- DASHBOARD METRICS BY ROLE ---
// --- COORDINATOR SUPERVISOR DIRECTORY WIDGETS ---
function renderCoordinatorSupervisorUploadWidget() {
    const dl = getDeadlineStatus('deadline_supervisor_upload', 'Supervisor Directory Upload');
    const isPastDeadline = dl.isPast;
    const deadlineBadgeHtml = dl.badgeHtml;

    const isEnabled = state.settings && state.settings.supervisor_upload_enabled !== false && !isPastDeadline;


    let uploadZoneHtml = '';
    if (isEnabled) {
        uploadZoneHtml = `
            <div class="upload-dropzone" id="supervisor-excel-dropzone">
                <i class="fa-solid fa-file-excel"></i>
                <span>Drag and drop supervisor details spreadsheet (.xlsx) or click to browse</span>
                <input type="file" id="supervisor-excel-file-input" accept=".xlsx">
            </div>
            <div id="supervisor-excel-upload-status" style="margin-top: 1rem; font-size: 0.85rem;"></div>
        `;
    } else {
        uploadZoneHtml = `
            <div style="background-color: var(--bg-tertiary); padding: 1.5rem; border-radius: 8px; border: 1px dashed var(--glass-border); text-align: center;">
                <i class="fa-solid fa-lock" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 1rem;"></i>
                <h4 style="margin: 0 0 0.5rem 0;">Uploads Locked</h4>
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">
                    Supervisor uploads are currently closed by the Administrator. Please contact the Admin if you need to make changes to the directory.
                </p>
            </div>
            <div id="supervisor-excel-upload-status" style="display:none;"></div>
        `;
    }

    return `
        <div class="card animate-fade-in-up" style="margin-top: 1.5rem;">
            <h3 style="margin-bottom: 1.2rem;"><i class="fa-solid fa-user-tie"></i> Upload Supervisor Directory (Excel)</h3>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
                Upload the Excel file containing supervisor details for your campus/faculty. The system will automatically parse the departments and vacancies. This list will be instantly shown to HODs for guide allocation.
            </p>
            ${deadlineBadgeHtml}
            ${uploadZoneHtml}
            
            <div id="supervisor-summary-panel" style="margin-top: 2rem; border-top: 1px solid var(--glass-border); padding-top: 1.5rem;">
                <div style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Loading supervisor directory summary...
                </div>
            </div>
        </div>
    `;
}

function setupSupervisorUploadHandlers() {
    const zone = document.getElementById('supervisor-excel-dropzone');
    const input = document.getElementById('supervisor-excel-file-input');
    const status = document.getElementById('supervisor-excel-upload-status');

    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleSupervisorUpload(input.files[0], '/api/coordinator/upload-supervisors', status));
}

async function handleSupervisorUpload(file, url, statusElement) {
    if (!file) return;
    statusElement.innerHTML = `<span style="color: var(--warning)"><i class="fa-solid fa-spinner fa-spin"></i> Uploading and parsing supervisor directory...</span>`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await api(url, 'POST', formData, true);
        statusElement.innerHTML = `<span style="color: var(--success)"><i class="fa-solid fa-circle-check"></i> ${res.message}</span>`;
        showToast(res.message);
        loadSupervisorsDirectory();
    } catch (err) {
        statusElement.innerHTML = `<span style="color: var(--danger)"><i class="fa-solid fa-circle-xmark"></i> Error: ${err.message}</span>`;
        showToast(err.message, 'error');
    }
}

async function loadSupervisorsDirectory() {
    try {
        const res = await api('/api/coordinator/supervisors');
        state.supervisorsList = res.supervisors || [];
        renderSupervisorsTableBody();
        renderCoordinatorSupervisorSummary();
        if (state.activeTab === 'dashboard') {
            renderCoordinatorCharts();
        }
    } catch (err) {
        const panel = document.getElementById('supervisor-list-panel');
        if (panel) {
            panel.innerHTML = `<div style="text-align:center; padding: 2rem; color:var(--danger)">Error: ${err.message}</div>`;
        }
        const spanel = document.getElementById('supervisor-summary-panel');
        if (spanel) {
            spanel.innerHTML = `<div style="text-align:center; padding: 2rem; color:var(--danger)">Error: ${err.message}</div>`;
        }
    }
}

function renderSupervisorsTableBody() {
    const container = document.getElementById('supervisor-list-panel');
    if (!container) return;

    const list = state.supervisorsList;
    if (!list || list.length === 0) {
        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h4 style="margin: 0; font-size: 1.2rem;"><i class="fa-solid fa-folder-open"></i> Current Supervisors Directory</h4>
            </div>
            <div style="text-align:center; padding: 2rem; color:var(--text-muted)">No supervisors directory uploaded yet.</div>
        `;
        return;
    }

    // Group by department name
    const groups = {};
    list.forEach(s => {
        const deptName = s.department_name || 'Unclassified';
        if (!groups[deptName]) groups[deptName] = [];
        groups[deptName].push(s);
    });

    const sortedDepts = Object.keys(groups).sort();

    // Default to the first department if not set or invalid
    if (!state.activeCoordinatorSupervisorDept || !sortedDepts.includes(state.activeCoordinatorSupervisorDept)) {
        state.activeCoordinatorSupervisorDept = sortedDepts[0];
    }

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h4 style="margin: 0; font-size: 1.2rem;"><i class="fa-solid fa-folder-open"></i> Current Supervisors Directory</h4>
            <button class="btn btn-danger" onclick="clearAllSupervisors()" style="padding: 6px 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.4rem; border-radius: var(--radius-sm);">
                <i class="fa-solid fa-trash-can"></i> Clear All Supervisors
            </button>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.5rem; border-bottom: 1px dashed var(--glass-border); padding-bottom: 12px;">
            ${sortedDepts.map(deptName => {
                const count = groups[deptName].length;
                const isActive = state.activeCoordinatorSupervisorDept === deptName;
                return `
                    <button class="sub-tab-btn ${isActive ? 'active' : ''}" 
                            onclick="state.activeCoordinatorSupervisorDept = '${deptName.replace(/'/g, "\\'")}'; renderSupervisorsTableBody();">
                        <i class="fa-solid fa-network-wired" style="margin-right: 6px;"></i> ${deptName} (${count})
                    </button>
                `;
            }).join('')}
        </div>
    `;

    const activeDept = state.activeCoordinatorSupervisorDept;
    const deptSupervisors = sortSupervisorsList(groups[activeDept] || []);

    html += `
        <div class="department-supervisor-group" style="margin-bottom: 2.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.5rem;">
                <i class="fa-solid fa-network-wired" style="color: var(--primary)"></i>
                <h5 style="margin: 0; font-size: 1.05rem; font-weight: 600; color: var(--text-primary);">${activeDept}</h5>
                <span class="badge badge-secondary" style="font-size: 0.75rem; margin-left: 0.5rem; background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--glass-border); padding: 2px 6px; border-radius: 4px;">
                    ${deptSupervisors.length} Supervisor(s)
                </span>
            </div>
            <div class="table-container" style="max-height: 400px; overflow-y: auto;">
                <table class="supervisors-dept-table" data-dept="${activeDept}">
                    <thead>
                        <tr>
                            <th style="width: 60px; user-select: none; text-align: center;">S.No.</th>
                            <th onclick="handleSupervisorSort('name')" style="cursor: pointer; user-select: none;">Name ${getSupervisorSortIcon('name')}</th>
                            <th onclick="handleSupervisorSort('faculty_id')" style="cursor: pointer; user-select: none;">Faculty ID ${getSupervisorSortIcon('faculty_id')}</th>
                            <th onclick="handleSupervisorSort('designation')" style="cursor: pointer; user-select: none;">Designation ${getSupervisorSortIcon('designation')}</th>
                            <th onclick="handleSupervisorSort('area_of_research')" style="cursor: pointer; user-select: none;">Research Area ${getSupervisorSortIcon('area_of_research')}</th>
                            <th onclick="handleSupervisorSort('session_vacancy')" style="cursor: pointer; user-select: none;">Session Vacancy ${getSupervisorSortIcon('session_vacancy')}</th>
                            <th style="cursor: pointer; user-select: none; text-align: center;">Maximum Number of Students Allowed (N)</th>
                            <th onclick="handleSupervisorSort('allocated_count')" style="cursor: pointer; user-select: none; text-align: center;">No. of Scholars Currently Guiding (C) ${getSupervisorSortIcon('allocated_count')}</th>
                            <th onclick="handleSupervisorSort('vacancy_remaining')" style="cursor: pointer; user-select: none; text-align: center;">No. of Available Vacancy (N-C) ${getSupervisorSortIcon('vacancy_remaining')}</th>
                            <th onclick="handleSupervisorSort('is_eligible')" style="cursor: pointer; user-select: none;">Status ${getSupervisorSortIcon('is_eligible')}</th>
                            <th style="text-align: center; user-select: none;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${deptSupervisors.map((s, idx) => {
                            const sessionLimit = Math.min(2, s.vacancy);
                            const sessionAvail = s.is_eligible === 'Yes' ? Math.max(0, sessionLimit - s.allocated_count) : 0;
                            const totalAvail = s.is_eligible === 'Yes' ? Math.max(0, s.vacancy - s.allocated_count) : 0;
                            return `
                            <tr>
                                <td style="text-align: center; color: var(--text-secondary); font-weight: 500;">${idx + 1}</td>
                                <td><strong>${s.name}</strong></td>
                                <td>${s.faculty_id || '-'}</td>
                                <td>${s.designation || '-'}</td>
                                <td>${s.area_of_research || '-'}</td>
                                <td><span style="font-weight:bold; color:${sessionAvail > 0 ? 'var(--success)' : 'var(--danger)'};">${sessionAvail} / ${sessionLimit}</span></td>
                                <td style="text-align: center;">${s.max_students !== undefined ? s.max_students : '-'}</td>
                                <td style="text-align: center;">${(s.current_guiding || 0) + (s.allocated_count || 0)}</td>
                                <td style="text-align: center; font-weight: bold;">${totalAvail}</td>
                                <td><span class="badge ${s.is_eligible === 'Yes' ? 'badge-success' : 'badge-danger'}">${s.is_eligible === 'Yes' ? 'Eligible' : 'Not Eligible'}</span></td>
                                <td style="text-align: center;">
                                    <button class="btn btn-secondary" onclick="deleteSupervisor(${s.id})" title="Delete Supervisor" style="padding: 4px 8px; font-size: 0.8rem; border-color: transparent; background: transparent; color: var(--danger); cursor: pointer;">
                                        <i class="fa-solid fa-trash-can"></i>
                                    </button>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function renderCoordinatorSupervisorSummary() {
    const container = document.getElementById('supervisor-summary-panel');
    if (!container) return;

    const list = state.supervisorsList || [];
    const totalCount = list.length;
    const eligibleCount = list.filter(s => s.is_eligible === 'Yes').length;
    const ineligibleCount = totalCount - eligibleCount;

    let totalSessionVacancies = 0;
    let totalOverallVacancies = 0;
    let totalAllocated = 0;
    list.forEach(s => {
        if (s.is_eligible === 'Yes') {
            totalSessionVacancies += Math.max(0, Math.min(2, s.vacancy) - s.allocated_count);
            totalOverallVacancies += Math.max(0, s.vacancy - s.allocated_count);
        }
        totalAllocated += (s.allocated_count || 0);
    });

    if (totalCount === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 1.5rem; color: var(--text-muted);">
                <i class="fa-solid fa-folder-open fa-2x" style="margin-bottom: 0.5rem; color: var(--text-muted);"></i><br>
                No supervisors directory uploaded yet.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;">
            <div style="background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px;">
                <div style="background: rgba(59, 130, 246, 0.1); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-user-tie" style="color: var(--primary); font-size: 1.2rem;"></i>
                </div>
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Total Supervisors</div>
                    <div style="font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${totalCount}</div>
                </div>
            </div>
            <div style="background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px;">
                <div style="background: rgba(16, 185, 129, 0.1); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-circle-check" style="color: var(--success); font-size: 1.2rem;"></i>
                </div>
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Eligible Supervisors</div>
                    <div style="font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${eligibleCount}</div>
                </div>
            </div>
            <div style="background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px;">
                <div style="background: rgba(239, 68, 68, 0.1); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-circle-xmark" style="color: var(--danger); font-size: 1.2rem;"></i>
                </div>
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Ineligible / Retired</div>
                    <div style="font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${ineligibleCount}</div>
                </div>
            </div>
            <div style="background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px;">
                <div style="background: rgba(16, 185, 129, 0.1); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-door-open" style="color: var(--success); font-size: 1.2rem;"></i>
                </div>
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Open Vacancies (Session)</div>
                    <div style="font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${totalSessionVacancies} <span style="font-size: 0.8rem; font-weight: 400; color: var(--text-muted);">/ ${totalOverallVacancies} overall</span></div>
                </div>
            </div>
        </div>
        <div style="margin-top: 1rem; text-align: right;">
            <button class="btn btn-secondary" onclick="navigateToTab('supervisors')" style="padding: 6px 12px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-arrow-right"></i> Go to Supervisors Directory
            </button>
        </div>
    `;
}

function renderCoordinatorSupervisorsPage() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;"><i class="fa-solid fa-user-tie"></i> Supervisors Directory</h2>
        <div class="card animate-fade-in">
            <div id="supervisor-list-panel">
                <div style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Loading supervisor directory...
                </div>
            </div>
        </div>
    `;
    renderSupervisorsTableBody();
}

function renderRegulationsCard() {
    return `
        <div class="card regulations-card" style="margin-top: 1.5rem;">
            <h3 style="color: var(--primary); font-size: 1.3rem; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-book-bookmark"></i> Ph.D. Regulations & SOP Reference
            </h3>
            <p style="color: var(--text-secondary); margin-bottom: 1.2rem; font-size: 0.9rem;">
                Access official guidelines and regulations for candidate verification, eligibility, supervisor allocation, and program standards.
            </p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
                <a href="/regulations/SRM_phd-regulations-reg-2023.pdf" target="_blank" class="regulation-link" style="display: flex; align-items: center; gap: 12px; background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; text-decoration: none; color: var(--text-primary);">
                    <div style="background: rgba(59, 130, 246, 0.12); width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fa-solid fa-file-pdf" style="color: #3b82f6; font-size: 1.3rem;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 0.9rem;">SRM Ph.D. Regulations (2023)</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">SRMIST Official Guidelines</div>
                    </div>
                </a>
                <a href="/regulations/UGC_Regulations_2022.pdf" target="_blank" class="regulation-link" style="display: flex; align-items: center; gap: 12px; background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; text-decoration: none; color: var(--text-primary);">
                    <div style="background: rgba(239, 68, 68, 0.12); width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fa-solid fa-file-pdf" style="color: #ef4444; font-size: 1.3rem;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 0.9rem;">UGC Ph.D. Regulations (2022)</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">National Minimum Standards</div>
                    </div>
                </a>
                <a href="/regulations/SoP_PhD_Entrance_Exam.pdf" target="_blank" class="regulation-link" style="display: flex; align-items: center; gap: 12px; background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 12px; text-decoration: none; color: var(--text-primary);">
                    <div style="background: rgba(16, 185, 129, 0.12); width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fa-solid fa-file-pdf" style="color: #10b981; font-size: 1.3rem;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 0.9rem;">Entrance Exam SoP</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">Standard Operating Procedure</div>
                    </div>
                </a>
            </div>
        </div>
    `;
}

function renderRegulationsPage() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;">Regulations & SOP Reference</h2>
        ${renderRegulationsCard()}
    `;
}

// ──────────────────────────────────────────────────────────────────────
//  ENTRANCE EXAM DOCUMENTS VIEW
// ──────────────────────────────────────────────────────────────────────
function renderEntranceExamDocsPage() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    if (state.activeExamDocCampus === undefined) {
        state.activeExamDocCampus = state.user.campus_id || 1;
    }

    const campusInsts = (state.metadata.institutions || []).filter(i => i.campus_id === Number(state.activeExamDocCampus));
    
    if (state.activeExamDocInst === undefined || !campusInsts.some(i => i.id === Number(state.activeExamDocInst))) {
        state.activeExamDocInst = campusInsts.length > 0 ? campusInsts[0].id : null;
    }

    const selectedInstId = Number(state.activeExamDocInst);
    const selectedInst = campusInsts.find(i => i.id === selectedInstId);
    const instName = selectedInst ? selectedInst.name : '';
    
    const eligibleCandidates = state.candidates.filter(c => 
        c.campus_id === Number(state.activeExamDocCampus) && 
        c.institution_id === selectedInstId && 
        c.status === 'Eligible'
    );

    const documents = [
        {
            key: 'attendance_sheet',
            name: 'Attendance Sheet',
            file: 'S&H_Attendance_Sheet.pdf',
            desc: 'Candidate signature sheet grouped by department for verification during the written examination.'
        },
        {
            key: 'cert_verification',
            name: 'Certificate Verification Form',
            file: 'S&H_Certificate_Verification_Form.pdf',
            desc: 'Checklist sheet for verifying physical certificates (SSLC, HSC, UG, PG, Comp. Exam, etc.) of candidates.'
        },
        {
            key: 'interview_evaluation',
            name: 'Interview Evaluation Sheet',
            file: 'S&H_Interview_Evaluation_Sheet.pdf',
            desc: 'Assessment scoring sheet used by the interview panel for Subject Knowledge, Research Plan, and Presentation.'
        },
        {
            key: 'mark_entry',
            name: 'Mark Entry Sheet',
            file: 'S&H_Mark_Entry_Sheet.pdf',
            desc: 'Final marks compilation sheet for documenting written exam and interview scores.'
        },
        {
            key: 'preference_form',
            name: 'Research Supervisor Preference Form',
            file: '124_S&H_Preference_Form.pdf',
            desc: 'Individual candidate form for documenting preferred supervisors, specialization area, and Ph.D. mode.'
        },
        {
            key: 'omr',
            name: 'OMR Answer Sheet',
            file: '130_S&H_OMR.pdf',
            desc: 'OMR sheet pre-filled with candidate details for the objective-type entrance examination.'
        },
        {
            key: 'collection_form',
            name: 'Answer Scripts Collection Form',
            file: '1_S&H_Collection_Form.pdf',
            desc: 'Summary sheet mapping total registered, present, and absent candidates by department for scripts collection.'
        }
    ];

    const isSuperAdmin = state.user.role === 'super_admin';
    const campusOptions = (state.metadata.campuses || []).map(c => 
        `<option value="${c.id}" ${Number(state.activeExamDocCampus) === c.id ? 'selected' : ''}>${c.name} Campus</option>`
    ).join('');

    const instOptions = campusInsts.map(i => 
        `<option value="${i.id}" ${selectedInstId === i.id ? 'selected' : ''}>${i.name}</option>`
    ).join('');

    mainContent.innerHTML = `
        <h2 style="margin-bottom: 0.4rem; font-size: 1.8rem; display: flex; align-items: center; gap: 10px;">
            <i class="fa-solid fa-file-pdf" style="color: var(--primary);"></i> Entrance Exam & Admission Documents
        </h2>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">
            Generate printable exam sheets and download original template forms. The "View/Print" options automatically compile candidate details from the database.
        </p>

        <div class="table-container animate-fade-in" style="margin-bottom: 2rem; padding: 1.25rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 8px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; align-items: center;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="doc-campus-select" style="margin-bottom: 6px;">Campus</label>
                    <select id="doc-campus-select" class="form-control" ${!isSuperAdmin ? 'disabled' : ''} onchange="switchDocCampus(this.value)">
                        ${campusOptions}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="doc-inst-select" style="margin-bottom: 6px;">Institution / Faculty</label>
                    <select id="doc-inst-select" class="form-control" onchange="switchDocInst(this.value)">
                        ${instOptions}
                    </select>
                </div>
                <div style="display: flex; flex-direction: column; justify-content: flex-end; height: 100%; margin-top: 18px;">
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">
                        <i class="fa-solid fa-user-check" style="color: var(--success); margin-right: 4px;"></i> 
                        Eligible Candidates: <strong style="color: var(--text-primary); font-size: 1.0rem;">${eligibleCandidates.length}</strong>
                    </div>
                </div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 2rem;">
            ${documents.map(doc => {
                return `
                    <div class="table-container" style="display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 8px; transition: transform 0.2s; height: 100%;">
                        <div>
                            <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                                <i class="fa-regular fa-file-lines" style="color: var(--primary);"></i> ${doc.name}
                            </h3>
                            <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 1.25rem;">
                                ${doc.desc}
                            </p>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto;">
                            <button class="btn btn-primary" onclick="viewEntranceExamDoc('${doc.key}')" style="width: 100%; padding: 8px 12px; font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                                <i class="fa-solid fa-eye"></i> View & Print (Pre-filled)
                            </button>
                            <button class="btn btn-secondary" onclick="downloadEntranceExamTemplate('${doc.file}')" style="width: 100%; padding: 8px 12px; font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background-color: var(--bg-tertiary);">
                                <i class="fa-solid fa-download"></i> Download Original PDF
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function switchDocCampus(val) {
    state.activeExamDocCampus = Number(val);
    state.activeExamDocInst = undefined;
    renderEntranceExamDocsPage();
}

function switchDocInst(val) {
    state.activeExamDocInst = Number(val);
    renderEntranceExamDocsPage();
}

async function downloadEntranceExamTemplate(fileName) {
    try {
        showToast('Downloading original template PDF...');
        const response = await fetch(`/api/admin/entrance-exam-docs/download?filename=${encodeURIComponent(fileName)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to download template: ${response.status}`);
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Template downloaded successfully.');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function viewEntranceExamDoc(docKey) {
    if (state.activeExamDocCampus === undefined) {
        state.activeExamDocCampus = state.user.campus_id || 1;
    }
    const campusId = Number(state.activeExamDocCampus);
    const selectedInstId = Number(state.activeExamDocInst);
    
    const campus = (state.metadata.campuses || []).find(c => c.id === campusId);
    const campusName = campus ? campus.name : 'Ramapuram';
    
    const campusInsts = (state.metadata.institutions || []).filter(i => i.campus_id === campusId);
    const selectedInst = campusInsts.find(i => i.id === selectedInstId);
    const instName = selectedInst ? selectedInst.name : '';

    const eligibleCandidates = state.candidates.filter(c => 
        c.campus_id === campusId && 
        c.institution_id === selectedInstId && 
        c.status === 'Eligible'
    );

    if (eligibleCandidates.length === 0) {
        showToast('No eligible candidates found for this institution.', 'error');
        return;
    }

    let htmlBody = '';
    let docTitle = '';

    if (docKey === 'attendance_sheet') {
        htmlBody = generateAttendanceSheetHtml(eligibleCandidates, instName, campusName);
        docTitle = `${campusName}_${instName}_Attendance_Sheet`.replace(/\s+/g, '_');
    } else if (docKey === 'cert_verification') {
        htmlBody = generateCertVerificationHtml(eligibleCandidates, instName, campusName);
        docTitle = `${campusName}_${instName}_Certificate_Verification`.replace(/\s+/g, '_');
    } else if (docKey === 'interview_evaluation') {
        let panels = [];
        try {
            const res = await api(`/api/panels?campus_id=${campusId}&institution_id=${selectedInstId}`);
            panels = res.panels || [];
        } catch (e) {
            console.error('Failed to fetch panels:', e);
        }
        htmlBody = generateInterviewEvaluationHtml(eligibleCandidates, instName, campusName, panels);
        docTitle = `${campusName}_${instName}_Interview_Evaluation`.replace(/\s+/g, '_');
    } else if (docKey === 'mark_entry') {
        htmlBody = generateMarkEntrySheetHtml(eligibleCandidates, instName, campusName);
        docTitle = `${campusName}_${instName}_Mark_Entry`.replace(/\s+/g, '_');
    } else if (docKey === 'omr') {
        htmlBody = generateOmrSheetsHtml(eligibleCandidates, instName, campusName);
        docTitle = `${campusName}_${instName}_OMR_Sheets`.replace(/\s+/g, '_');
    } else if (docKey === 'preference_form') {
        htmlBody = generatePreferenceFormsHtml(eligibleCandidates, instName, campusName);
        docTitle = `${campusName}_${instName}_Preference_Forms`.replace(/\s+/g, '_');
    } else if (docKey === 'collection_form') {
        htmlBody = generateCollectionFormHtml(eligibleCandidates, instName, campusName);
        docTitle = `${campusName}_${instName}_Collection_Form`.replace(/\s+/g, '_');
    }

    openPdfWindow(htmlBody, docTitle, (docKey === 'cert_verification' || docKey === 'interview_evaluation') ? 'landscape' : 'portrait');
}

// ──────────────────────────────────────────────────────────────────────
//  PRINT TEMPLATES GENERATORS
// ──────────────────────────────────────────────────────────────────────
function generateAttendanceSheetHtml(eligibleCandidates, instName, campusName) {
    const deptGroups = {};
    eligibleCandidates.forEach(c => {
        const deptName = c.department_name;
        if (!deptGroups[deptName]) deptGroups[deptName] = [];
        deptGroups[deptName].push(c);
    });

    let html = '';
    const sortedDepts = Object.keys(deptGroups).sort();
    
    sortedDepts.forEach((deptName, deptIdx) => {
        const cands = deptGroups[deptName];
        html += `
            <div class="print-page" style="page-break-after: always; padding: 12px; border: 1px solid #ddd; margin-bottom: 10px;">
                <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
                <h2 style="font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
                <h3 style="font-size: 14px; text-align: center; margin-bottom: 8px; font-weight: bold;">Ph.D. Entrance Examination (July 2026)</h3>
                <h4 style="font-size: 13px; text-align: center; margin-bottom: 12px; font-weight: bold; text-decoration: underline;">ATTENDANCE SHEET - DEPARTMENT OF ${deptName.toUpperCase()}</h4>
                
                <div style="font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between;">
                    <div>Date: <strong>________________</strong></div>
                    <div>Session: <strong>________________</strong></div>
                    <div>Year: <strong>________</strong></div>
                    <div>Venue: <strong>________________</strong></div>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                    <thead>
                        <tr>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 5%;">S.No</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: left; width: 45%;">Name of the Candidate</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 20%;">Application No.</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 12%;">Photo</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 18%;">Signature of the Candidate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cands.map((c, i) => `
                            <tr>
                                <td style="border: 1px solid #111; padding: 5px; text-align: center; font-size: 12px;">${i + 1}</td>
                                <td style="border: 1px solid #111; padding: 5px; font-size: 12px; font-weight: bold;">${c.registered_name}</td>
                                <td style="border: 1px solid #111; padding: 5px; text-align: center; font-size: 12px;">${c.application_no}</td>
                                <td style="border: 1px solid #111; padding: 4px; text-align: center; vertical-align: middle;">
                                    ${c.photo_path ? `<img src="${c.photo_path}" style="width: 35px; height: 45px; object-fit: cover; display: block; margin: 0 auto;">` : `<div class="small-text" style="width: 35px; height: 45px; border: 1px dashed #999; margin: 0 auto; display: flex; align-items: center; justify-content: center; font-size: 8px !important; color: #999;">Photo</div>`}
                                </td>
                                <td style="border: 1px solid #111; padding: 5px;"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 15px; border: 1px solid #111; padding: 8px; font-size: 12px; border-radius: 4px;">
                    <div style="font-weight: bold; margin-bottom: 4px; text-decoration: underline;">To be filled by the Invigilator:</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <div style="margin-bottom: 4px;">Total Number of Candidates: <strong>${cands.length}</strong></div>
                            <div style="margin-bottom: 4px;">Number of Candidates Present: <strong>______</strong></div>
                            <div>Number of Candidates Absent: <strong>______</strong></div>
                        </div>
                        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end;">
                            <div style="margin-top: 10px;">Invigilator Name: __________________________________</div>
                            <div style="margin-top: 10px;">Invigilator Signature: _______________________________</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    return html;
}

function generateCertVerificationHtml(eligibleCandidates, instName, campusName) {
    const deptGroups = {};
    eligibleCandidates.forEach(c => {
        const deptName = c.department_name;
        if (!deptGroups[deptName]) deptGroups[deptName] = [];
        deptGroups[deptName].push(c);
    });

    let html = '';
    const sortedDepts = Object.keys(deptGroups).sort();
    
    sortedDepts.forEach((deptName, deptIdx) => {
        const cands = deptGroups[deptName];
        html += `
            <div class="print-page" style="page-break-after: always; padding: 10px; border: 1px solid #ddd; margin-bottom: 10px; font-size: 12px;">
                <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
                <h2 style="font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
                <h3 style="font-size: 13px; text-align: center; margin-bottom: 8px; font-weight: bold; text-decoration: underline;">CERTIFICATE VERIFICATION - DEPARTMENT OF ${deptName.toUpperCase()}</h3>
                
                <div style="font-size: 12px; margin-bottom: 6px; display: flex; justify-content: space-between;">
                    <div>Date: <strong>________________</strong></div>
                    <div>Session: <strong>________________</strong></div>
                    <div>Year: <strong>________</strong></div>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px;">
                    <thead>
                        <tr>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 4%; font-size: 12px;">S.No</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: left; width: 20%; font-size: 12px;">Candidate Name</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 10%; font-size: 12px;">Appl No.</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 8%; font-size: 12px;">Appl Form</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 6%; font-size: 12px;">SSLC</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 6%; font-size: 12px;">HSC</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 6%; font-size: 12px;">UG</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 6%; font-size: 12px;">PG</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 6%; font-size: 12px;">M.Phil</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 8%; font-size: 12px;">Comp. Exam</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 14%; font-size: 12px;">Remark</th>
                            <th style="border: 1px solid #111; padding: 4px; text-align: center; width: 12%; font-size: 12px;">Signature</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cands.map((c, i) => `
                            <tr>
                                <td style="border: 1px solid #111; padding: 6px 4px; text-align: center; font-size: 12px;">${i + 1}</td>
                                <td style="border: 1px solid #111; padding: 6px 4px; font-weight: bold; font-size: 12px;">${c.registered_name}</td>
                                <td style="border: 1px solid #111; padding: 6px 4px; text-align: center; font-size: 12px;">${c.application_no}</td>
                                <td class="small-text" style="border: 1px solid #111; padding: 6px 4px; text-align: center; color: #666; font-size: 10px !important;">DC:<br>MS:</td>
                                <td class="small-text" style="border: 1px solid #111; padding: 6px 4px; text-align: center; color: #666; font-size: 10px !important;">DC:<br>MS:</td>
                                <td class="small-text" style="border: 1px solid #111; padding: 6px 4px; text-align: center; color: #666; font-size: 10px !important;">DC:<br>MS:</td>
                                <td class="small-text" style="border: 1px solid #111; padding: 6px 4px; text-align: center; color: #666; font-size: 10px !important;">DC:<br>MS:</td>
                                <td class="small-text" style="border: 1px solid #111; padding: 6px 4px; text-align: center; color: #666; font-size: 10px !important;">DC:<br>MS:</td>
                                <td class="small-text" style="border: 1px solid #111; padding: 6px 4px; text-align: center; color: #666; font-size: 10px !important;">DC:<br>MS:</td>
                                <td style="border: 1px solid #111; padding: 6px 4px; text-align: center; font-size: 12px;"></td>
                                <td style="border: 1px solid #111; padding: 6px 4px; font-size: 12px;"></td>
                                <td style="border: 1px solid #111; padding: 6px 4px; font-size: 12px;"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="small-text" style="margin-top: 8px; font-size: 10px !important; color: #555;">
                    *Appl. - Application; DC - Degree Certificate; MS - Mark Statement; Comp. Exam - Competitive Exam. Y - Yes, N - No
                </div>
            </div>
        `;
    });
    return html;
}

function generateInterviewEvaluationHtml(eligibleCandidates, instName, campusName, panels = []) {
    const panelsMap = {};
    panels.forEach(p => {
        panelsMap[p.id] = p;
    });

    const deptGroups = {};
    eligibleCandidates.forEach(c => {
        const deptName = c.department_name;
        if (!deptGroups[deptName]) deptGroups[deptName] = {};
        
        const panelId = c.panel_id || 'unassigned';
        if (!deptGroups[deptName][panelId]) deptGroups[deptName][panelId] = [];
        deptGroups[deptName][panelId].push(c);
    });

    let html = '';
    const sortedDepts = Object.keys(deptGroups).sort();
    
    sortedDepts.forEach(deptName => {
        const panelGroups = deptGroups[deptName];
        const panelIds = Object.keys(panelGroups).sort((a, b) => {
            if (a === 'unassigned') return 1;
            if (b === 'unassigned') return -1;
            return Number(a) - Number(b);
        });

        panelIds.forEach(panelId => {
            const cands = panelGroups[panelId];
            const panel = panelsMap[panelId] || { panel_name: 'Unassigned / Default Panel', members: [] };
            const panelMembers = panel.members || [];
            
            if (panelMembers.length > 0) {
                panelMembers.forEach((member, mIdx) => {
                    html += `
                        <div class="print-page" style="page-break-after: always; padding: 12px; border: 1px solid #ddd; margin-bottom: 10px;">
                            <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
                            <h2 style="font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
                            <h3 style="font-size: 14px; text-align: center; margin-bottom: 8px; font-weight: bold;">Ph.D. Entrance Examination (July 2026)</h3>
                            <h4 style="font-size: 13px; text-align: center; margin-bottom: 12px; font-weight: bold; text-decoration: underline;">INTERVIEW EVALUATION SHEET - DEPARTMENT OF ${deptName.toUpperCase()}</h4>
                            
                            <div style="font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between;">
                                <div>Panel: <strong>${panel.panel_name}</strong></div>
                                <div>Examiner: <strong>${member.name} (${member.designation || 'Examiner'})</strong></div>
                                <div>Session: <strong>________________</strong></div>
                                <div>Year: <strong>________</strong></div>
                                <div>Date: <strong>________________</strong></div>
                            </div>

                            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                                <thead>
                                    <tr>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 6%;">S.No</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: left; width: 34%;">Candidate Name</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 16%;">Application No.</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 11%;">Subject Knowledge (10)</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 11%;">Future Research Plan / Proposal (10)</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 8%;">Presentation (5)</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 8%;">Research Experience (5)</th>
                                        <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 8%;">Total Marks (30)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${cands.map((c, i) => `
                                        <tr>
                                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${i + 1}</td>
                                            <td style="border: 1px solid #111; padding: 6px; font-size: 12px; font-weight: bold;">${c.registered_name}</td>
                                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${c.application_no}</td>
                                            <td style="border: 1px solid #111; padding: 6px;"></td>
                                            <td style="border: 1px solid #111; padding: 6px;"></td>
                                            <td style="border: 1px solid #111; padding: 6px;"></td>
                                            <td style="border: 1px solid #111; padding: 6px;"></td>
                                            <td style="border: 1px solid #111; padding: 6px;"></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>

                            <div style="margin-top: 15px; border: 1px solid #111; padding: 8px; font-size: 12px; border-radius: 4px;">
                                <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 15px;">
                                    <div>
                                        <div style="margin-bottom: 4px;">Total Number of Candidates: <strong>${cands.length}</strong></div>
                                        <div style="margin-bottom: 4px;">Number of Candidates Present: <strong>______</strong></div>
                                        <div>Number of Candidates Absent: <strong>______</strong></div>
                                    </div>
                                    <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end; text-align: right;">
                                        <div style="margin-bottom: 25px; height: 18px; width: 250px; border-bottom: 1px dashed #999;"></div>
                                        <strong>${member.name}</strong><br>
                                        <span class="small-text" style="font-size: 10px !important; color: #555;">${member.designation || ''} (Examiner ${mIdx + 1} Signature)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                });
            } else {
                html += `
                    <div class="print-page" style="page-break-after: always; padding: 12px; border: 1px solid #ddd; margin-bottom: 10px;">
                        <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
                        <h2 style="font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
                        <h3 style="font-size: 14px; text-align: center; margin-bottom: 8px; font-weight: bold;">Ph.D. Entrance Examination (July 2026)</h3>
                        <h4 style="font-size: 13px; text-align: center; margin-bottom: 12px; font-weight: bold; text-decoration: underline;">INTERVIEW EVALUATION SHEET - DEPARTMENT OF ${deptName.toUpperCase()}</h4>
                        
                        <div style="font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between;">
                            <div>Panel: <strong>${panel.panel_name}</strong></div>
                            <div>Session: <strong>________________</strong></div>
                            <div>Year: <strong>________</strong></div>
                            <div>Date: <strong>________________</strong></div>
                        </div>

                        <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                            <thead>
                                <tr>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 6%;">S.No</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: left; width: 34%;">Candidate Name</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 16%;">Application No.</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 11%;">Subject Knowledge (10)</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 11%;">Future Research Plan / Proposal (10)</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 8%;">Presentation (5)</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 8%;">Research Experience (5)</th>
                                    <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 8%;">Total Marks (30)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${cands.map((c, i) => `
                                    <tr>
                                        <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${i + 1}</td>
                                        <td style="border: 1px solid #111; padding: 6px; font-size: 12px; font-weight: bold;">${c.registered_name}</td>
                                        <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${c.application_no}</td>
                                        <td style="border: 1px solid #111; padding: 6px;"></td>
                                        <td style="border: 1px solid #111; padding: 6px;"></td>
                                        <td style="border: 1px solid #111; padding: 6px;"></td>
                                        <td style="border: 1px solid #111; padding: 6px;"></td>
                                        <td style="border: 1px solid #111; padding: 6px;"></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>

                        <div style="margin-top: 15px; border: 1px solid #111; padding: 8px; font-size: 12px; border-radius: 4px;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                <div>
                                    <div style="margin-bottom: 4px;">Total Number of Candidates: <strong>${cands.length}</strong></div>
                                    <div style="margin-bottom: 4px;">Number of Candidates Present: <strong>______</strong></div>
                                    <div>Number of Candidates Absent: <strong>______</strong></div>
                                </div>
                                <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end;">
                                    <div style="margin-top: 10px;">Interviewer Name: __________________________________</div>
                                    <div style="margin-top: 10px;">Signature: ________________________________________</div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        });
    });
    return html;
}

function generateMarkEntrySheetHtml(eligibleCandidates, instName, campusName) {
    const deptGroups = {};
    eligibleCandidates.forEach(c => {
        const deptName = c.department_name;
        if (!deptGroups[deptName]) deptGroups[deptName] = [];
        deptGroups[deptName].push(c);
    });

    let html = '';
    const sortedDepts = Object.keys(deptGroups).sort();
    
    sortedDepts.forEach((deptName, deptIdx) => {
        const cands = deptGroups[deptName];
        html += `
            <div class="print-page" style="page-break-after: always; padding: 12px; border: 1px solid #ddd; margin-bottom: 10px;">
                <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
                <h2 style="font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
                <h3 style="font-size: 14px; text-align: center; margin-bottom: 8px; font-weight: bold;">Ph.D. Entrance Examination (July 2026)</h3>
                <h4 style="font-size: 13px; text-align: center; margin-bottom: 12px; font-weight: bold; text-decoration: underline;">MARK ENTRY SHEET - DEPARTMENT OF ${deptName.toUpperCase()}</h4>
                
                <div style="font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between;">
                    <div>Date: <strong>________________</strong></div>
                    <div>Session: <strong>________________</strong></div>
                    <div>Year: <strong>________</strong></div>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                    <thead>
                        <tr>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 6%;">S.No</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: left; width: 34%;">Name of the Candidate</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 16%;">Application No.</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 24%;">Department</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 10%;">Faculty Mark</th>
                            <th style="border: 1px solid #111; padding: 5px; text-align: center; width: 10%;">Research Faculty Mark</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cands.map((c, i) => `
                            <tr>
                                <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${i + 1}</td>
                                <td style="border: 1px solid #111; padding: 6px; font-size: 12px; font-weight: bold;">${c.registered_name}</td>
                                <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${c.application_no}</td>
                                <td style="border: 1px solid #111; padding: 6px; font-size: 12px; text-align: center;">${c.department_name}</td>
                                <td style="border: 1px solid #111; padding: 5px;"></td>
                                <td style="border: 1px solid #111; padding: 5px;"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 25px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; font-size: 12px;">
                    <div>
                        <div style="font-weight: bold; margin-bottom: 8px; text-decoration: underline;">Evaluator 1:</div>
                        <div style="margin-bottom: 8px;">Name: _____________________________________________</div>
                        <div style="margin-bottom: 8px;">Signature: __________________________________________</div>
                        <div>Date: ________________________</div>
                    </div>
                    <div>
                        <div style="font-weight: bold; margin-bottom: 8px; text-decoration: underline;">Evaluator 2:</div>
                        <div style="margin-bottom: 8px;">Name: _____________________________________________</div>
                        <div style="margin-bottom: 8px;">Signature: __________________________________________</div>
                        <div>Date: ________________________</div>
                    </div>
                </div>
            </div>
        `;
    });
    return html;
}

function generateOmrSheetsHtml(eligibleCandidates, instName, campusName) {
    return `
        <div class="print-page" style="padding: 15px 20px; border: 1px solid #ddd; margin-bottom: 10px; font-size: 12px; max-width: 800px; margin-left: auto; margin-right: auto;">
            <h1 style="font-size: 18px !important; font-weight: bold; text-align: center; margin-bottom: 6px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
            <h2 style="font-size: 14px !important; font-weight: bold; text-align: center; margin-bottom: 6px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
            <h3 style="font-size: 13px !important; text-align: center; margin-bottom: 6px; font-weight: bold;">Ph.D. Entrance Examination</h3>
            <h4 style="font-size: 15px !important; text-align: center; margin-bottom: 15px; font-weight: bold; text-decoration: underline;">OMR ANSWER SHEET</h4>

            <div style="border: 1px solid #111; padding: 10px; margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px !important; line-height: 1.5;">
                <div>Name: <strong>__________________________________</strong></div>
                <div>Application No.: <strong>__________________________________</strong></div>
                <div>Department: <strong>______________________________</strong></div>
                <div>Session: &nbsp; <strong>[ &nbsp; ] January</strong> &nbsp;&nbsp;&nbsp; <strong>[ &nbsp; ] July</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Year: <strong>________</strong></div>
            </div>

            <div class="small-text" style="border: 1px solid #111; padding: 10px; margin-bottom: 12px; font-size: 11px !important; line-height: 1.4;">
                <div style="font-weight: bold; text-decoration: underline; margin-bottom: 4px; font-size: 11px !important;">INSTRUCTIONS FOR FILLING THE SHEET:</div>
                1. Use only blue/ black ball point pen to fill the circles. Use of pencil is strictly prohibited.<br>
                2. Circles should be darkened completely and properly.<br>
                3. Cutting and erasing on this sheet is not allowed.<br>
                4. Do not use any stray marks on the sheet.<br>
                5. Do not use marker or white fluid to hide the mark.
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 13px !important; border: 1px solid #111; padding: 12px 10px; margin-bottom: 15px; border-radius: 4px;">
                <div>Candidate’s Signature: <strong>_______________________</strong></div>
                <div>Invigilator’s Signature: <strong>_______________________</strong></div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 15px;">
                ${(() => {
                    let cols = '';
                    for (let col = 0; col < 4; col++) {
                        cols += `<div style="display: flex; flex-direction: column; gap: 3px;">`;
                        const startQ = col * 13 + 1;
                        const endQ = Math.min(50, (col + 1) * 13);
                        for (let q = startQ; q <= endQ; q++) {
                            cols += `
                                <div style="display: flex; align-items: center; justify-content: flex-start; gap: 10px; font-size: 13px !important; padding: 4.5px 0; border-bottom: 1px dashed #eee;">
                                    <span style="font-weight: bold; width: 25px; text-align: right; display: inline-block; font-size: 13px !important;">${q}.</span>
                                    <span style="display: flex; gap: 5px;">
                                        <span class="omr-circle" style="border: 1px solid #111; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px !important; font-weight: bold;">A</span>
                                        <span class="omr-circle" style="border: 1px solid #111; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px !important; font-weight: bold;">B</span>
                                        <span class="omr-circle" style="border: 1px solid #111; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px !important; font-weight: bold;">C</span>
                                        <span class="omr-circle" style="border: 1px solid #111; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px !important; font-weight: bold;">D</span>
                                    </span>
                                </div>
                             `;
                        }
                        cols += `</div>`;
                    }
                    return cols;
                })()}
            </div>

            <div class="small-text" style="border: 1px solid #111; padding: 10px; font-size: 11px !important; border-radius: 4px; margin-top: 15px; line-height: 1.4;">
                <div style="font-weight: bold; text-decoration: underline; margin-bottom: 6px; text-align: center; font-size: 12px !important;">FOR OFFICE USE ONLY</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; font-size: 11px !important;">
                    <div style="border-right: 1px solid #ccc; padding-right: 10px;">
                       <div style="font-weight: bold; margin-bottom: 6px; text-decoration: underline; font-size: 11px !important;">Evaluator 1</div>
                        <div style="margin-bottom: 6px;">Marks Obtained: __________________</div>
                        <div style="margin-bottom: 6px;">Name: __________________________</div>
                        <div>Signature: ______________________</div>
                    </div>
                    <div style="border-right: 1px solid #ccc; padding-right: 10px;">
                        <div style="font-weight: bold; margin-bottom: 6px; text-decoration: underline; font-size: 11px !important;">Evaluator 2</div>
                        <div style="margin-bottom: 6px;">Marks Obtained: __________________</div>
                        <div style="margin-bottom: 6px;">Name: __________________________</div>
                        <div>Signature: ______________________</div>
                    </div>
                    <div style="display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="font-weight: bold; margin-bottom: 6px; text-decoration: underline; font-size: 11px !important;">Head of Department</div>
                            <div style="margin-bottom: 30px; height: 18px;"></div>
                        </div>
                        <div>Signature: ______________________</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generatePreferenceFormsHtml(eligibleCandidates, instName, campusName) {
    return `
        <div class="print-page" style="padding: 15px; border: 1px solid #ddd; margin-bottom: 10px; font-size: 12px; max-width: 800px; margin-left: auto; margin-right: auto; line-height: 1.25;">
            <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
            <h2 style="font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
            <h3 style="font-size: 13px; text-align: center; margin-bottom: 12px; font-weight: bold; text-decoration: underline;">RESEARCH SUPERVISOR PREFERENCE FORM</h3>
            
            <h4 style="font-size: 11px; font-weight: bold; margin-bottom: 6px; text-decoration: underline;">Candidate Details</h4>
            <div style="margin-bottom: 8px; display: grid; grid-template-columns: 120px 1fr; gap: 6px;">
                <div>Name:</div>
                <div style="border-bottom: 1px solid #666; height: 18px;"></div>
                <div>Application No.:</div>
                <div style="border-bottom: 1px solid #666; height: 18px;"></div>
                <div>Department:</div>
                <div style="border-bottom: 1px solid #666; height: 18px;"></div>
                <div>Institute applied:</div>
                <div style="border-bottom: 1px solid #666; height: 18px;"></div>
                <div>Area of Interest:</div>
                <div style="border-bottom: 1px solid #666; height: 18px;"></div>
                <div>Mode of Ph.D.:</div>
                <div>
                    <span style="margin-right: 15px;">Full Time [ ]</span>
                    <span style="margin-right: 15px;">Part Time - Internal [ ]</span>
                    <span>Part Time - External [ ]</span>
                </div>
            </div>

            <h4 style="font-size: 11px; font-weight: bold; margin-top: 12px; margin-bottom: 6px; text-decoration: underline;">Research Supervisor Details</h4>
            <div style="border: 1px solid #111; padding: 6px; margin-bottom: 8px; border-radius: 4px;">
                <div style="font-weight: bold; margin-bottom: 4px;">Preference 1:</div>
                <div style="display: grid; grid-template-columns: 120px 1fr; gap: 6px; margin-left: 10px;">
                    <div>Name of the Guide:</div><div style="border-bottom: 1px dotted #999; height: 18px;"></div>
                    <div>Designation & Dept:</div><div style="border-bottom: 1px dotted #999; height: 18px;"></div>
                    <div>Research Expertise:</div><div style="border-bottom: 1px dotted #999; height: 18px;"></div>
                </div>
            </div>

            <div style="border: 1px solid #111; padding: 6px; margin-bottom: 8px; border-radius: 4px;">
                <div style="font-weight: bold; margin-bottom: 4px;">Preference 2:</div>
                <div style="display: grid; grid-template-columns: 120px 1fr; gap: 6px; margin-left: 10px;">
                    <div>Name of the Guide:</div><div style="border-bottom: 1px dotted #999; height: 18px;"></div>
                    <div>Designation & Dept:</div><div style="border-bottom: 1px dotted #999; height: 18px;"></div>
                    <div>Research Expertise:</div><div style="border-bottom: 1px dotted #999; height: 18px;"></div>
                </div>
            </div>

            <p class="small-text" style="margin-bottom: 12px; text-align: justify; font-size: 10px !important; color: #444;">
                I hereby declare that I have given my preference for two Research Supervisors. I understand that the final allocation of supervisors will be made based on the rank list, and I am fully aware and agree to abide by this procedure.
            </p>

            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 25px; font-size: 12px;">
                <div>Date: ____________________</div>
                <div style="text-align: center;">
                    <div style="height: 35px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px;">
                        __________________________________
                    </div>
                    <div>Signature of the Candidate</div>
                </div>
            </div>
        </div>
    `;
}

function generateCollectionFormHtml(eligibleCandidates, instName, campusName) {
    const deptGroups = {};
    eligibleCandidates.forEach(c => {
        const deptName = c.department_name;
        if (!deptGroups[deptName]) deptGroups[deptName] = [];
        deptGroups[deptName].push(c);
    });

    const sortedDepts = Object.keys(deptGroups).sort();

    let html = `
        <div class="print-page" style="padding: 15px; border: 1px solid #ddd; margin-bottom: 10px; max-width: 800px; margin-left: auto; margin-right: auto; font-size: 12px;">
            <h1 style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px;">SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</h1>
            <h2 style="font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #000; border: none; padding: 0;">FACULTY OF ${instName.toUpperCase()} - ${campusName.toUpperCase()}</h2>
            <h3 style="font-size: 14px; text-align: center; margin-bottom: 4px; font-weight: bold;">Ph.D. Entrance Examination (July 2026)</h3>
            <h4 style="font-size: 13px; text-align: center; margin-bottom: 10px; font-weight: bold; text-decoration: underline;">ANSWER SCRIPTS COLLECTION FORM</h4>
            
            <div style="font-size: 12px; margin-bottom: 10px; display: flex; justify-content: space-between;">
                <div>Session: <strong>________________</strong></div>
                <div>Year: <strong>________</strong></div>
                <div>Date: <strong>________________</strong></div>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 6%; font-size: 12px;">S.No</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: left; width: 28%; font-size: 12px;">Name of the Department</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 10%; font-size: 12px;">Hall No</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 12%; font-size: 12px;">Total No. of Candidates</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 11%; font-size: 12px;">No of Candidates Present</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 11%; font-size: 12px;">No. of Candidates Absent</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 11%; font-size: 12px;">No. of Answer Scripts</th>
                        <th style="border: 1px solid #111; padding: 6px; text-align: center; width: 11%; font-size: 12px;">Invigilator Name & Signature</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedDepts.map((deptName, i) => `
                        <tr>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;">${i + 1}</td>
                            <td style="border: 1px solid #111; padding: 6px; font-size: 12px; font-weight: bold;">${deptName}</td>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;"></td>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-weight: bold; font-size: 12px;">${deptGroups[deptName].length}</td>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;"></td>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;"></td>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;"></td>
                            <td style="border: 1px solid #111; padding: 6px; text-align: center; font-size: 12px;"></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 12px;">
                <div>
                    <div style="font-weight: bold; margin-bottom: 4px;">Verified by Research Co-ordinator:</div>
                    <div style="margin-bottom: 8px; margin-top: 10px;">Name: _____________________________________</div>
                    <div>Signature: __________________________________</div>
                </div>
                <div>
                    <div style="font-weight: bold; margin-bottom: 4px;">Received by:</div>
                    <div style="margin-top: 10px; margin-bottom: 8px;">Name: _____________________________________</div>
                    <div>Signature: __________________________________</div>
                </div>
            </div>
        </div>
    `;
    return html;
}

function renderVacancySummaryWidget() {
    if (!state.vacancies || state.vacancies.length === 0) return '';
    const isHod = state.user.role === 'hod';
    if (isHod) {
        return renderVacancySummaryWidgetContent();
    }
    return `<div id="vacancy-summary-widget-container">${renderVacancySummaryWidgetContent()}</div>`;
}

function selectVacancyInst(instName) {
    state.activeVacancyInst = instName;
    const container = document.getElementById('vacancy-summary-widget-container');
    if (container) {
        container.innerHTML = renderVacancySummaryWidgetContent();
    }
}

function renderVacancySummaryWidgetContent() {
    if (!state.vacancies || state.vacancies.length === 0) return '';

    const isHod = state.user.role === 'hod';
    const isCoord = state.user.role === 'coordinator';
    const isAdmin = state.user.role === 'admin';

    if (isHod) {
        const v = state.vacancies[0];
        if (!v) return '';
        const ftAllowedDisplay = (v.ft_allowed !== null && v.ft_allowed !== undefined)
            ? `<div style="font-size: 1.6rem; font-weight: 700; color: var(--primary);">${v.ft_allowed}</div>`
            : `<div style="font-size: 1.4rem; font-weight: 700; color: var(--text-muted);">—</div>`;
        return `
            <div class="card animate-fade-in-up" style="margin-top: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); padding: 1.5rem; border-radius: 12px;">
                <h3 style="margin-bottom: 1rem; font-size: 1.1rem; color: var(--primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-user-check"></i> Department Supervisor Vacancies
                </h3>
                <div style="display: flex; gap: 2rem; align-items: center; flex-wrap: wrap;">
                    <div>
                        <span style="font-size: 0.8rem; color: var(--text-muted);">Session Vacancy</span>
                        <div style="font-size: 1.6rem; font-weight: 700; color: ${v.remaining_session_vacancy > 0 ? 'var(--success)' : 'var(--text-muted)'};">${v.remaining_session_vacancy} / ${v.session_vacancy}</div>
                    </div>
                    <div style="border-left: 1px dashed var(--glass-border); padding-left: 2rem;">
                        <span style="font-size: 0.8rem; color: var(--text-muted);" title="Full Time with Fellowship intake set by Super Admin">FT (WF) Allowed <i class="fa-solid fa-circle-info" style="font-size:0.65rem; opacity:0.6;"></i></span>
                        ${ftAllowedDisplay}
                    </div>
                    <div style="border-left: 1px dashed var(--glass-border); padding-left: 2rem;">
                        <span style="font-size: 0.8rem; color: var(--text-muted);">FT(WF) Filled</span>
                        <div style="font-size: 1.6rem; font-weight: 700; color: var(--info);">${v.ft_wf_allocated || 0}</div>
                    </div>
                    <div style="border-left: 1px dashed var(--glass-border); padding-left: 2rem;">
                        <span style="font-size: 0.8rem; color: var(--text-muted);">FT(SS) Filled</span>
                        <div style="font-size: 1.6rem; font-weight: 700; color: var(--info);">${v.ft_ss_allocated || 0}</div>
                    </div>
                    <div style="border-left: 1px dashed var(--glass-border); padding-left: 2rem;">
                        <span style="font-size: 0.8rem; color: var(--text-muted);">PT Filled</span>
                        <div style="font-size: 1.6rem; font-weight: 700; color: var(--warning);">${v.part_time_allocated}</div>
                    </div>
                    <div style="border-left: 1px dashed var(--glass-border); padding-left: 2rem;">
                        <span style="font-size: 0.8rem; color: var(--text-muted);">Total Filled</span>
                        <div style="font-size: 1.6rem; font-weight: 700; color: var(--text-secondary);">${v.total_allocated}</div>
                    </div>
                    <div style="border-left: 1px dashed var(--glass-border); padding-left: 2rem;">
                        <span style="font-size: 0.8rem; color: var(--text-muted);">Total Overall Vacancy</span>
                        <div style="font-size: 1.6rem; font-weight: 700; color: var(--text-muted);">${v.remaining_vacancy} / ${v.total_vacancy}</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Admin, Dean & Coordinator: show table of departments under their scope
    let scopedVacancies = state.vacancies || [];
    if (state.user && state.user.campus_id && state.user.role !== 'super_admin') {
        const userCampId = Number(state.user.campus_id);
        const userCampName = userCampId === 1 ? 'ramapuram' : (userCampId === 2 ? 'trichy' : '');
        scopedVacancies = scopedVacancies.filter(v => {
            if (v.campus_id) return Number(v.campus_id) === userCampId;
            if (v.campus_name && userCampName) {
                return v.campus_name.toLowerCase().trim() === userCampName;
            }
            return true;
        });
    }

    const uniqueInsts = [...new Set(scopedVacancies.map(v => v.institution_name))].sort();
    if (!state.activeVacancyInst || !uniqueInsts.includes(state.activeVacancyInst)) {
        state.activeVacancyInst = uniqueInsts[0] || '';
    }

    const filteredVacancies = scopedVacancies.filter(v => v.institution_name === state.activeVacancyInst);

    let totalOverallVac = 0;
    let remOverallVac = 0;
    let totalSessionVac = 0;
    let remSessionVac = 0;
    let totalFtAllowed = 0;
    let ftWfFilled = 0;
    let ftSsFilled = 0;
    let ftFilled = 0;
    let ptFilled = 0;
    let totalFilled = 0;

    filteredVacancies.forEach(v => {
        totalOverallVac += (v.total_vacancy || 0);
        remOverallVac += (v.remaining_vacancy || 0);
        totalSessionVac += (v.session_vacancy || 0);
        remSessionVac += (v.remaining_session_vacancy || 0);
        if (v.ft_allowed !== null && v.ft_allowed !== undefined) {
            totalFtAllowed += v.ft_allowed;
        }
        ftWfFilled += (v.ft_wf_allocated || 0);
        ftSsFilled += (v.ft_ss_allocated || 0);
        ftFilled += (v.full_time_allocated || 0);
        ptFilled += (v.part_time_allocated || 0);
        totalFilled += (v.total_allocated || 0);
    });

    const fillRate = totalSessionVac > 0 ? ((totalFilled / totalSessionVac) * 100).toFixed(0) : 0;

    const title = isCoord ? 'Coordinated Department Vacancies' : 'Campus Department Vacancies';
    const desc = isCoord ? 'Vacancy counts categorized by institutions under your coordination.' : 'Vacancy counts across campus institutions.';

    return `
        <div class="card animate-fade-in-up" style="margin-top: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); padding: 1.5rem; border-radius: 12px;">
            <h3 style="margin-bottom: 0.5rem; font-size: 1.15rem; color: var(--primary); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-list-check"></i> ${title}
            </h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.2rem;">${desc}</p>
            
            <!-- Institution Selection Tabs -->
            <div class="sub-tabs-container" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.2rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.8rem;">
                ${uniqueInsts.map(inst => {
                    const isActive = state.activeVacancyInst === inst;
                    return `
                        <button class="sub-tab-btn ${isActive ? 'active' : ''}" onclick="selectVacancyInst('${inst}')" style="display: inline-flex; align-items: center; gap: 6px; font-family: Cambria, Georgia, serif; cursor: pointer;">
                            <i class="fa-solid fa-university"></i> ${inst}
                        </button>
                    `;
                }).join('')}
            </div>

            <div style="display: grid; grid-template-columns: 1.8fr 1fr; gap: 1.5rem; align-items: stretch;">
                <!-- Departments Table -->
                <div class="table-container" style="margin: 0; max-height: 320px; overflow-y: auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Department</th>
                                <th style="text-align: center;">Session Vacancy</th>
                                <th style="text-align: center;" title="Full Time with Fellowship intake set by Super Admin">FT (WF) Allowed</th>
                                <th style="text-align: center;">FT(WF) Filled</th>
                                <th style="text-align: center;">FT(SS) Filled</th>
                                <th style="text-align: center;">PT Filled</th>
                                <th style="text-align: center;">Total Filled</th>
                                <th style="text-align: center;">Total Vacancy</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredVacancies.map(v => `
                                <tr>
                                    <td><strong>${v.department_name}</strong></td>
                                    <td style="text-align: center; font-weight: 700; color: ${v.remaining_session_vacancy > 0 ? 'var(--success)' : 'var(--text-muted)'};">${v.remaining_session_vacancy} / ${v.session_vacancy}</td>
                                    <td style="text-align: center; font-weight: 600; color: var(--primary);">${v.ft_allowed !== null && v.ft_allowed !== undefined ? v.ft_allowed : '<span style="color:var(--text-muted)">—</span>'}</td>
                                    <td style="text-align: center; color: var(--info); font-weight: 500;">${v.ft_wf_allocated || 0}</td>
                                    <td style="text-align: center; color: var(--info); font-weight: 500;">${v.ft_ss_allocated || 0}</td>
                                    <td style="text-align: center; color: var(--warning); font-weight: 500;">${v.part_time_allocated}</td>
                                    <td style="text-align: center;">${v.total_allocated}</td>
                                    <td style="text-align: center; color: var(--text-muted); font-size: 0.88rem;">${v.remaining_vacancy} / ${v.total_vacancy}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- Analysis Panel -->
                <div class="analysis-panel" style="background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 1.2rem; border-radius: 10px; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <h4 style="margin-bottom: 0.8rem; font-size: 0.95rem; color: var(--primary); display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-chart-line"></i> Vacancy Analysis — ${state.activeVacancyInst}
                        </h4>
                        
                        <div style="margin-bottom: 1rem;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                                <span style="color: var(--text-secondary);">Session Seat Allocation Progress</span>
                                <span style="font-weight: 700; color: var(--success);">${fillRate}%</span>
                            </div>
                            <div class="progress-bar-container" style="margin: 0; background: var(--bg-tertiary); height: 10px; border-radius: 5px;">
                                <div class="progress-bar-fill" style="width: ${fillRate}%; background: var(--success); border-radius: 5px;"></div>
                            </div>
                        </div>

                        <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.85rem; display: flex; flex-direction: column; gap: 8px;">
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Session Slots Filled:</span>
                                <strong style="color: var(--text-primary);">${totalFilled} / ${totalSessionVac}</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Remaining Session Capacity:</span>
                                <strong style="color: var(--success);">${remSessionVac} open slots</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Full-Time (WF / SS) Filled:</span>
                                <strong style="color: var(--info);">${ftWfFilled} / ${ftSsFilled}</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Part-Time Filled:</span>
                                <strong style="color: var(--warning);">${ptFilled} scholars</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between;">
                                <span style="color: var(--text-secondary);">Overall Remaining / Total:</span>
                                <strong style="color: var(--text-muted);">${remOverallVac} / ${totalOverallVac}</strong>
                            </li>
                        </ul>
                    </div>
                    
                    <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; margin-top: 1rem; border-top: 1px solid var(--glass-border); padding-top: 0.6rem;">
                        <i class="fa-solid fa-circle-info"></i> Intake slots are capped at 2 candidates per supervisor for this session. Use the tabs above to select another institution.
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderDashboardSummaryCards() {
    const m=roleInsightModel(),s=m.summary;
    return '<div class="dashboard-grid">'+[
        ['Applications',s.total,m.scope],
        [state.user.role==='super_admin'?'Awaiting Admin action':'Needs your action',s.pending,'Applications awaiting review'],
        ['Verified eligible',s.eligible,m.outcome.ineligible+' verified ineligible'],
        ['Selected',s.selected,s.final+' finally approved']
    ].map(([label,value,note])=>'<div class="card"><div class="card-title">'+label+'</div><div class="card-value">'+value+'</div><div class="card-trend">'+insightEscape(note)+'</div></div>').join('')+'</div>';
}

function renderDashboardMetrics() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px"><h2>Dashboard</h2><button type="button" class="btn btn-secondary" onclick="navigateToTab('overview')"><i class="fa-solid fa-chart-column"></i> View Overview</button></div>
        <div id="dashboard-summary-cards">${renderDashboardSummaryCards()}</div>
        ${renderPendingActionSummary()}
        ${renderInstituteApplicationsExportCard()}
        ${state.user.role === 'admin' ? renderAdminUploadWidgets() : ''}
        ${state.user.role === 'hod' ? renderHodDossierDashboard() : ''}
        ${state.user.role === 'coordinator' ? renderCoordinatorSupervisorUploadWidget() : ''}
        ${state.user.role==='super_admin' ? renderSuperAdminVacanciesWidget() : renderVacancySummaryWidget()}
    `;
    if (state.user.role === 'admin') setupUploadHandlers();
    else if (state.user.role === 'coordinator') {
        setupSupervisorUploadHandlers();
        loadSupervisorsDirectory();
    }
}

async function renderImportantDatesPage() {
    const mainContent = document.getElementById('main-content');

    try {
        const sRes = await api('/api/settings');
        if (sRes && sRes.settings) {
            state.settings = sRes.settings;
        }
    } catch (e) {
        console.warn('Could not refresh settings:', e);
    }
    const settings = state.settings || {};

    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;">Important Dates</h2>
        <div class="card animate-fade-in-up" style="max-width: 800px;">
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">Below are the critical deadlines for various tasks in the PhD admission workflow. Please ensure all tasks are completed on or before the respective dates.</p>
            
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <div style="padding: 1rem; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; color: var(--text-primary);"><i class="fa-solid fa-user-tie" style="color: var(--primary); margin-right: 8px;"></i> Supervisor Upload Deadline</h4>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">The last date to complete the supervisor allocation list upload for Coordinators.</p>
                    </div>
                    <div style="font-weight: bold; color: var(--info); font-size: 1.05rem; padding: 4px 12px; background: rgba(0, 123, 255, 0.1); border-radius: 4px;" id="disp-deadline-supervisor-upload">
                        ${formatDeadlineDate(settings.deadline_supervisor_upload)}
                    </div>
                </div>

                <div style="padding: 1rem; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; color: var(--text-primary);"><i class="fa-solid fa-file-invoice" style="color: var(--primary); margin-right: 8px;"></i> Question Paper Upload Deadline</h4>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">The last date to complete the question paper upload for Entrance Exams by HODs.</p>
                    </div>
                    <div style="font-weight: bold; color: var(--info); font-size: 1.05rem; padding: 4px 12px; background: rgba(0, 123, 255, 0.1); border-radius: 4px;" id="disp-deadline-question-paper">
                        ${formatDeadlineDate(settings.deadline_question_paper)}
                    </div>
                </div>

                <div style="padding: 1rem; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; color: var(--text-primary);"><i class="fa-solid fa-shield-halved" style="color: var(--primary); margin-right: 8px;"></i> Eligibility Verification Deadline</h4>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">The last date to complete the eligibility verification for all assigned candidates by HODs.</p>
                    </div>
                    <div style="font-weight: bold; color: var(--info); font-size: 1.05rem; padding: 4px 12px; background: rgba(0, 123, 255, 0.1); border-radius: 4px;" id="disp-deadline-eligibility">
                        ${formatDeadlineDate(settings.deadline_eligibility)}
                    </div>
                </div>

                <div style="padding: 1rem; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; color: var(--text-primary);"><i class="fa-solid fa-users-viewfinder" style="color: var(--primary); margin-right: 8px;"></i> Create Panels & Add Members Deadline</h4>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">The last date to add panel details and members by HODs.</p>
                    </div>
                    <div style="font-weight: bold; color: var(--info); font-size: 1.05rem; padding: 4px 12px; background: rgba(0, 123, 255, 0.1); border-radius: 4px;" id="disp-deadline-create-panels">
                        ${formatDeadlineDate(settings.deadline_create_panels)}
                    </div>
                </div>

                <div style="padding: 1rem; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; color: var(--text-primary);"><i class="fa-solid fa-user-check" style="color: var(--primary); margin-right: 8px;"></i> Allocate Candidates to Panels Deadline</h4>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">The last date to assign the panel to the candidates by HODs.</p>
                    </div>
                    <div style="font-weight: bold; color: var(--info); font-size: 1.05rem; padding: 4px 12px; background: rgba(0, 123, 255, 0.1); border-radius: 4px;" id="disp-deadline-allocate-panels">
                        ${formatDeadlineDate(settings.deadline_allocate_panels)}
                    </div>
                </div>
            </div>
        </div>

        ${['admin', 'super_admin'].includes(state.user.role) ? `
        <div class="card" style="margin-top: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;"><i class="fa-solid fa-calendar-check"></i> Manage Deadlines</h3>
                <button class="btn btn-primary btn-sm" onclick="saveAdminDeadlines(event)" id="save-deadlines-btn">
                    <i class="fa-solid fa-save"></i> Save Deadlines
                </button>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
                Set the final dates for these activities. When a deadline passes (midnight of the selected date), the system will automatically lock the respective feature. You can always override this by extending the date.
            </p>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                <!-- Deadline 1 -->
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border);">
                    <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">Supervisor Directory Upload</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">For Research Coordinators</div>
                    <input type="date" id="dl-supervisor-upload" class="form-control" style="width: 100%;" value="${state.settings?.deadline_supervisor_upload || ''}">
                </div>

                <!-- Deadline 2 -->
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border);">
                    <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">Question Papers Upload</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">For Heads of Departments (HODs)</div>
                    <input type="date" id="dl-question-paper" class="form-control" style="width: 100%;" value="${state.settings?.deadline_question_paper || ''}">
                </div>

                <!-- Deadline 3 -->
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border);">
                    <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">Candidate Eligibility Verification</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">For Heads of Departments (HODs)</div>
                    <input type="date" id="dl-eligibility" class="form-control" style="width: 100%;" value="${state.settings?.deadline_eligibility || ''}">
                </div>

                <!-- Deadline 4 -->
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border);">
                    <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">Create Panels & Add Members</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">For Heads of Departments (HODs)</div>
                    <input type="date" id="dl-create-panels" class="form-control" style="width: 100%;" value="${state.settings?.deadline_create_panels || ''}">
                </div>

                <!-- Deadline 5 -->
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border);">
                    <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">Allocate Candidates to Panels</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">For Heads of Departments (HODs)</div>
                    <input type="date" id="dl-allocate-panels" class="form-control" style="width: 100%;" value="${state.settings?.deadline_allocate_panels || ''}">
                </div>
            </div>
        </div>
        ` : ''}
    `;
}

