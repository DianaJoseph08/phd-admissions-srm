// --- COORDINATOR VISUAL CHARTS ---
function renderCoordinatorCharts() {
    const container = document.getElementById('coordinator-charts-container');
    if (!container) return;

    const list = state.candidates || [];
    const vacancies = state.vacancies || [];

    // 1. Candidate Funnel Data
    const pendingVerification = list.filter(c => ['Pending Verification', 'Under Coordinator Review', 'Under HOD Verification'].includes(c.status)).length;
    const verifiedEligible = list.filter(c => ['Eligible', 'Verified Eligible', 'Entrance Exam Attended', 'Marks Entered', 'Ranked', 'Ranks Released', 'Guide Allocation Open'].includes(c.status)).length;
    const verifiedIneligible = list.filter(c => ['Not Eligible', 'Verified Ineligible', 'Entrance Exam Absent', 'Evaluated (Failed Cutoff)'].includes(c.status)).length;
    const selected = list.filter(c => c.selection_status === 'Selected').length;

    // 2. Department vacancy data (Top 8 departments by session vacancy)
    const sortedDepts = [...vacancies].sort((a, b) => b.session_vacancy - a.session_vacancy).slice(0, 8);
    const deptNames = sortedDepts.map(v => v.department_name);
    const deptRemaining = sortedDepts.map(v => v.remaining_session_vacancy);
    const deptFilled = sortedDepts.map(v => v.total_allocated);

    container.innerHTML = `
        <div class="charts-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; margin-bottom: 1.5rem;">
            <div class="card animate-fade-in-up" style="padding: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 12px;">
                <h3 style="margin-bottom: 1rem; font-size: 1.05rem; color: var(--primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-chart-pie"></i> Candidate Admission Funnel
                </h3>
                <div style="height: 250px; position: relative; display: flex; justify-content: center; align-items: center;">
                    <canvas id="coordFunnelChart" style="max-height: 230px; max-width: 230px;"></canvas>
                </div>
            </div>
            <div class="card animate-fade-in-up" style="padding: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 12px;">
                <h3 style="margin-bottom: 1rem; font-size: 1.05rem; color: var(--primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-chart-bar"></i> Department Seat Utilization (Session)
                </h3>
                <div style="height: 250px; position: relative;">
                    <canvas id="coordDeptChart"></canvas>
                </div>
            </div>
        </div>
    `;

    try {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const textColor = isLight ? '#2c3e50' : '#e2e8f0';
        const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
        const tickColor = isLight ? '#4a5568' : '#94a3b8';

        // 1. Funnel Chart
        const funnelCtx = document.getElementById('coordFunnelChart').getContext('2d');
        new Chart(funnelCtx, {
            type: 'doughnut',
            data: {
                labels: ['Pending Verification', 'Verified Eligible', 'Verified Ineligible', 'Selected & Assigned'],
                datasets: [{
                    data: [pendingVerification, verifiedEligible, verifiedIneligible, selected],
                    backgroundColor: [
                        'rgba(245, 158, 11, 0.75)',  // amber
                        'rgba(59, 130, 246, 0.75)',  // blue
                        'rgba(239, 68, 68, 0.75)',   // red
                        'rgba(16, 185, 129, 0.75)'   // emerald
                    ],
                    borderColor: [
                        '#f59e0b',
                        '#3b82f6',
                        '#ef4444',
                        '#10b981'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { size: 10 } }
                    }
                }
            }
        });

        // 2. Department Chart
        const deptCtx = document.getElementById('coordDeptChart').getContext('2d');
        new Chart(deptCtx, {
            type: 'bar',
            data: {
                labels: deptNames,
                datasets: [
                    {
                        label: 'Seats Filled',
                        data: deptFilled,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderColor: '#10b981',
                        borderWidth: 1
                    },
                    {
                        label: 'Seats Remaining',
                        data: deptRemaining,
                        backgroundColor: 'rgba(59, 130, 246, 0.75)',
                        borderColor: '#3b82f6',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { size: 10 } }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: gridColor },
                        ticks: { color: tickColor, font: { size: 9 } }
                    },
                    y: {
                        stacked: true,
                        grid: { color: gridColor },
                        ticks: { color: tickColor, beginAtZero: true }
                    }
                }
            }
        });
    } catch (e) {
        console.error("Failed to render coordinator charts:", e);
    }
}

// --- SUPER ADMIN VISUAL CHARTS ---
function renderSuperAdminCharts() {
    const m=roleInsightModel();
    // Build institution totals from the same authorized records as the visible charts.
    state.analytics={institutions:m.institutes.map(g=>{
        const list=m.list.filter(c=>Number(c.institution_id)===g.id),selected=list.filter(c=>c.selection_status==='Selected');
        const recorded=list.filter(c=>c.total_marks!=null||['Entrance Exam Attended','Entrance Exam Absent','Marks Entered'].includes(c.status));
        return {institution_id:g.id,inst_name:g.label,campus:g.campus,count:g.total,eligible_count:g.eligible,ineligible_count:g.ineligible,selected_count:g.selected,
            present_count:recorded.filter(c=>c.exam_attendance==='Present').length,absent_count:recorded.filter(c=>c.exam_attendance==='Absent').length,
            selected_ft_wf:selected.filter(AdmissionStudyPolicy.isFullTimeWithFellowship).length,selected_ft_ss:selected.filter(AdmissionStudyPolicy.isFullTimeWithoutFellowship).length,
            selected_pte_acad:selected.filter(c=>/part time.*external.*academic/i.test(c.mode_of_study)).length,selected_pte_ind:selected.filter(c=>/part time.*external.*industry/i.test(c.mode_of_study)).length,selected_pti:selected.filter(c=>/part time.*internal/i.test(c.mode_of_study)).length};
    })};
    document.getElementById('main-content').innerHTML=`${renderRoleInsights()}
        <section class="card" style="margin-bottom:20px"><div class="insight-section-heading"><h3>Institute comparison</h3><button type="button" class="btn btn-secondary" onclick="exportInstitutionBreakdowns()">Download Excel</button></div>
        <div class="table-container"><table><thead><tr><th>Campus</th><th>Institute</th><th>Applications</th><th>Verified eligible</th><th>Verified ineligible</th><th>Selected</th></tr></thead><tbody>${state.analytics.institutions.map(i=>`<tr><td>${insightEscape(i.campus)}</td><td>${insightEscape(i.inst_name)}</td><td>${i.count}</td><td>${i.eligible_count}</td><td>${i.ineligible_count}</td><td>${i.selected_count}</td></tr>`).join('')}</tbody></table></div></section>
        `;
}

