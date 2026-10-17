// --- ENTRANCE EXAM QUESTION PAPER MANAGEMENT (HOD & ADMIN) ---

function renderHodQuestionPapersPage() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    const dl = getDeadlineStatus('deadline_question_paper', 'Question Paper Upload');
    const isPastDeadline = dl.isPast;
    const deadlineBadgeHtml = dl.badgeHtml;


    const papers = state.hodQuestionPapers || [];
    const setAPaper = papers.find(p => p.set_name === 'A');
    const setBPaper = papers.find(p => p.set_name === 'B');
    const pastPapers = papers.filter(p => p.set_name !== 'A' && p.set_name !== 'B');

    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;">
            <i class="fa-solid fa-file-invoice" style="margin-right: 10px; color: var(--primary);"></i>
            Entrance Exam Question Papers
        </h2>
        ${deadlineBadgeHtml}
        
        <!-- Info / SOP card -->
        <div class="card" style="margin-bottom: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem;">
                <div style="flex: 1; min-width: 300px;">
                    <h3 style="color: var(--primary); font-size: 1.3rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-file-word"></i> Question Paper Template & Guidelines
                    </h3>
                    <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0;">
                        As the Head of Department, you are required to upload two sets of entrance exam question papers (Set A and Set B) for your department. Please download the standard template below, format your questions accordingly, and upload both files. The system will automatically parse the multiple-choice questions (MCQs) and compile a balanced, shuffled common paper.
                    </p>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <a href="/templates/SRMIST_PhD_QP_Template_Set_A_Jan2027.docx" class="btn btn-primary" download style="white-space: nowrap; height: fit-content; padding: 10px 18px;">
                        <i class="fa-solid fa-download"></i> Template Set A (.docx)
                    </a>
                    <a href="/templates/SRMIST_PhD_QP_Template_Set_B_Jan2027.docx" class="btn btn-secondary" download style="white-space: nowrap; height: fit-content; padding: 10px 18px;">
                        <i class="fa-solid fa-download"></i> Template Set B (.docx)
                    </a>
                </div>
            </div>
        </div>

        <!-- Two sets upload grid -->
        <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem;">
            <!-- Set A Card -->
            <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--glass-border); padding-bottom: 1rem; margin-bottom: 1.2rem;">
                        <h3 style="font-size: 1.2rem; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-file-lines" style="color: var(--primary);"></i> Set A Paper
                        </h3>
                        ${setAPaper 
                            ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check" style="margin-right:4px;"></i>Uploaded</span>`
                            : `<span class="badge badge-pending"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:4px;"></i>Pending</span>`}
                    </div>

                    <div style="background-color: var(--bg-primary); padding: 1.2rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); margin-bottom: 1.5rem;">
                        ${setAPaper 
                            ? `<div style="font-size: 0.9rem; line-height: 1.6; display: flex; justify-content: space-between; align-items: start;">
                                 <div style="word-break: break-all; flex: 1;">
                                   <div><strong>Original File:</strong> <span style="color: var(--text-secondary);">${setAPaper.file_name}</span></div>
                                   <div style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 4px;"><strong>Uploaded on:</strong> ${new Date(setAPaper.created_at).toLocaleString()}</div>
                                 </div>
                                 ${!isPastDeadline ? `<button class="btn btn-sm" onclick="deleteQuestionPaper(${setAPaper.id}, 'A')" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); padding: 4px 8px; font-size: 0.75rem; border-radius: 4px; cursor: pointer; white-space: nowrap; margin-left: 10px;">
                                   <i class="fa-solid fa-trash-can"></i> Delete
                                 </button>` : ''}
                               </div>`
                            : `<div style="font-size: 0.9rem; color: var(--text-muted); text-align: center; padding: 0.5rem 0;">
                                 <i class="fa-solid fa-circle-info" style="margin-right: 6px;"></i>No file uploaded for Set A yet.
                               </div>`}
                    </div>
 
                    ${isPastDeadline ? `
                    <div style="background-color: var(--bg-tertiary); padding: 1.5rem; border-radius: 8px; border: 1px dashed var(--glass-border); text-align: center;">
                        <i class="fa-solid fa-lock" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 1rem;"></i>
                        <h4 style="margin: 0 0 0.5rem 0;">Uploads Locked</h4>
                        <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">The deadline for question paper upload passed on ${dl.dateStr}.</p>
                    </div>
                    ` : `
                    <div class="upload-dropzone" id="dropzone-A">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span style="font-size: 0.9rem; font-weight: 500; display: block; margin-bottom: 4px;">Drag & drop Set A (.docx) or click to browse</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">Word documents only</span>
                        <input type="file" id="file-input-A" accept=".docx" style="display:none;">
                    </div>
                    `}
                </div>
                <div id="status-A" style="font-size: 0.85rem; margin-top: 1rem; min-height: 24px;"></div>
            </div>
 
            <!-- Set B Card -->
            <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--glass-border); padding-bottom: 1rem; margin-bottom: 1.2rem;">
                        <h3 style="font-size: 1.2rem; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-file-lines" style="color: var(--primary);"></i> Set B Paper
                        </h3>
                        ${setBPaper 
                            ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check" style="margin-right:4px;"></i>Uploaded</span>`
                            : `<span class="badge badge-pending"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:4px;"></i>Pending</span>`}
                    </div>
 
                    <div style="background-color: var(--bg-primary); padding: 1.2rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); margin-bottom: 1.5rem;">
                        ${setBPaper 
                            ? `<div style="font-size: 0.9rem; line-height: 1.6; display: flex; justify-content: space-between; align-items: start;">
                                 <div style="word-break: break-all; flex: 1;">
                                   <div><strong>Original File:</strong> <span style="color: var(--text-secondary);">${setBPaper.file_name}</span></div>
                                   <div style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 4px;"><strong>Uploaded on:</strong> ${new Date(setBPaper.created_at).toLocaleString()}</div>
                                 </div>
                                 ${!isPastDeadline ? `<button class="btn btn-sm" onclick="deleteQuestionPaper(${setBPaper.id}, 'B')" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); padding: 4px 8px; font-size: 0.75rem; border-radius: 4px; cursor: pointer; white-space: nowrap; margin-left: 10px;">
                                   <i class="fa-solid fa-trash-can"></i> Delete
                                 </button>` : ''}
                               </div>`
                            : `<div style="font-size: 0.9rem; color: var(--text-muted); text-align: center; padding: 0.5rem 0;">
                                 <i class="fa-solid fa-circle-info" style="margin-right: 6px;"></i>No file uploaded for Set B yet.
                               </div>`}
                    </div>

                    ${isPastDeadline ? `
                    <div style="background-color: var(--bg-tertiary); padding: 1.5rem; border-radius: 8px; border: 1px dashed var(--glass-border); text-align: center;">
                        <i class="fa-solid fa-lock" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 1rem;"></i>
                        <h4 style="margin: 0 0 0.5rem 0;">Uploads Locked</h4>
                        <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">The deadline for question paper upload passed on ${dl.dateStr}.</p>
                    </div>

                    ` : `
                    <div class="upload-dropzone" id="dropzone-B">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span style="font-size: 0.9rem; font-weight: 500; display: block; margin-bottom: 4px;">Drag & drop Set B (.docx) or click to browse</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">Word documents only</span>
                        <input type="file" id="file-input-B" accept=".docx" style="display:none;">
                    </div>
                    `}
                </div>
                <div id="status-B" style="font-size: 0.85rem; margin-top: 1rem; min-height: 24px;"></div>
            </div>
        </div>

        <!-- Past Session Reference Papers -->
        <div class="card" style="margin-top: 2rem;">
            <h3 style="color: var(--primary); font-size: 1.3rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-clock-rotate-left"></i> Past Session Reference Papers
            </h3>
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.5;">
                You can download your department's past question papers from the January and July 2026 sessions for reference. 
                Note that uploading a new paper containing more than 10 repeated questions from these reference sets is not allowed.
            </p>

            ${pastPapers.length === 0 
                ? `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                     <i class="fa-solid fa-folder-open fa-2xl" style="margin-bottom: 0.5rem; display: block; color: var(--text-muted);"></i>
                     No past session papers found for your department.
                   </div>`
                : `
                <div class="table-container" style="margin-bottom: 0; border-radius: var(--radius-sm);">
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 25%;">Session & Set</th>
                                <th style="width: 50%;">Original File Name</th>
                                <th style="width: 25%; text-align: center;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pastPapers.map(p => {
                                const parts = p.set_name.split('_');
                                const prefix = parts[0];
                                const set = parts[1] || '';
                                
                                let year = '2026';
                                let term = '';
                                if (prefix.startsWith('JAN')) {
                                    term = 'January';
                                    year = prefix.replace('JAN', '') || '2026';
                                } else if (prefix.startsWith('JUL')) {
                                    term = 'July';
                                    year = prefix.replace('JUL', '') || '2026';
                                }
                                if (year.length === 2) year = '20' + year;
                                const sessionLabel = `${term} ${year} - Set ${set}`;

                                return `
                                    <tr>
                                        <td style="font-weight: 600;">${sessionLabel}</td>
                                        <td style="font-size: 0.85rem; color: var(--text-secondary); word-break: break-all;">${p.file_name}</td>
                                        <td style="text-align: center;">
                                            <button class="btn btn-secondary btn-sm" onclick="downloadPastQuestionPaper(${p.id}, '${p.file_name.replace(/'/g, "\\'")}')" style="padding: 6px 12px; font-size: 0.8rem;">
                                                <i class="fa-solid fa-download"></i> Download Set
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                `
            }
        </div>
    `;

    setupHodDropzones();
}

function setupHodDropzones() {
    ['A', 'B'].forEach(set => {
        const zone = document.getElementById(`dropzone-${set}`);
        const input = document.getElementById(`file-input-${set}`);
        const status = document.getElementById(`status-${set}`);
        
        if (!zone || !input) return;

        zone.addEventListener('click', () => input.click());

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.style.borderColor = 'var(--primary)';
            zone.style.backgroundColor = 'var(--primary-glow)';
        });

        zone.addEventListener('dragleave', () => {
            zone.style.borderColor = '';
            zone.style.backgroundColor = '';
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.borderColor = '';
            zone.style.backgroundColor = '';
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleQuestionPaperUpload(e.dataTransfer.files[0], set, status);
            }
        });

        input.addEventListener('change', () => {
            if (input.files && input.files.length > 0) {
                handleQuestionPaperUpload(input.files[0], set, status);
            }
        });
    });
}

async function handleQuestionPaperUpload(file, setLetter, statusElement) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.docx')) {
        statusElement.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-circle-xmark"></i> Error: Only .docx files are allowed.</span>`;
        return;
    }

    statusElement.innerHTML = `<span style="color: var(--warning);"><i class="fa-solid fa-spinner fa-spin"></i> Uploading & parsing Set ${setLetter}...</span>`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('set', setLetter);

    try {
        const res = await api('/api/hod/upload-question-paper', 'POST', formData, true);
        statusElement.innerHTML = `<span style="color: var(--success);"><i class="fa-solid fa-circle-check"></i> ${res.message}</span>`;
        showToast(res.message);
        
        // Refresh State and View
        const refreshRes = await api('/api/hod/question-papers');
        state.hodQuestionPapers = refreshRes.questionPapers || [];
        setTimeout(() => {
            renderHodQuestionPapersPage();
        }, 1500);
    } catch (err) {
        statusElement.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-circle-xmark"></i> ${err.message}</span>`;
        showToast(err.message, 'error');

        if (err.data && err.data.duplicates && err.data.duplicates.length > 0) {
            showDuplicateQuestionsModal(err.data.duplicates, setLetter, err.data.duplicateCount, err.data.maxAllowed || 10);
        }
    }
}