// --- ADMIN CONTROL PANELS ---
function renderAdminUploadWidgets() {
    return `
        <div class="analytics-chart-row animate-fade-in-up">
            <div class="card">
                <h3 style="margin-bottom: 1.2rem;"><i class="fa-solid fa-file-arrow-up"></i> Bulk Meritto Applications Import</h3>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
                    Upload the combined Excel file containing registrations from Meritto. The system will automatically classify candidates by Institution, Department, and match them to the correct Research Coordinator.
                </p>
                <div class="upload-dropzone" id="excel-dropzone">
                    <i class="fa-solid fa-file-excel"></i>
                    <span>Drag and drop applications spreadsheet (.xlsx) or click to browse</span>
                    <input type="file" id="excel-file-input" accept=".xlsx">
                </div>
                <div style="margin-top: 1rem; display: flex; gap: 10px;">
                    <a href="/Admin_Candidates_Upload_Template.xlsx" download class="btn btn-secondary" style="font-size: 0.8rem; text-decoration: none;">
                        <i class="fa-solid fa-download"></i> Download Excel Template
                    </a>
                    <a href="#" onclick="event.preventDefault(); showTemplateFormatModal();" class="btn btn-secondary" style="font-size: 0.8rem; text-decoration: none;">
                        <i class="fa-solid fa-table"></i> View Format
                    </a>
                    <a href="/Admin_Candidates_Upload_Instructions.txt" target="_blank" class="btn btn-secondary" style="font-size: 0.8rem; text-decoration: none;">
                        <i class="fa-solid fa-eye"></i> View Instructions
                    </a>
                </div>
                <div id="excel-upload-status" style="margin-top: 1rem; font-size: 0.85rem;"></div>
            </div>
            
            <script>
            window.showTemplateFormatModal = function() {
                const modalHtml = \`
                <div id="format-modal-overlay" class="modal-overlay" style="display:flex; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;">
                    <div class="modal-content" style="background:#fff; border-radius:12px; padding:2rem; width:90%; max-width:800px; max-height:80vh; overflow-y:auto; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 style="margin:0; color:#1e293b;">Required Excel Format</h3>
                            <button onclick="document.getElementById('format-modal-overlay').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:#64748b;">&times;</button>
                        </div>
                        <p style="margin-bottom:1rem; color:#475569;">Your Excel file must contain these exact column headers in the first row. The columns do not need to be in this exact order, but the spelling must match exactly.</p>
                        <div style="overflow-x:auto;">
                            <table class="table" style="width:100%; text-align:left; border-collapse:collapse; white-space:nowrap;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Form Name *</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Registered Name *</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Application No *</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Registered Email</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Registered Mobile</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Form Status *</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Ph.d Application Form 2027</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">John Doe</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">2701890001</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">john@example.com</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">9876543210</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Complete</td>
                                    </tr>
                                </tbody>
                            </table>
                            
                            <table class="table" style="width:100%; text-align:left; border-collapse:collapse; white-space:nowrap; margin-top:1rem;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Payment Status</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Payment Method</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Nationality *</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Mode Of Study</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Date Of Birth</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Payment Approved</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Online</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Indian (or Other|singapore)</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Full Time</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">01-01-1995</td>
                                    </tr>
                                </tbody>
                            </table>

                            <table class="table" style="width:100%; text-align:left; border-collapse:collapse; white-space:nowrap; margin-top:1rem;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Gender</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Institute *</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0; color:#ef4444;">Department *</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Program</th>
                                        <th style="padding:0.75rem; border:1px solid #e2e8f0;">Community (As Per Govt Norms)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Male</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Faculty Of Engineering...</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Computer Science Engineering</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Ph.d.- Computer Science...</td>
                                        <td style="padding:0.75rem; border:1px solid #e2e8f0;">Oc</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                \`;
                document.body.insertAdjacentHTML('beforeend', modalHtml);
            };
            </script>
            
            <div class="card">
                <h3 style="margin-bottom: 1.2rem;"><i class="fa-solid fa-folder-open"></i> Bulk Candidate Documents ZIP</h3>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
                    Upload the compressed ZIP file of applicant documents. The server will extract and automatically pair them to the candidate profiles using their Application Numbers.
                </p>
                <div class="upload-dropzone" id="zip-dropzone">
                    <i class="fa-solid fa-file-zip"></i>
                    <span>Drag and drop documents ZIP archive (.zip) or click to browse</span>
                    <input type="file" id="zip-file-input" accept=".zip">
                </div>
                <div id="zip-upload-status" style="margin-top: 1rem; font-size: 0.85rem;"></div>
            </div>
        </div>

        <div class="card animate-fade-in-up" style="margin-top: 2rem; border: 1px solid hsla(355, 75%, 55%, 0.35); background: hsla(355, 75%, 55%, 0.02); border-radius: var(--radius-md);">
            <h3 style="margin-bottom: 1rem; color: var(--danger); display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-triangle-exclamation"></i> Danger Zone
            </h3>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.4;">
                This utility will permanently delete all candidate profiles, interview marks, generated ranks, guide allocations, and physical document files on disk for your active campus. This action is irreversible.
            </p>
            <div>
                <button class="btn btn-danger" onclick="clearAllUploadedData()" style="padding: 10px 18px; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; border-radius: var(--radius-sm);">
                    <i class="fa-solid fa-trash-can"></i> Clear All Candidate Data & Files
                </button>
            </div>
        </div>
    `;
}

function renderSuperAdminVacanciesWidget() {
    if (!state.vacancies || state.vacancies.length === 0) return '';
    return `<div id="superadmin-vacancies-widget-container">${renderSuperAdminVacanciesWidgetContent()}</div>`;
}

function selectSuperAdminVacancyCampus(campusName) {
    state.superAdminActiveCampus = campusName;
    const campusVacancies = state.vacancies.filter(v => v.campus_name === campusName);
    const institutions = [...new Set(campusVacancies.map(v => v.institution_name))].sort();
    state.superAdminActiveInst = institutions[0] || '';
    
    const container = document.getElementById('superadmin-vacancies-widget-container');
    if (container) {
        container.innerHTML = renderSuperAdminVacanciesWidgetContent();
    }
}

function selectSuperAdminVacancyInst(instName) {
    state.superAdminActiveInst = instName;
    const container = document.getElementById('superadmin-vacancies-widget-container');
    if (container) {
        container.innerHTML = renderSuperAdminVacanciesWidgetContent();
    }
}