function renderAdminQuestionPapersPage() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    const deptsRaw = state.adminQuestionPapers || [];
    
    const groupedDepts = {};
    deptsRaw.forEach(d => {
        if (!groupedDepts[d.name]) {
            groupedDepts[d.name] = {
                name: d.name,
                id: d.id,
                campuses: {}
            };
        }
        Object.assign(groupedDepts[d.name].campuses, d.campuses);
    });

    const depts = Object.values(groupedDepts);

    if (depts.length === 0) {
        mainContent.innerHTML = `
            <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;"><i class="fa-solid fa-file-invoice"></i> Question Papers Management</h2>
            <div class="card" style="text-align: center; padding: 3rem;">
                <i class="fa-solid fa-folder-open fa-3x" style="color: var(--text-muted); margin-bottom: 1rem;"></i>
                <p style="font-size: 1.1rem; color: var(--text-secondary);">No departments or campuses configured in the system.</p>
            </div>
        `;
        return;
    }

    let rowsHtml = depts.map((d, index) => {
        const rmp = d.campuses['Ramapuram'];
        const tryc = d.campuses['Trichy'];

        const renderStatusCell = (campusData, setLetter) => {
            if (!campusData) {
                return `<td style="text-align: center; color: var(--text-muted); font-size: 0.8rem; font-style: italic;">N/A</td>`;
            }
            const set = setLetter === 'A' ? campusData.setA : campusData.setB;
            if (set) {
                return `
                    <td style="text-align: center;">
                        <div style="display: inline-flex; align-items: center; gap: 6px;">
                            <span class="badge badge-success" title="Uploaded: ${set.file_name}&#10;On: ${new Date(set.uploaded_at).toLocaleString()}" style="cursor: help;">
                                <i class="fa-solid fa-check"></i> Uploaded
                            </span>
                            <button class="btn" onclick="deleteQuestionPaper(${set.id}, 'Set ${setLetter}')" style="padding: 2px 6px; font-size: 0.7rem; border-radius: 4px; border: 1px solid rgba(239,68,68,0.2); color: #ef4444; background: rgba(239,68,68,0.05); cursor: pointer;" title="Delete this uploaded paper">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                `;
            } else {
                return `
                    <td style="text-align: center;">
                        <span class="badge badge-pending">
                            <i class="fa-solid fa-clock"></i> Pending
                        </span>
                    </td>
                `;
            }
        };

        const hasAnyPaper = (rmp && (rmp.setA || rmp.setB)) || (tryc && (tryc.setA || tryc.setB));

        return `
            <tr>
                <td style="font-weight: 600; text-align: center;">${index + 1}</td>
                <td style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary);">${d.name}</td>
                ${renderStatusCell(rmp, 'A')}
                ${renderStatusCell(rmp, 'B')}
                ${renderStatusCell(tryc, 'A')}
                ${renderStatusCell(tryc, 'B')}
                <td style="text-align: center;">
                    ${hasAnyPaper 
                        ? `<button class="btn btn-primary btn-sm" onclick="generateCommonQuestionPaper(${d.id}, '${d.name.replace(/'/g, "\\'")}')" style="padding: 6px 12px; font-size: 0.8rem;">
                             <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Common Paper
                           </button>`
                        : `<button class="btn btn-disabled btn-sm" disabled style="padding: 6px 12px; font-size: 0.8rem;">
                             <i class="fa-solid fa-ban"></i> No Papers Uploaded
                           </button>`}
                </td>
            </tr>
        `;
    }).join('');

    mainContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
            <div>
                <h2 style="margin: 0; font-size: 1.8rem;">
                    <i class="fa-solid fa-file-invoice" style="margin-right: 10px; color: var(--primary);"></i>
                    Question Papers Matrix
                </h2>
                <p style="font-size: 0.9rem; color: var(--text-secondary); margin: 6px 0 0 0; line-height: 1.5;">
                    Below is the matrix showing question paper uploads across departments and campuses. Click <strong>Generate Common Paper</strong> to combine papers from all active campuses for a department, shuffle and balance them, and generate the final candidate document and answer key in a single ZIP download.
                </p>
            </div>
            <div>
                <a href="/api/admin/question-papers/export-drive-zip" class="btn btn-primary" download style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; text-decoration: none; font-weight: 500;">
                    <i class="fa-brands fa-google-drive" style="font-size: 1.1rem;"></i>
                    <span>Export All for Google Drive (ZIP)</span>
                </a>
            </div>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th style="width: 5%; text-align: center; border-bottom: 2px solid var(--glass-border);">S.No</th>
                        <th style="width: 30%; border-bottom: 2px solid var(--glass-border);">Department</th>
                        <th style="width: 12.5%; text-align: center; border-bottom: 2px solid var(--glass-border);">RMP Set A</th>
                        <th style="width: 12.5%; text-align: center; border-bottom: 2px solid var(--glass-border);">RMP Set B</th>
                        <th style="width: 12.5%; text-align: center; border-bottom: 2px solid var(--glass-border);">TRY Set A</th>
                        <th style="width: 12.5%; text-align: center; border-bottom: 2px solid var(--glass-border);">TRY Set B</th>
                        <th style="width: 15%; text-align: center; border-bottom: 2px solid var(--glass-border);">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>

        <div class="card animate-fade-in-up" style="margin-top: 2rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); padding: 1.5rem; border-radius: 12px; max-width: 650px;">
            <h3 style="margin-bottom: 0.5rem; font-size: 1.15rem; color: var(--primary); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-file-arrow-up"></i> Upload Past Session Question Paper (Reference)
            </h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.2rem;">
                Upload a past session DOCX question paper to use as a duplicate-check reference.
            </p>
            <form id="admin-past-qp-form" onsubmit="handlePastQpUpload(event)">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="past-qp-campus">Campus</label>
                        <select id="past-qp-campus" class="form-control" onchange="updatePastQpInstitutions()" required>
                            <option value="">-- Select Campus --</option>
                            ${state.metadata.campuses.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="past-qp-institute">Institute</label>
                        <select id="past-qp-institute" class="form-control" onchange="updatePastQpDepts()" required disabled>
                            <option value="">-- Select Institute --</option>
                        </select>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="past-qp-dept">Department</label>
                        <select id="past-qp-dept" class="form-control" required disabled>
                            <option value="">-- Select Department --</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="past-qp-session">Session</label>
                        <select id="past-qp-session" class="form-control" required>
                            <option value="July-2025">July 2025</option>
                            <option value="January-2026">January 2026</option>
                            <option value="July-2026">July 2026</option>
                        </select>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1rem; margin-bottom: 1.2rem; align-items: end;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="past-qp-set">Set</label>
                        <select id="past-qp-set" class="form-control" required>
                            <option value="A">Set A</option>
                            <option value="B">Set B</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="past-qp-file">DOCX File</label>
                        <input type="file" id="past-qp-file" class="form-control" accept=".docx" required style="padding: 9px 12px;">
                    </div>
                </div>
                <button type="submit" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Upload Past Paper
                </button>
            </form>
        </div>
    `;
}

async function generateCommonQuestionPaper(deptId, deptName) {
    showToast(`Generating question paper for ${deptName}...`, 'info');
    
    try {
        const response = await fetch('/api/admin/generate-common-question-paper', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ department_id: deptId })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `HTTP error! status: ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanName = deptName.replace(/\s+/g, '_');
        a.download = `Common_Question_Paper_${cleanName}_July2026.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        
        showToast(`Common Question Paper generated and downloaded!`);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function updatePastQpInstitutions() {
    const campusSelect = document.getElementById('past-qp-campus');
    const instSelect = document.getElementById('past-qp-institute');
    const deptSelect = document.getElementById('past-qp-dept');
    if (!campusSelect || !instSelect || !deptSelect) return;
    
    const campusId = parseInt(campusSelect.value);
    if (!campusId) {
        instSelect.innerHTML = '<option value="">-- Select Institute --</option>';
        instSelect.disabled = true;
        deptSelect.innerHTML = '<option value="">-- Select Department --</option>';
        deptSelect.disabled = true;
        return;
    }
    
    // Filter institutions on this campus
    const insts = (state.metadata.institutions || []).filter(i => i.campus_id === campusId);
    
    instSelect.innerHTML = '<option value="">-- Select Institute --</option>' + 
        insts.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    instSelect.disabled = false;
    
    // Reset department select
    deptSelect.innerHTML = '<option value="">-- Select Department --</option>';
    deptSelect.disabled = true;
}

function updatePastQpDepts() {
    const instSelect = document.getElementById('past-qp-institute');
    const deptSelect = document.getElementById('past-qp-dept');
    if (!instSelect || !deptSelect) return;
    
    const instId = parseInt(instSelect.value);
    if (!instId) {
        deptSelect.innerHTML = '<option value="">-- Select Department --</option>';
        deptSelect.disabled = true;
        return;
    }
    
    // Filter departments in this institution
    const depts = (state.metadata.departments || []).filter(d => d.institution_id === instId);
    
    deptSelect.innerHTML = '<option value="">-- Select Department --</option>' + 
        depts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    deptSelect.disabled = false;
}

async function handlePastQpUpload(e) {
    e.preventDefault();
    const campusId = document.getElementById('past-qp-campus').value;
    const instId = document.getElementById('past-qp-institute').value;
    const deptId = document.getElementById('past-qp-dept').value;
    const session = document.getElementById('past-qp-session').value;
    const set = document.getElementById('past-qp-set').value;
    const fileInput = document.getElementById('past-qp-file');
    
    if (!campusId || !instId || !deptId || !session || !set || !fileInput.files[0]) {
        showToast('Please fill all fields and select a file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('campus_id', campusId);
    formData.append('department_id', deptId);
    formData.append('session', session);
    formData.append('set', set);
    formData.append('file', fileInput.files[0]);
    
    showToast('Uploading past paper...', 'info');
    try {
        const response = await fetch('/api/admin/upload-past-question-paper', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });
        
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to upload past paper.');
        }
        
        showToast(result.message || 'Past paper uploaded successfully!');
        fileInput.value = ''; // clear input
        // Refresh question papers table view
        const res = await api('/api/admin/question-papers');
        state.adminQuestionPapers = res.departments || [];
        renderAdminQuestionPapersPage();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function downloadPastQuestionPaper(id, filename) {
    showToast(`Downloading reference paper...`, 'info');
    try {
        const response = await fetch(`/api/hod/past-question-papers/download?id=${id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Failed to download file.`);
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteQuestionPaper(id, setLabel) {
    if (!confirm(`Are you sure you want to delete ${setLabel === 'A' || setLabel === 'B' ? 'Set ' + setLabel : setLabel} question paper? This will also clear all parsed questions from this paper.`)) return;
    
    showToast('Deleting question paper...', 'info');
    try {
        const response = await fetch(`/api/question-papers/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });
        
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to delete question paper.');
        }
        
        showToast(result.message || 'Question paper deleted.');
        
        // Refresh appropriate view
        if (state.user.role === 'hod') {
            const refreshRes = await api('/api/hod/question-papers');
            state.hodQuestionPapers = refreshRes.questionPapers || [];
            renderHodQuestionPapersPage();
        } else if (['admin', 'super_admin'].includes(state.user.role)) {
            const refreshRes = await api('/api/admin/question-papers');
            state.adminQuestionPapers = refreshRes.departments || [];
            renderAdminQuestionPapersPage();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

let currentRejectedDuplicates = [];
let currentRejectedSet = '';

function showDuplicateQuestionsModal(duplicates, setLetter, duplicateCount, maxAllowed = 10) {
    currentRejectedDuplicates = duplicates || [];
    currentRejectedSet = setLetter;

    const existing = document.getElementById('duplicate-questions-modal');
    if (existing) existing.remove();

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    const modal = document.createElement('div');
    modal.className = 'modal-overlay animate-fade-in';
    modal.id = 'duplicate-questions-modal';

    const tableRows = (duplicates || []).map((d, index) => {
        const preview = d.question_text && d.question_text.length > 140 
            ? `${escapeHtml(d.question_text.substring(0, 140))}...` 
            : escapeHtml(d.question_text || '—');

        return `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td style="text-align: center; font-weight: bold; width: 45px; padding: 10px 8px;">${index + 1}</td>
                <td style="white-space: nowrap; padding: 10px 12px;">
                    <span style="font-weight: 700; color: #ef4444; font-size: 0.95rem;">Set ${escapeHtml(d.uploaded_set)} — Q.${d.uploaded_q_no}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Section ${escapeHtml(d.uploaded_section)}</span>
                </td>
                <td style="white-space: nowrap; padding: 10px 12px;">
                    <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.8rem; padding: 4px 8px;">
                        <i class="fa-solid fa-calendar-check" style="margin-right: 4px;"></i>${escapeHtml(d.matched_session)}
                    </span>
                </td>
                <td style="white-space: nowrap; padding: 10px 12px;">
                    <span style="font-weight: 700; color: #f59e0b; font-size: 0.92rem;">${escapeHtml(d.matched_set)} — Q.${d.matched_q_no}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Section ${escapeHtml(d.matched_section || '—')}</span>
                </td>
                <td style="font-size: 0.85rem; line-height: 1.45; color: var(--text-secondary); max-width: 420px; padding: 10px 12px;">
                    ${preview}
                </td>
            </tr>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 1000px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; padding: 0; border: 1px solid rgba(239, 68, 68, 0.45); box-shadow: 0 12px 35px rgba(0,0,0,0.5); border-radius: 12px; overflow: hidden; background: var(--bg-primary);">
            <div class="modal-header" style="background: rgba(239, 68, 68, 0.12); border-bottom: 1px solid rgba(239, 68, 68, 0.3); padding: 1.25rem 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 50%; background: rgba(239, 68, 68, 0.2); display: flex; align-items: center; justify-content: center; color: #ef4444; font-size: 1.35rem; flex-shrink: 0;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div>
                        <h3 style="margin: 0; color: #ef4444; font-size: 1.25rem; font-weight: 700;">Question Paper Rejected — Repeated Questions Limit Exceeded</h3>
                        <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: var(--text-secondary);">
                            Uploaded <strong>Set ${setLetter}</strong> contains <strong style="color: #ef4444; font-size: 0.95rem;">${duplicateCount} repeated questions</strong> from the past two entrance exam sessions.
                        </p>
                    </div>
                </div>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; font-size: 1.6rem; cursor: pointer; color: var(--text-muted);">&times;</button>
            </div>
            
            <div class="modal-body" style="padding: 1.5rem; overflow-y: auto; flex: 1;">
                <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 12px 16px; margin-bottom: 1.5rem; font-size: 0.88rem; line-height: 1.55; color: var(--text-primary); display: flex; align-items: flex-start; gap: 10px;">
                    <i class="fa-solid fa-circle-exclamation" style="color: #ef4444; font-size: 1.15rem; margin-top: 3px; flex-shrink: 0;"></i>
                    <div>
                        <strong>SRM PhD Entrance Examination Regulation:</strong>
                        A maximum of <strong>${maxAllowed} questions</strong> may be repeated from past sessions (January 2026 / July 2026). Please replace the repeated questions listed in the comparison table below and re-upload Set ${setLetter}.
                    </div>
                </div>

                <div style="border: 1px solid var(--glass-border); border-radius: 8px; overflow: hidden; background: var(--bg-secondary);">
                    <div style="overflow-x: auto; max-height: 440px;">
                        <table class="table" style="width: 100%; border-collapse: collapse; font-size: 0.88rem; margin: 0;">
                            <thead style="position: sticky; top: 0; background: var(--bg-tertiary); z-index: 5;">
                                <tr style="border-bottom: 2px solid var(--glass-border);">
                                    <th style="width: 45px; text-align: center; padding: 12px 8px;">#</th>
                                    <th style="padding: 12px;">Uploaded Question (Set ${setLetter})</th>
                                    <th style="padding: 12px;">Matched Past Session</th>
                                    <th style="padding: 12px;">Matched Past Paper & Q.No</th>
                                    <th style="padding: 12px;">Question Text</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary);">
                <button type="button" class="btn btn-secondary" onclick="exportDuplicateQuestionsToCsv()" style="display: inline-flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-file-csv"></i> Download Duplicates List (.csv)
                </button>
                <button type="button" class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()" style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;">
                    <i class="fa-solid fa-xmark"></i> Close & Revise Question Paper
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function exportDuplicateQuestionsToCsv() {
    const duplicates = currentRejectedDuplicates || [];
    const setLetter = currentRejectedSet || 'Paper';
    if (!duplicates || duplicates.length === 0) return;

    let csv = "Index,Uploaded_Set,Uploaded_QNo,Uploaded_Section,Matched_Session,Matched_Set,Matched_QNo,Matched_Section,Question_Text\n";
    duplicates.forEach((d, i) => {
        const escape = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
        csv += [
            i + 1,
            escape(d.uploaded_set),
            d.uploaded_q_no,
            escape(d.uploaded_section),
            escape(d.matched_session),
            escape(d.matched_set),
            d.matched_q_no,
            escape(d.matched_section),
            escape(d.question_text)
        ].join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Duplicate_Questions_Report_Set_${setLetter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

window.renderHodQuestionPapersPage = renderHodQuestionPapersPage;
window.renderAdminQuestionPapersPage = renderAdminQuestionPapersPage;
window.generateCommonQuestionPaper = generateCommonQuestionPaper;
window.downloadPastQuestionPaper = downloadPastQuestionPaper;
window.updatePastQpDepts = updatePastQpDepts;
window.updatePastQpInstitutions = updatePastQpInstitutions;
window.handlePastQpUpload = handlePastQpUpload;
window.deleteQuestionPaper = deleteQuestionPaper;
window.showDuplicateQuestionsModal = showDuplicateQuestionsModal;
window.exportDuplicateQuestionsToCsv = exportDuplicateQuestionsToCsv;