function renderSuperAdminVacanciesWidgetContent() {
    if (!state.vacancies || state.vacancies.length === 0) return '';

    const campuses = [...new Set(state.vacancies.map(v => v.campus_name))].sort();
    if (!state.superAdminActiveCampus || !campuses.includes(state.superAdminActiveCampus)) {
        state.superAdminActiveCampus = campuses[0] || '';
    }

    const campusVacancies = state.vacancies.filter(v => v.campus_name === state.superAdminActiveCampus);
    const institutions = [...new Set(campusVacancies.map(v => v.institution_name))].sort();
    if (!state.superAdminActiveInst || !institutions.includes(state.superAdminActiveInst)) {
        state.superAdminActiveInst = institutions[0] || '';
    }

    const filteredVacancies = campusVacancies.filter(v => v.institution_name === state.superAdminActiveInst);

    let totalVacancy = 0;
    let ftAllowed = 0;
    let ftFilled = 0;
    let ptFilled = 0;
    let totalFilled = 0;
    let remaining = 0;

    filteredVacancies.forEach(v => {
        totalVacancy += (v.total_vacancy || 0);
        if (v.ft_allowed !== null && v.ft_allowed !== undefined) {
            ftAllowed += v.ft_allowed;
        }
        ftFilled += (v.ft_wf_allocated || 0);
        ptFilled += (v.part_time_allocated || 0);
        totalFilled += (v.total_allocated || 0);
        remaining += (v.remaining_vacancy || 0);
    });

    const ftFillRate = ftAllowed > 0 ? ((ftFilled / ftAllowed) * 100).toFixed(0) : 0;

    return `
        <div class="card animate-fade-in-up" style="background: var(--bg-secondary); border: 1px solid var(--glass-border); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h3 style="margin:0; font-size: 1.1rem; color: var(--primary); display:flex; align-items:center; gap:8px;">
                        <i class="fa-solid fa-list-check"></i> Department-wise Supervisor Vacancies
                    </h3>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin: 2px 0 0 0;">View and configure intake limits for each campus and institution.</p>
                </div>
                <button onclick="exportVacancies()" style="display:flex; align-items:center; gap:6px; padding:6px 14px; background:var(--primary); color:#fff; border:none; border-radius:7px; font-size:0.8rem; font-weight:600; cursor:pointer; opacity:0.9; transition:opacity 0.15s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.9">
                    <i class="fa-solid fa-download"></i> Download Excel
                </button>
            </div>

            <!-- Campus Tabs -->
            <div class="sub-tabs-container" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 0.8rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.8rem;">
                ${campuses.map(campus => {
                    const isActive = state.superAdminActiveCampus === campus;
                    return `
                        <button class="sub-tab-btn ${isActive ? 'active' : ''}" onclick="selectSuperAdminVacancyCampus('${campus}')" style="display: inline-flex; align-items: center; gap: 6px; font-family: Cambria, Georgia, serif; cursor: pointer;">
                            <i class="fa-solid fa-building-columns"></i> ${campus}
                        </button>
                    `;
                }).join('')}
            </div>

            <!-- Institution Tabs -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.2rem;">
                ${institutions.map(inst => {
                    const isActive = state.superAdminActiveInst === inst;
                    return `
                        <button class="sub-tab-btn ${isActive ? 'active' : ''}" onclick="selectSuperAdminVacancyInst('${inst}')" style="display: inline-flex; align-items: center; gap: 6px; font-family: Cambria, Georgia, serif; cursor: pointer;">
                            <i class="fa-solid fa-university"></i> ${inst}
                        </button>
                    `;
                }).join('')}
            </div>

            <!-- Two Column Layout: Table and Analysis -->
            <div style="display: grid; grid-template-columns: 1.8fr 1fr; gap: 1.5rem;">
                <!-- Table -->
                <div class="table-container" style="margin:0; max-height: 380px; overflow-y: auto;">
                    <table style="font-size:0.85rem;">
                        <thead>
                            <tr>
                                <th style="width: 32%;">Department</th>
                                <th style="text-align: center; width: 13%;">Total Vacancy</th>
                                <th style="text-align: center; width: 15%;">FT (WF) Allowed <i class="fa-solid fa-pen-to-square" style="font-size:0.65rem; color:var(--primary); margin-left:2px;" title="Editable by Super Admin"></i></th>
                                <th style="text-align: center; width: 10%;">FT(WF) Filled</th>
                                <th style="text-align: center; width: 10%;">FT(SS) Filled</th>
                                <th style="text-align: center; width: 10%;">PT Filled</th>
                                <th style="text-align: center; width: 10%;">Total Filled</th>
                                <th style="text-align: center; width: 10%;">Remaining</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredVacancies.map(v => `
                                <tr>
                                    <td><strong>${v.department_name}</strong></td>
                                    <td style="text-align: center; color: var(--text-secondary);">${v.total_vacancy}</td>
                                    <td style="text-align: center;">
                                        <div style="display:flex; align-items:center; justify-content:center; gap:4px; position:relative;">
                                            <input
                                                type="number"
                                                min="0"
                                                id="ft-allowed-${v.department_id}"
                                                data-dept-id="${v.department_id}"
                                                value="${v.ft_allowed !== null && v.ft_allowed !== undefined ? v.ft_allowed : ''}"
                                                placeholder="—"
                                                title="Enter FT scholar intake for this session"
                                                style="width:55px; text-align:center; background:var(--bg-primary); border:1px solid var(--primary); border-radius:6px; padding:3px 6px; color:var(--text-primary); font-size:0.85rem; outline:none;"
                                                onkeydown="if(event.key==='Enter') this.blur();"
                                                onblur="saveFtAllowed(${v.department_id}, this)"
                                            />
                                            <span id="ft-allowed-status-${v.department_id}" style="font-size:0.75rem; position:absolute; right:-18px;"></span>
                                        </div>
                                    </td>
                                    <td style="text-align: center; color: var(--info); font-weight: 500;">${v.ft_wf_allocated || 0}</td>
                                    <td style="text-align: center; color: var(--info); font-weight: 500;">${v.ft_ss_allocated || 0}</td>
                                    <td style="text-align: center; color: var(--warning); font-weight: 500;">${v.part_time_allocated}</td>
                                    <td style="text-align: center;">${v.total_allocated}</td>
                                    <td style="text-align: center; font-weight: 700; color: ${v.remaining_vacancy > 0 ? 'var(--success)' : 'var(--text-muted)'};">${v.remaining_vacancy}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- Analysis Panel -->
                <div class="analysis-panel superadmin-analysis-panel" style="background: var(--bg-primary); border: 1px solid var(--glass-border); padding: 1.2rem; border-radius: 10px; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <h4 style="margin-bottom: 0.8rem; font-size: 0.95rem; color: var(--primary); display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-chart-line"></i> Summary - ${state.superAdminActiveInst}
                        </h4>
                        
                        <div style="margin-bottom: 1.2rem;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                                <span style="color: var(--text-secondary);">FT With Fellowship Utilization</span>
                                <span style="font-weight: 700; color: var(--info);">${ftFillRate}%</span>
                            </div>
                            <div class="progress-bar-container" style="margin: 0; background: var(--bg-tertiary); height: 8px; border-radius: 4px;">
                                <div class="progress-bar-fill" style="width: ${ftFillRate}%; background: var(--info); border-radius: 4px;"></div>
                            </div>
                        </div>

                        <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.85rem; display: flex; flex-direction: column; gap: 10px;">
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Total supervisor overall seats:</span>
                                <strong style="color: var(--text-primary);">${totalVacancy} slots</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Full-Time with Fellowship limit:</span>
                                <strong style="color: var(--primary);">${ftAllowed || '—'}</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Full-Time with Fellowship selected:</span>
                                <strong style="color: var(--info);">${ftFilled} / ${ftAllowed || '—'}</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Part-Time scholars allocated:</span>
                                <strong style="color: var(--warning);">${ptFilled}</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                                <span style="color: var(--text-secondary);">Total active scholars:</span>
                                <strong style="color: var(--text-primary);">${totalFilled}</strong>
                            </li>
                            <li style="display: flex; justify-content: space-between;">
                                <span style="color: var(--text-secondary);">Overall remaining capacity:</span>
                                <strong style="color: var(--success);">${remaining} seats open</strong>
                            </li>
                        </ul>
                    </div>

                    <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; margin-top: 1.2rem; border-top: 1px solid var(--glass-border); padding-top: 0.6rem;">
                        <i class="fa-solid fa-circle-info"></i> As Super Admin / Director Research, you can configure the Full Time with Fellowship intake directly in the table input fields.
                    </div>
                </div>
            </div>
        </div>
    `;
}

function updateSuperAdminVacancyAnalysis() {
    const campusVacancies = state.vacancies.filter(v => v.campus_name === state.superAdminActiveCampus);
    const filteredVacancies = campusVacancies.filter(v => v.institution_name === state.superAdminActiveInst);

    let totalVacancy = 0;
    let ftAllowed = 0;
    let ftFilled = 0;
    let ptFilled = 0;
    let totalFilled = 0;
    let remaining = 0;

    filteredVacancies.forEach(v => {
        totalVacancy += (v.total_vacancy || 0);
        if (v.ft_allowed !== null && v.ft_allowed !== undefined) {
            ftAllowed += v.ft_allowed;
        }
        ftFilled += (v.ft_wf_allocated || 0);
        ptFilled += (v.part_time_allocated || 0);
        totalFilled += (v.total_allocated || 0);
        remaining += (v.remaining_vacancy || 0);
    });

    const ftFillRate = ftAllowed > 0 ? ((ftFilled / ftAllowed) * 100).toFixed(0) : 0;

    const analysisPanel = document.querySelector('.superadmin-analysis-panel');
    if (analysisPanel) {
        analysisPanel.innerHTML = `
            <div>
                <h4 style="margin-bottom: 0.8rem; font-size: 0.95rem; color: var(--primary); display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-chart-line"></i> Summary - ${state.superAdminActiveInst}
                </h4>
                
                <div style="margin-bottom: 1.2rem;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                        <span style="color: var(--text-secondary);">FT With Fellowship Utilization</span>
                        <span style="font-weight: 700; color: var(--info);">${ftFillRate}%</span>
                    </div>
                    <div class="progress-bar-container" style="margin: 0; background: var(--bg-tertiary); height: 8px; border-radius: 4px;">
                        <div class="progress-bar-fill" style="width: ${ftFillRate}%; background: var(--info); border-radius: 4px;"></div>
                    </div>
                </div>

                <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.85rem; display: flex; flex-direction: column; gap: 10px;">
                    <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                        <span style="color: var(--text-secondary);">Total supervisor overall seats:</span>
                        <strong style="color: var(--text-primary);">${totalVacancy} slots</strong>
                    </li>
                    <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                        <span style="color: var(--text-secondary);">Full-Time with Fellowship limit:</span>
                        <strong style="color: var(--primary);">${ftAllowed || '—'}</strong>
                    </li>
                    <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                        <span style="color: var(--text-secondary);">Full-Time with Fellowship selected:</span>
                        <strong style="color: var(--info);">${ftFilled} / ${ftAllowed || '—'}</strong>
                    </li>
                    <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                        <span style="color: var(--text-secondary);">Part-Time scholars allocated:</span>
                        <strong style="color: var(--warning);">${ptFilled}</strong>
                    </li>
                    <li style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--glass-border);">
                        <span style="color: var(--text-secondary);">Total active scholars:</span>
                        <strong style="color: var(--text-primary);">${totalFilled}</strong>
                    </li>
                    <li style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">Overall remaining capacity:</span>
                        <strong style="color: var(--success);">${remaining} seats open</strong>
                    </li>
                </ul>
            </div>

            <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; margin-top: 1.2rem; border-top: 1px solid var(--glass-border); padding-top: 0.6rem;">
                <i class="fa-solid fa-circle-info"></i> As Super Admin / Director Research, you can configure the Full Time with Fellowship intake directly in the table input fields.
            </div>
        `;
    }
}

window.selectSuperAdminVacancyCampus = selectSuperAdminVacancyCampus;
window.selectSuperAdminVacancyInst = selectSuperAdminVacancyInst;

function setupUploadHandlers() {
    const excelZone = document.getElementById('excel-dropzone');
    const excelInput = document.getElementById('excel-file-input');
    const excelStatus = document.getElementById('excel-upload-status');

    excelZone.addEventListener('click', () => excelInput.click());
    excelInput.addEventListener('change', () => handleUpload(excelInput.files[0], '/api/admin/upload-excel', excelStatus));

    const zipZone = document.getElementById('zip-dropzone');
    const zipInput = document.getElementById('zip-file-input');
    const zipStatus = document.getElementById('zip-upload-status');

    zipZone.addEventListener('click', () => zipInput.click());
    zipInput.addEventListener('change', () => handleUpload(zipInput.files[0], '/api/admin/upload-zip', zipStatus));
}

async function handleUpload(file, url, statusElement) {
    if (!file) return;
    statusElement.innerHTML = `<span style="color: var(--warning)"><i class="fa-solid fa-spinner fa-spin"></i> Uploading and processing file...</span>`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await api(url, 'POST', formData, true);

        let html = `<span style="color: var(--success)"><i class="fa-solid fa-circle-check"></i> ${res.message}</span>`;

        // Show unmapped candidates warning
        if (res.unmapped_count && res.unmapped_count > 0) {
            html += `
            <div style="margin-top: 0.8rem; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.35); border-radius: 8px; padding: 12px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-weight:600; color: var(--warning);">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    ${res.unmapped_count} candidate(s) had unrecognised institution/department and were routed to the <strong>Ramapuram Research Office</strong> account.
                </div>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:6px;">
                    Login as <code style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px;">rmp_research_office</code> / <code style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px;">ResearchOffice@2026</code> to review and reassign them.
                </div>
                ${res.unmapped_details && res.unmapped_details.length > 0 ? `
                <details style="margin-top:4px;">
                    <summary style="cursor:pointer; font-size:0.78rem; color:var(--primary); font-weight:600;">View ${res.unmapped_details.length} unmapped row(s)</summary>
                    <ul style="margin:6px 0 0 0; padding-left:16px; font-size:0.75rem; color:var(--text-muted); line-height:1.6; max-height:120px; overflow-y:auto;">
                        ${res.unmapped_details.map(d => `<li>${d}</li>`).join('')}
                    </ul>
                </details>` : ''}
            </div>`;
        }

        // Show hard errors (row-level parse failures)
        if (res.errors && res.errors.length > 0) {
            html += `
            <div style="margin-top: 0.6rem; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.25); border-radius:8px; padding:10px;">
                <details>
                    <summary style="cursor:pointer; font-size:0.78rem; color:var(--danger); font-weight:600;"><i class="fa-solid fa-circle-xmark"></i> ${res.errors.length} row error(s)</summary>
                    <ul style="margin:6px 0 0 0; padding-left:16px; font-size:0.75rem; color:var(--text-muted); line-height:1.6; max-height:120px; overflow-y:auto;">
                        ${res.errors.map(e => `<li>${e}</li>`).join('')}
                    </ul>
                </details>
            </div>`;
        }

        statusElement.innerHTML = html;
        showToast(res.message);
        loadTabSpecificData(); // Reload table
    } catch (err) {
        statusElement.innerHTML = `<span style="color: var(--danger)"><i class="fa-solid fa-circle-xmark"></i> Error: ${err.message}</span>`;
        showToast(err.message, 'error');
    }
}


// --- HOD DASHBOARD: VERIFICATION PANEL & DOSSIER ---
function renderHodDossierDashboard() {
    const pendingList = state.candidates.filter(c => c.current_owner === 'HOD' && ['Under HOD Verification', 'Returned to HOD', 'Complete', 'Pending Verification'].includes(c.status) && (c.form_status || '').toLowerCase() !== 'incomplete');
    const incompleteList = state.candidates.filter(c => (c.form_status || '').toLowerCase() === 'incomplete');
    const completedList = state.candidates.filter(c => (c.form_status || '').toLowerCase() !== 'incomplete');
    const activeSubTab = state.activeHodSubTab || 'pending';

    const dlEligibility = getDeadlineStatus('deadline_eligibility', 'Candidate Eligibility Verification');
    const isPastDeadline = dlEligibility.isPast;
    const deadlineBadgeHtml = dlEligibility.badgeHtml;

    let contentHtml = '';

    if (activeSubTab === 'pending') {
        const rowsHtml = pendingList.map((c, index) => {
            let statusBadgeClass = 'badge-warning';
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${c.application_no}</strong></td>
                    <td>
                        <div style="font-weight:600;">${c.registered_name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${c.email || ''}</div>
                    </td>
                    <td><span class="badge ${statusBadgeClass}">${c.status}</span></td>
                    <td>${c.mode_of_study || ''}</td>
                    <td>
                        <button class="btn btn-secondary" onclick="toggleCandidateDossier(${c.id}, this)" style="padding: 4px 8px; font-size:0.78rem;">
                            <i class="fa-solid fa-folder-open"></i> View Dossier / Docs
                        </button>
                        ${renderHodPanelAction(c)}
                    </td>
                </tr>
            `;
        }).join('');

        contentHtml = pendingList.length === 0 ? `
            <div style="text-align:center; padding: 2rem; color: var(--text-muted);">
                <i class="fa-solid fa-circle-check fa-2x" style="color: var(--success); margin-bottom: 1rem;"></i><br>
                <strong>All candidates have been processed.</strong><br>
                <span style="font-size: 0.85rem;">No candidates pending eligibility verification.</span>
            </div>` : `
            <div class="table-container">
                <table class="table-compact">
                    <thead>
                        <tr>
                            <th>S.No</th>
                            <th>App No</th>
                            <th>Candidate Name</th>
                            <th>Status</th>
                            <th>Mode</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="hod-candidates-tbody">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>`;
    } else if (activeSubTab === 'incomplete') {
        const rowsHtml = incompleteList.map((c, index) => `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${c.application_no}</strong></td>
                <td>
                    <div style="font-weight:600;">${c.registered_name}</div>
                </td>
                <td><a href="mailto:${c.email}" style="color:var(--primary); text-decoration:none;"><i class="fa-solid fa-envelope"></i> ${c.email || ''}</a></td>
                <td><a href="tel:${c.mobile}" style="color:var(--text-primary); text-decoration:none;"><i class="fa-solid fa-phone"></i> ${c.mobile || ''}</a></td>
                <td><span class="badge badge-danger" style="background-color:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.2);">Incomplete</span></td>
                <td>
                    <a href="mailto:${c.email}?subject=Incomplete PhD Application - SRM&body=Dear ${c.registered_name},%0D%0A%0D%0AWe noticed that your PhD application (${c.application_no}) is incomplete. Please log in and complete the required sections as soon as possible so we can proceed with your eligibility verification.%0D%0A%0D%0ABest regards,%0D%0AHOD Department of ${state.user.department_name || 'Research'}" class="btn btn-primary btn-sm" style="padding: 4px 8px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px; font-family: Cambria, Georgia, serif;">
                        <i class="fa-solid fa-paper-plane"></i> Contact Candidate
                    </a>
                </td>
            </tr>
        `).join('');

        contentHtml = `
            <div class="table-container">
                <table class="table-compact">
                    <thead>
                        <tr>
                            <th>S.No</th>
                            <th>App No</th>
                            <th>Candidate Name</th>
                            <th>Email ID</th>
                            <th>Mobile Number</th>
                            <th>Form Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="hod-candidates-tbody">
                        ${rowsHtml || '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No incomplete applications in your department.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        const rowsHtml = completedList.map((c, index) => {
            let statusBadgeClass = 'badge-pending';
            if (['Eligible', 'Verified Eligible', 'Verified'].includes(c.status)) {
                statusBadgeClass = 'badge-success';
            } else if (['Not Eligible', 'Verified Ineligible', 'Ineligible'].includes(c.status)) {
                statusBadgeClass = 'badge-danger';
            }
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${c.application_no}</strong></td>
                    <td>
                        <div style="font-weight:600;">${c.registered_name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${c.email || ''}</div>
                    </td>
                    <td><span class="badge ${statusBadgeClass}">${c.status}</span></td>
                    <td>${c.mode_of_study || ''}</td>
                    <td>
                        ${(function() {
                            if (state.user.role !== 'hod' || !canAllotInterviewPanel(c)) return '';
                            const dlAllocate = getDeadlineStatus('deadline_allocate_panels', 'Candidate Panel Allocation');
                            if (dlAllocate.isPast) {
                                return `<div style="font-size: 0.75rem; color: var(--danger-color); margin-top: 4px;" title="Deadline passed on ${dlAllocate.dateStr}"><i class="fa-solid fa-lock"></i> Deadline Passed (${dlAllocate.dateStr})</div>`;
                            }
                            const panels = state.hodPanels || [];
                            const options = panels.map(p => `<option value="${p.id}" ${c.panel_id === p.id ? 'selected' : ''}>${p.panel_name}</option>`).join('');
                            return `
                            <div style="margin-top: 4px; max-width: 150px;">
                                <select class="form-control" style="font-size: 0.75rem; padding: 2px 4px; height: auto;" onchange="assignPanelInline(${c.id}, this.value)">
                                    <option value="">-- No Panel --</option>
                                    ${options}
                                </select>
                            </div>`;
                        })()}
                    </td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                            <button class="btn btn-secondary" onclick="toggleCandidateDossier(${c.id}, this)" style="padding: 4px 8px; font-size:0.78rem;">
                                <i class="fa-solid fa-folder-open"></i> View Dossier / Docs
                            </button>
                        ${renderHodPanelAction(c)}
                            ${(c.status === 'HOD Verified Eligible' || c.status === 'HOD Verified Ineligible') ? `
                            <button class="btn btn-warning animate-fade-in" onclick="toggleCandidateDossier(${c.id}, this)" style="padding: 4px 8px; font-size:0.78rem;">
                                <i class="fa-solid fa-pen"></i> Edit Eligibility
                            </button>
                            <button class="btn btn-primary animate-fade-in" onclick="hodForwardToRC(${c.id})" style="padding: 4px 8px; font-size:0.78rem; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none;">
                                <i class="fa-solid fa-share-from-square"></i> Forward to RC
                            </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        contentHtml = `
            <div class="table-container">
                <table class="table-compact">
                    <thead>
                        <tr>
                            <th>S.No</th>
                            <th>App No</th>
                            <th>Candidate</th>
                            <th>Status</th>
                            <th>Mode</th>
                            <th>Interview Panel</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="hod-candidates-tbody">
                        ${rowsHtml || '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No candidates registered in your department.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    }

    return `
        <div class="card animate-fade-in-up" style="margin-top: 1.5rem; background: linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(59,130,246,0.02) 100%); border: 1px solid rgba(59,130,246,0.2); padding: 1.2rem 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <div>
                    <div style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; color: var(--primary); letter-spacing: 0.5px;">
                        <i class="fa-solid fa-building-columns"></i> ${state.user.department_name || 'Department'} &bull; ${state.user.institution_name || ''} &bull; ${state.user.campus_name || (state.user.campus_id === 1 ? 'Ramapuram' : 'Trichy')}
                    </div>
                    <h3 style="margin: 0.3rem 0; display: flex; align-items: center; gap: 8px;">
                        <span>${state.user.name}</span>
                        <span class="badge badge-primary" style="font-size: 0.72rem; padding: 2px 8px;">HOD</span>
                    </h3>
                    <div style="font-size: 0.88rem; color: var(--text-secondary); display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span><i class="fa-solid fa-envelope" style="color: var(--primary); margin-right: 4px;"></i> Registered Email: <strong id="hod-dashboard-email" style="color: var(--text-primary);">${state.user.email || 'Not configured'}</strong></span>
                        <span style="color: var(--text-muted);">&bull;</span>
                        <span><i class="fa-solid fa-user" style="color: var(--text-muted); margin-right: 4px;"></i> Login Username: <code style="font-weight: bold; color: var(--primary);">${state.user.username}</code></span>
                    </div>
                </div>
                <div>
                    <button class="btn btn-secondary btn-sm" onclick="showProfileModal()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-family: Cambria, Georgia, serif; border-color: rgba(59,130,246,0.3);">
                        <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit Email ID
                    </button>
                </div>
            </div>
        </div>

        <div class="card animate-fade-in-up" style="margin-top: 1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.2rem;">
                <h3><i class="fa-solid fa-shield-halved"></i> Eligibility Verification Dossier</h3>
                <div style="display: flex; gap: 8px;">
                    <button onclick="downloadMinutes()" class="btn btn-success" style="padding: 6px 12px; font-size: 0.8rem; font-family: Cambria, Georgia, serif;">
                        <i class="fa-solid fa-file-word"></i> Minutes of Meeting
                    </button>
                </div>
            </div>

            ${deadlineBadgeHtml}
            <div id="hod-eligibility-review" tabindex="-1" style="display:none;"></div>

            <div class="tabs-header" style="margin-bottom: 1.2rem; display: flex; gap: 8px;">
                <button class="tab-btn ${activeSubTab === 'pending' ? 'active' : ''}" onclick="switchHodSubTab('pending')" style="font-family: Cambria, Georgia, serif;">
                    <i class="fa-solid fa-clock"></i> Pending Verification (${pendingList.length})
                </button>
                <button class="tab-btn ${activeSubTab === 'incomplete' ? 'active' : ''}" onclick="switchHodSubTab('incomplete')" style="font-family: Cambria, Georgia, serif;">
                    <i class="fa-solid fa-circle-exclamation"></i> Incomplete Applications (${incompleteList.length})
                </button>
                <button class="tab-btn ${activeSubTab === 'all' ? 'active' : ''}" onclick="switchHodSubTab('all')" style="font-family: Cambria, Georgia, serif;">
                    <i class="fa-solid fa-users"></i> All Processed Candidates (${completedList.length})
                </button>
            </div>
            
            ${contentHtml}
        </div>
    `;
}

function switchHodSubTab(tab) {
    state.activeHodSubTab = tab;
    const panel = document.getElementById('dossier-details-panel');
    if (panel) panel.style.display = 'none';
    navigateToTab('dashboard');
}
window.switchHodSubTab = switchHodSubTab;

function filterHodCandidatesList(query) {
    const cleanQuery = query.toLowerCase().trim();
    const activeSubTab = state.activeHodSubTab || 'pending';
    let sourceList = state.candidates;
    if (activeSubTab === 'incomplete') {
        sourceList = state.candidates.filter(c => (c.form_status || '').toLowerCase() === 'incomplete');
    } else if (activeSubTab === 'all') {
        sourceList = state.candidates.filter(c => (c.form_status || '').toLowerCase() !== 'incomplete');
    }

    const rows = sourceList.filter(c => {
        return (c.application_no ? c.application_no.toString().includes(cleanQuery) : false) ||
               ((c.registered_name || '').toLowerCase().includes(cleanQuery)) ||
               ((c.status || '').toLowerCase().includes(cleanQuery)) ||
               ((c.email || '').toLowerCase().includes(cleanQuery)) ||
               ((c.mobile || '').toLowerCase().includes(cleanQuery)) ||
               ((c.mode_of_study || '').toLowerCase().includes(cleanQuery));
    });
    const tbody = document.getElementById('hod-candidates-tbody');
    if (!tbody) return;
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${activeSubTab === 'incomplete' ? 7 : (activeSubTab === 'all' ? 7 : 6)}" style="text-align:center; padding: 2rem; color: var(--text-muted);">No candidates found.</td></tr>`;
        return;
    }
    if (activeSubTab === 'incomplete') {
        tbody.innerHTML = rows.map((c, index) => `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${c.application_no}</strong></td>
                <td>
                    <div style="font-weight:600;">${c.registered_name}</div>
                </td>
                <td><a href="mailto:${c.email}" style="color:var(--primary); text-decoration:none;"><i class="fa-solid fa-envelope"></i> ${c.email || ''}</a></td>
                <td><a href="tel:${c.mobile}" style="color:var(--text-primary); text-decoration:none;"><i class="fa-solid fa-phone"></i> ${c.mobile || ''}</a></td>
                <td><span class="badge badge-danger" style="background-color:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.2);">Incomplete</span></td>
                <td>
                    <a href="mailto:${c.email}?subject=Incomplete PhD Application - SRM&body=Dear ${c.registered_name},%0D%0A%0D%0AWe noticed that your PhD application (${c.application_no}) is incomplete. Please log in and complete the required sections as soon as possible so we can proceed with your eligibility verification.%0D%0A%0D%0ABest regards,%0D%0AHOD Department of ${state.user.department_name || 'Research'}" class="btn btn-primary btn-sm" style="padding: 4px 8px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px; font-family: Cambria, Georgia, serif;">
                        <i class="fa-solid fa-paper-plane"></i> Contact Candidate
                    </a>
                </td>
            </tr>
        `).join('');
    } else {
        tbody.innerHTML = rows.map((c, index) => {
            let statusBadgeClass = 'badge-pending';
            if (['Eligible', 'Verified Eligible', 'Verified'].includes(c.status)) {
                statusBadgeClass = 'badge-success';
            } else if (['Not Eligible', 'Verified Ineligible', 'Ineligible'].includes(c.status)) {
                statusBadgeClass = 'badge-danger';
            }
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${c.application_no}</strong></td>
                    <td>
                        <div style="font-weight:600;">${c.registered_name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${c.email || ''}</div>
                    </td>
                    <td><span class="badge ${statusBadgeClass}">${c.status}</span></td>
                    <td>${c.mode_of_study || ''}</td>
                    <td>
                        ${(function() {
                            if (state.user.role !== 'hod' || !canAllotInterviewPanel(c)) return '';
                            const dlAllocate = getDeadlineStatus('deadline_allocate_panels', 'Candidate Panel Allocation');
                            if (dlAllocate.isPast) {
                                return `<div style="font-size: 0.75rem; color: var(--danger-color); margin-top: 4px;" title="Deadline passed on ${dlAllocate.dateStr}"><i class="fa-solid fa-lock"></i> Deadline Passed (${dlAllocate.dateStr})</div>`;
                            }
                            const panels = state.hodPanels || [];
                            const options = panels.map(p => `<option value="${p.id}" ${c.panel_id === p.id ? 'selected' : ''}>${p.panel_name}</option>`).join('');
                            return `
                            <div style="margin-top: 4px; max-width: 150px;">
                                <select class="form-control" style="font-size: 0.75rem; padding: 2px 4px; height: auto;" onchange="assignPanelInline(${c.id}, this.value)">
                                    <option value="">-- No Panel --</option>
                                    ${options}
                                </select>
                            </div>`;
                        })()}
                    </td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                            <button class="btn btn-secondary" onclick="toggleCandidateDossier(${c.id}, this)" style="padding: 4px 8px; font-size:0.78rem;">
                                <i class="fa-solid fa-folder-open"></i> View Dossier / Docs
                            </button>
                        ${renderHodPanelAction(c)}
                            ${(c.status === 'HOD Verified Eligible' || c.status === 'HOD Verified Ineligible') ? `
                            <button class="btn btn-warning animate-fade-in" onclick="toggleCandidateDossier(${c.id}, this)" style="padding: 4px 8px; font-size:0.78rem;">
                                <i class="fa-solid fa-pen"></i> Edit Eligibility
                            </button>
                            <button class="btn btn-primary animate-fade-in" onclick="hodForwardToRC(${c.id})" style="padding: 4px 8px; font-size:0.78rem; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none;">
                                <i class="fa-solid fa-share-from-square"></i> Forward to RC
                            </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}
window.filterHodCandidatesList = filterHodCandidatesList;

async function hodForwardToRC(candidateId) {
    if (!confirm('Are you sure you want to forward this candidate\'s eligibility status to the Research Coordinator?')) return;
    try {
        await api('/api/hod/forward-verified', 'POST', { candidateIds: [candidateId] });
        showToast('Successfully forwarded to Research Coordinator.');
        navigateToTab('dashboard');
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.hodForwardToRC = hodForwardToRC;

function checkCandidateRegulations(candidate, documents) {
    const warnings = [];
    const docTypes = documents.map(d => d.document_type);

    const cat = (candidate.category || 'General').toLowerCase();
    const isRelaxed = cat.includes('sc') || cat.includes('st') || cat.includes('obc') || cat.includes('bc') || cat.includes('ews') || cat.includes('mbc');
    const requiredPG = isRelaxed ? 50 : 55;

    const hasPGUploaded = docTypes.some(t => /PG/i.test(t) && !/CMS|Mark|Cumulative/i.test(t));
    const hasUGUploaded = docTypes.some(t => /UG/i.test(t) && !/CMS|Mark|Cumulative/i.test(t));
    const hasPGEntered = candidate.pg_percentage !== null && candidate.pg_percentage !== undefined && candidate.pg_percentage !== '';
    
    // Rule 1: PG Percentage check (only show warning if it exists AND is below required)
    if (hasPGEntered) {
        const pgVal = parseFloat(candidate.pg_percentage);
        if (!isNaN(pgVal) && pgVal < requiredPG) {
            warnings.push(`<strong>Regulations Warning (PG Marks):</strong> Candidate PG percentage (${pgVal}%) is below the minimum required ${requiredPG}% for category ${candidate.category || 'General'}.`);
        }
    }

    // Rule 2: UG Percentage check (only check direct UG pathway if it exists AND is below 75%)
    if (!hasPGUploaded && !hasPGEntered) {
        const hasUGEntered = candidate.ug_percentage !== null && candidate.ug_percentage !== undefined && candidate.ug_percentage !== '';
        if (hasUGEntered) {
            const ugVal = parseFloat(candidate.ug_percentage);
            if (!isNaN(ugVal) && ugVal < 75) {
                warnings.push(`<strong>Regulations Warning (UG Marks):</strong> Direct admission after a 4-year UG degree requires a minimum of 75% marks. Candidate UG percentage (${ugVal}%) is below 75%.`);
            }
        }
    }

    // Rule 3: PG Certificate is normally required. If missing, check UG pathway requirements
    if (!hasPGUploaded) {
        if (hasUGUploaded) {
            warnings.push("<strong>Regulations Warning (clause 3.1):</strong> No PG Certificate uploaded. According to SRM regulations, admission directly after a 4-year Bachelor's degree (UG) requires the candidate to have obtained First Class with Distinction (min 75% marks) AND a qualified national-level test (UGC-NET/CSIR-NET/GATE/CEED). Please verify these qualifications carefully.");
        } else {
            warnings.push("<strong>Regulations Violation:</strong> Neither PG nor UG Certificate uploaded. Regulations require verification of a Master's degree (min 55% marks, or 50% for SC/ST/OBC/EWS) or a 4-year Bachelor's degree (min 75% marks + National level test).");
        }
    }

    // Rule 4: Part-time external check
    if (candidate.mode_of_study && candidate.mode_of_study.toLowerCase().includes('external')) {
        warnings.push("<strong>Regulations Check (clause 8.ii):</strong> Part-Time (External) candidate. The candidate must have a recognized Co-supervisor/Research coordinator from their employing organization, and their place of employment must be recognized as a Research Centre by SRMIST.");
    }

    // Rule 5: Interdisciplinary Program check
    if (candidate.is_interdisciplinary === 1) {
        warnings.push("<strong>Regulations Check (Interdisciplinary Program):</strong> The candidate has applied for a Ph.D. program in a discipline different from their parent PG degree. Equivalence committee clearance or special interdisciplinary review may be required.");
    }

    return warnings;
}

window.toggleCandidateDossier = function(candidateId, btnElement) {
    try {
        if (!btnElement) throw new Error("Button element missing");
        
        const tr = btnElement.closest ? btnElement.closest('tr') : null;
        if (!tr) throw new Error("Could not find the table row for this candidate");
        
        let dossierRow = document.getElementById(`dossier-row-${candidateId}`);
        
        if (dossierRow) {
            if (dossierRow.style.display === 'none') {
                dossierRow.style.display = 'table-row';
            } else {
                dossierRow.style.display = 'none';
            }
        } else {
            dossierRow = document.createElement('tr');
            dossierRow.id = `dossier-row-${candidateId}`;
            const tdCount = tr.children ? tr.children.length : 7;
            dossierRow.innerHTML = `<td colspan="${tdCount}" style="padding:0; border:none; border-bottom: 2px solid var(--primary);">
                <div id="dossier-container-${candidateId}" class="animate-fade-in" style="padding: 20px; background: var(--bg-secondary); border-left: 4px solid var(--primary); box-shadow: inset 0 3px 6px rgba(0,0,0,0.05); margin-bottom: 15px;">
                    <div style="text-align:center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading dossier...</div>
                </div>
            </td>`;
            if (tr.parentNode) {
                tr.parentNode.insertBefore(dossierRow, tr.nextSibling);
            } else {
                throw new Error("Table row has no parent node");
            }
            loadCandidateDossier(candidateId, `dossier-container-${candidateId}`);
        }
    } catch (e) {
        alert("Error opening dossier: " + e.message);
    }
}

async function loadCandidateDossier(candidateId, targetContainerId = 'dossier-details-panel') {
    const panel = document.getElementById(targetContainerId);
    if (!panel) return;
    if (!candidateId) {
        panel.style.display = 'none';
        return;
    }

    try {
        const data = await api(`/api/candidates/${candidateId}`);
        state.selectedCandidate = data.candidate;
        const docs = data.documents;

        let panelsDropdownOptions = '';
        if (state.user.role === 'hod') {
            try {
                const panelsRes = await api('/api/hod/panels');
                const panels = panelsRes.panels || [];
                panelsDropdownOptions = panels.map(p => `
                    <option value="${p.id}" ${data.candidate.panel_id === p.id ? 'selected' : ''}>${transferEscape(p.panel_name)}</option>
                `).join('');
            } catch (pErr) {
                console.error("Failed to load department panels", pErr);
            }
        }

        let docsList = '<p style="font-size:0.85rem; color:var(--text-muted)">No certificates uploaded yet.</p>';
        if (docs.length > 0) {
            docsList = docs.map(d => {
                let safePath = (d.file_path || '').replace(/\\/g, '/');
                if (!safePath.startsWith('http') && !safePath.startsWith('/')) {
                    safePath = '/' + safePath;
                }
                return `
                <a class="btn btn-secondary" href="${transferEscape(safePath)}" target="iframe-${candidateId}" onclick="document.getElementById('pdf-placeholder-${candidateId}').style.display='none'; document.getElementById('pdf-iframe-viewer-${candidateId}').style.display='block';" style="display: flex; align-items: center; gap: 8px; justify-content: flex-start; text-align: left; width: 100%; margin-bottom: 6px; text-decoration: none;">
                    <i class="fa-solid fa-file-pdf"></i> ${transferEscape(d.document_type)} (${transferEscape(d.file_name)})
                </a>
            `}).join('');
        }

        let warningsHtml = '';
        if (state.user.role === 'hod') {
            const warnings = checkCandidateRegulations(data.candidate, docs);
            warningsHtml = `
                <div id="dossier-warnings-container" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 12px; margin-top: 1rem; margin-bottom: 1rem; width: 100%; display: ${warnings.length > 0 ? 'block' : 'none'};">
                    <h5 style="color: #ef4444; margin: 0 0 6px 0; display:flex; align-items:center; gap: 6px; font-size: 0.95rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Regulations Warning Note
                    </h5>
                    <ul style="margin: 0; padding-left: 18px; color: var(--text-primary); font-size: 0.82rem; line-height: 1.4;">
                        ${warnings.map(w => `<li style="margin-bottom: 6px;">${w}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        const isPending = ['Under HOD Verification', 'Returned to HOD', 'Complete', 'Pending Verification', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(data.candidate.status) && data.candidate.current_owner === 'HOD';
        
        const dlEligibility = getDeadlineStatus('deadline_eligibility', 'Candidate Eligibility Verification');
        const isPastDeadline = dlEligibility.isPast;

        const dlAllocate = getDeadlineStatus('deadline_allocate_panels', 'Candidate Panel Allocation');
        const isAllocatePastDeadline = dlAllocate.isPast;

        let decisionPanelHtml = '';
        if (isPending && state.user.role === 'hod') {
            if (isPastDeadline) {
                decisionPanelHtml = `
                    <div class="card" style="background-color: var(--bg-tertiary); border: 1px solid var(--glass-border); text-align: center;">
                        <i class="fa-solid fa-lock" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 1rem;"></i>
                        <h4 style="margin: 0 0 0.5rem 0;">Verification Locked</h4>
                        <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">The deadline for eligibility verification passed on ${dlEligibility.dateStr}.</p>
                    </div>
                `;
            } else {
                const currentEligibility = data.candidate.status === 'HOD Verified Ineligible' ? 'Not Eligible' : 'Eligible';
                const currentReason = transferEscape(data.candidate.status_reason || '');
                const isUpdate = data.candidate.status.startsWith('HOD Verified');
                decisionPanelHtml = `
                    <div class="card" style="background-color: var(--bg-tertiary);">
                        ${dlEligibility.badgeHtml}
                        <h4>Eligibility Decisions</h4>
                        <form id="verify-eligibility-form-${candidateId}" style="margin-top: 1rem;">
                        <div class="form-group">
                            <label>Eligibility Result</label>
                            <div style="display:flex; gap: 16px; margin-top: 6px;">
                                <label style="display:flex; align-items:center; gap: 6px; cursor:pointer;">
                                    <input type="radio" name="verify-status-${candidateId}" value="Eligible" ${currentEligibility === 'Eligible' ? 'checked' : ''}> Eligible
                                </label>
                                <label style="display:flex; align-items:center; gap: 6px; cursor:pointer;">
                                    <input type="radio" name="verify-status-${candidateId}" value="Not Eligible" ${currentEligibility === 'Not Eligible' ? 'checked' : ''}> Not Eligible
                                </label>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="verify-reason-${candidateId}">Remarks / Reason (Mandatory if Ineligible)</label>
                            <textarea id="verify-reason-${candidateId}" class="form-control" rows="3" placeholder="Enter remarks...">${currentReason}</textarea>
                        </div>
                        <button type="submit" class="btn ${isUpdate ? 'btn-warning' : 'btn-success'}" style="width: 100%;">
                            ${isUpdate ? 'Update Eligibility Decision <i class="fa-solid fa-pen"></i>' : 'Submit Eligibility Decision <i class="fa-solid fa-square-check"></i>'}
                        </button>
                    </form>
                </div>
            `;
            }
        } else {
            let statusBadgeClass = 'badge-pending';
            if (['Eligible', 'Verified Eligible', 'Verified'].includes(data.candidate.status)) {
                statusBadgeClass = 'badge-success';
            } else if (['Not Eligible', 'Verified Ineligible', 'Ineligible'].includes(data.candidate.status)) {
                statusBadgeClass = 'badge-danger';
            }
            decisionPanelHtml = `
                <div class="card" style="background-color: var(--bg-tertiary); border: 1px solid var(--glass-border);">
                    <h4>Eligibility Verification Status</h4>
                    <div style="margin-top: 1rem; line-height: 1.6;">
                        <div style="margin-bottom: 10px;">
                            <span style="font-size:0.9rem; color:var(--text-secondary)">Current Status:</span><br>
                            <span class="badge ${statusBadgeClass}" style="font-size: 0.9rem; padding: 4px 10px;">${transferEscape(data.candidate.status)}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <span style="font-size:0.9rem; color:var(--text-secondary)">Current Owner:</span><br>
                            <strong>${transferEscape(data.candidate.current_owner || 'System')}</strong>
                        </div>
                        ${data.candidate.status_reason ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--primary); margin-top: 10px;">
                            <span style="font-size:0.8rem; color:var(--text-secondary)">Verification Remarks:</span><br>
                            <span style="font-size:0.85rem;">${transferEscape(data.candidate.status_reason)}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        panel.style.display = 'block';
        panel.innerHTML = `
            <div class="dossier-grid" style="margin-top: 1.5rem; border-top: 1px solid var(--glass-border); padding-top: 1.5rem;">
                <div>
                    <h4 style="margin-bottom: 1rem; color: var(--primary);">Candidate Dossier</h4>
                    <p style="margin-bottom: 6px;">Application No: <strong>${transferEscape(data.candidate.application_no)}</strong></p>
                    <p style="margin-bottom: 6px;">Name: <strong>${transferEscape(data.candidate.registered_name)}</strong></p>
                    <p style="margin-bottom: 6px;">DOB: <strong>${transferEscape(data.candidate.dob)}</strong></p>
                    <p style="margin-bottom: 6px;">Study Mode: <strong>${transferEscape(data.candidate.mode_of_study)}</strong></p>
                    <p style="margin-bottom: 6px;">Program: <strong>${transferEscape(data.candidate.program)}</strong></p>
                    <p style="margin-bottom: 6px;">Category: <strong>${transferEscape(data.candidate.category || 'General')}</strong></p>
                    <p style="margin-bottom: 6px;">Assigned Panel: <strong data-assigned-panel="${candidateId}">${transferEscape(data.panel ? data.panel.panel_name : 'None')}</strong></p>
                    ${data.candidate.supervisor_name ? '<p>Supervisor: <strong>'+transferEscape(data.candidate.supervisor_name)+'</strong></p>' : ''}
                    ${data.candidate.allocation_remark ? '<p><strong>Allocation reason:</strong> '+transferEscape(data.candidate.allocation_remark)+'</p>' : ''}
                    ${state.user.role === 'hod' ? renderHodPanelAction(data.candidate) : ''}
                    ${data.panel && data.panel.members && data.panel.members.length > 0 ? `
                    <div style="margin-bottom: 12px; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 8px; max-width: 400px;">
                        <span style="font-size:0.8rem; color:var(--text-secondary); font-weight:600;">Panel Members:</span>
                        <ul style="margin: 4px 0 0 0; padding-left: 16px; font-size: 0.85rem; line-height: 1.4;">
                            ${data.panel.members.map(m => `<li><strong>${transferEscape(m.name)}</strong> (${transferEscape(m.designation)})</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}

                    <div style="margin-top: 1.5rem; margin-bottom: 1.5rem;">
                        ${decisionPanelHtml}
                    </div>
                    

                    
                    ${warningsHtml}
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; margin-bottom: 0.8rem;">
                        <h5 style="margin: 0;">Uploaded Documents</h5>
                        ${['admin', 'super_admin', 'hod'].includes(state.user.role) ? `
                            <button class="btn btn-sm btn-outline-primary" style="font-size: 0.75rem; padding: 3px 8px;" onclick="document.getElementById('direct-doc-upload-${candidateId}').click()">
                                <i class="fa-solid fa-cloud-arrow-up"></i> Upload Document(s)
                            </button>
                        ` : ''}
                    </div>
                    ${['admin', 'super_admin', 'hod'].includes(state.user.role) ? `
                        <input type="file" id="direct-doc-upload-${candidateId}" multiple style="display:none;" onchange="handleDirectCandidateUpload(${candidateId}, this.files, '${targetContainerId}')">
                        <div id="direct-doc-status-${candidateId}" style="margin-bottom: 6px; font-size: 0.8rem;"></div>
                    ` : ''}
                    <div style="max-height: 220px; overflow-y: auto;">
                        ${docsList}
                    </div>

                    ${isPending && canInitiateCandidateTransfer(data.candidate) ? `
                    <div style="margin-top: 1.5rem; display: flex; gap: 10px;">
                        <button class="btn btn-secondary" onclick="openTransferRequestModal(${data.candidate.id})">
                            <i class="fa-solid fa-arrow-right-arrow-left"></i> Transfer Candidate
                        </button>
                    </div>
                    ` : ''}
                </div>

                <div id="pdf-viewer-container-${candidateId}" style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 500px;">
                    <h4 style="margin-bottom: 0.8rem; color: var(--primary);">Certificate Preview</h4>
                    <div id="pdf-placeholder-${candidateId}" style="flex: 1; display: flex; align-items: center; justify-content: center; background: var(--bg-tertiary); border: 2px dashed var(--glass-border); border-radius: 8px; color: var(--text-muted); min-height: 600px;">
                        <div style="text-align: center;">
                            <i class="fa-solid fa-file-pdf" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                            <p>Select a document from the list to preview it here.</p>
                        </div>
                    </div>
                    <iframe name="iframe-${candidateId}" id="pdf-iframe-viewer-${candidateId}" class="doc-viewer-frame" style="display: none; height: 90%; min-height: 600px; border: 1px solid var(--glass-border); border-radius: 8px;"></iframe>
                </div>
            </div>
        `;

        const verifyForm = document.getElementById(`verify-eligibility-form-${candidateId}`);
        if (verifyForm && !isPastDeadline) {
            verifyForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const eligibility = verifyForm.querySelector(`input[name="verify-status-${candidateId}"]:checked`).value;
                const reason = document.getElementById(`verify-reason-${candidateId}`).value;

                if (eligibility === 'Not Eligible' && !reason.trim()) {
                    showToast('Please state a reason for ineligibility.', 'error');
                    return;
                }

                try {
                    await api(`/api/candidates/${candidateId}/verify`, 'POST', { eligibility, reason });
                    
                    showToast('Verification submitted successfully. You can now forward it to the RC from the All Processed Candidates tab.');
                    navigateToTab('dashboard'); // Reload and reset
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDirectCandidateUpload(candidateId, files, containerId) {
    if (!files || files.length === 0) return;
    const statusEl = document.getElementById(`direct-doc-status-${candidateId}`);
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--warning);"><i class="fa-solid fa-spinner fa-spin"></i> Uploading document(s)...</span>';

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
        const res = await api(`/api/candidates/${candidateId}/upload-documents`, 'POST', formData, true);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);"><i class="fa-solid fa-circle-check"></i> ${res.message}</span>`;
        showToast(res.message || 'Documents uploaded successfully');
        setTimeout(() => {
            loadCandidateDossier(candidateId, containerId);
        }, 800);
    } catch (err) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);"><i class="fa-solid fa-circle-xmark"></i> ${err.message || 'Upload failed'}</span>`;
        showToast(err.message || 'Upload failed', 'error');
    }
}
window.handleDirectCandidateUpload = handleDirectCandidateUpload;

function viewCertificate(filePath, candidateId = null) {
    try {
        const idSuffix = candidateId ? `-${candidateId}` : '';
        const iframe = document.getElementById(`pdf-iframe-viewer${idSuffix}`) || document.getElementById('pdf-iframe-viewer');
        const placeholder = document.getElementById(`pdf-placeholder${idSuffix}`) || document.getElementById('pdf-placeholder');
        
        if (placeholder) placeholder.style.display = 'none';
        
        if (iframe) {
            iframe.style.display = 'block';
            let normalizedPath = filePath.replace(/\\/g, '/');
            if (!normalizedPath.startsWith('http') && !normalizedPath.startsWith('/')) {
                normalizedPath = '/' + normalizedPath;
            }
            iframe.src = normalizedPath;
        } else {
            alert("Error: Document viewer frame not found on the page.");
        }
    } catch (err) {
        alert("Error loading document: " + err.message);
    }
}

// Transfer Request Modal
function openTransferRequestModal(candidateId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 520px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-arrow-right-arrow-left" style="color: var(--primary); margin-right: 8px;"></i> Transfer Candidate</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="transfer-candidate-form">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom: 1.2rem; line-height: 1.4;">
                        If this candidate mistakenly applied to your department or faculty, specify the target department and the reason. The transfer will route to the Research Coordinator and Dean for approval.
                    </p>
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label for="transfer-to-inst"><strong>Target Institution / Faculty <span style="color:var(--danger)">*</span></strong></label>
                        <select id="transfer-to-inst" class="form-control" required onchange="populateTransferDepartments(this.value)">
                            <option value="">-- Select Institution / Faculty --</option>
                            
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label for="transfer-to-dept"><strong>Target Department <span style="color:var(--danger)">*</span></strong></label>
                        <select id="transfer-to-dept" class="form-control" required>
                            <option value="">-- Select Department --</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="transfer-reason"><strong>Reason for Transfer <span style="color:var(--danger)">*</span></strong></label>
                        <textarea id="transfer-reason" class="form-control" rows="3" required placeholder="State why this candidate should be transferred (e.g. Applicant's degree is in ECE, mistakenly applied to Mechanical)..."></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">
                            <i class="fa-solid fa-paper-plane"></i> Submit Transfer Request
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    populateTransferInstitutions('transfer-to-inst');

    document.getElementById('transfer-candidate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const to_institution_id = document.getElementById('transfer-to-inst').value;
        const to_department_id = document.getElementById('transfer-to-dept').value;
        const reason = document.getElementById('transfer-reason').value;

        if (!reason || !reason.trim()) {
            showToast('Please provide a reason for the transfer.', 'error');
            return;
        }

        if (!transferSubmitLock(e.currentTarget)) return;
        const submittedForm = e.currentTarget;
        try {
            await api('/api/candidates/transfer', 'POST', {
                candidate_id: candidateId,
                to_institution_id,
                to_department_id,
                reason: reason.trim()
            });
            showToast('Transfer request submitted and routed to Research Coordinator.');
            modal.remove();
            if (window.refreshTransferPendingCount) {
                await window.refreshTransferPendingCount();
            }
            navigateToTab('transfers');
        } catch (err) {
            showToast(err.message, 'error');
        } finally { transferSubmitUnlock(submittedForm); }
    });
}

// Configured destinations are provided by the same validation used at submission.
async function populateTransferDepartments(instId) {
    const select = document.getElementById('transfer-to-dept');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Department --</option>';
    if (!instId) return;
    select.disabled = true;
    try {
        const metadata = await api('/api/transfers/destinations');
        if (document.getElementById('transfer-to-dept') !== select) return;
        const instituteSelect = document.getElementById('transfer-to-inst');
        if (instituteSelect && Number(instituteSelect.value) !== Number(instId)) return;
        for (const department of metadata.departments.filter(d => Number(d.institution_id) === Number(instId))) {
            select.add(new Option(department.name, department.id));
        }
    } catch (error) { showToast(error.message, 'error'); }
    finally { select.disabled = false; }
}

window.viewCertificate = viewCertificate;

// Open the Dashboard's existing dossier rather than a second eligibility form.
async function openHodEligibilityDashboard(candidateId) {
    if (state.user.role !== 'hod') return;
    state.activeHodSubTab = 'all';
    await navigateToTab('dashboard');
    if (state.activeTab !== 'dashboard') return;
    const candidate = state.candidates.find(c => Number(c.id) === Number(candidateId));
    if (!candidate) return showToast('Candidate is no longer available in your department.', 'error');
    await loadCandidateDossier(candidateId, 'hod-eligibility-review');
    const review = document.getElementById('hod-eligibility-review');
    if (review && review.style.display !== 'none') {
        review.scrollIntoView({ behavior: 'smooth', block: 'start' });
        review.focus({ preventScroll: true });
    }
}
window.openHodEligibilityDashboard = openHodEligibilityDashboard;
