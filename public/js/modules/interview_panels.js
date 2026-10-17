// --- HOD DASHBOARD: INTERVIEW PANELS SETUP & ASSIGNMENT ---

async function loadHodInterviewPanels() {
    try {
        const res = await api('/api/hod/panels');
        state.interviewPanels = res.panels || [];
        renderHodInterviewPanelsPage();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function resetHodInterviewPanels() {
    const preloaded = state.interviewPanels || [];
    if (preloaded.length > 0) {
        const numPanelsInput = document.getElementById('num-panels-input');
        const numMembersInput = document.getElementById('num-members-input');
        if (numPanelsInput) numPanelsInput.value = preloaded.length;
        if (numMembersInput) numMembersInput.value = Math.max(...preloaded.map(p => p.members ? p.members.length : 0)) || 3;
        generatePanelInputs(true);
    } else {
        const inputs = document.querySelectorAll('#hod-panels-form input[type="text"]');
        inputs.forEach(input => {
            input.value = '';
        });
    }
    showToast('Form reset successfully.');
}

function renderHodInterviewPanelsPage() {
    const mainContent = document.getElementById('main-content');
    
    const panels = state.interviewPanels || [];
    const numPanels = panels.length || 1;
    let numMembers = 3;
    if (panels.length > 0) {
        numMembers = Math.max(...panels.map(p => p.members ? p.members.length : 0)) || 3;
    }

    const dl = getDeadlineStatus('deadline_create_panels', 'Panel Creation & Member Setup');
    const isPastDeadline = dl.isPast;
    const deadlineBadgeHtml = dl.badgeHtml;

    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;"><i class="fa-solid fa-users"></i> Manage Interview Panels</h2>
        ${deadlineBadgeHtml}
        
        ${isPastDeadline ? '' : `
        <div class="card" style="margin-bottom: 2rem; max-width: 600px;">
            <h4 style="margin-bottom: 1.2rem; color: var(--primary);">Configure Panels & Members</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.2rem;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="num-panels-input">Number of Panels</label>
                    <input type="number" id="num-panels-input" class="form-control" min="1" value="${numPanels}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="num-members-input">Members per Panel</label>
                    <input type="number" id="num-members-input" class="form-control" min="1" max="5" value="${numMembers}">
                </div>
            </div>
            <button class="btn btn-primary" onclick="generatePanelInputs(false)" style="margin-top: 1rem;">
                <i class="fa-solid fa-gears"></i> Generate Panel Forms
            </button>
        </div>
        
        <form id="hod-panels-form" style="display: none;">
            <div id="panels-dynamic-container" style="display: flex; flex-direction: column; gap: 1.5rem; margin-bottom: 2rem;">
            </div>
            <div style="display: flex; gap: 1rem;">
                <button type="submit" class="btn btn-success">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Save Interview Panels
                </button>
                <button type="button" class="btn btn-secondary" onclick="resetHodInterviewPanels()">
                    <i class="fa-solid fa-arrow-rotate-left"></i> Reset
                </button>
            </div>
        </form>
        `}
    `;

    if (isPastDeadline) return;

    const form = document.getElementById('hod-panels-form');
    form.addEventListener('submit', saveHodInterviewPanels);

    if (panels.length > 0) {
        generatePanelInputs(true);
    }
}

function generatePanelInputs(usePreloaded = false) {
    const numPanelsInput = document.getElementById('num-panels-input');
    const numMembersInput = document.getElementById('num-members-input');
    
    let P = parseInt(numPanelsInput.value) || 1;
    let M = parseInt(numMembersInput.value) || 3;

    if (M > 5) {
        showToast('Maximum of 5 members per panel is allowed.', 'error');
        M = 5;
        numMembersInput.value = 5;
    }
    if (M < 1) {
        showToast('Minimum of 1 member per panel is required.', 'error');
        M = 1;
        numMembersInput.value = 1;
    }

    const container = document.getElementById('panels-dynamic-container');
    const form = document.getElementById('hod-panels-form');
    container.innerHTML = '';

    const preloadedPanels = state.interviewPanels || [];

    for (let p = 0; p < P; p++) {
        let pName = `Panel ${p + 1}`;
        let pMembers = [];
        
        if (usePreloaded && preloadedPanels[p]) {
            pName = preloadedPanels[p].panel_name || pName;
            pMembers = preloadedPanels[p].members || [];
        }

        let membersHtml = '';
        for (let m = 0; m < M; m++) {
            let mName = '';
            let mDesg = '';
            
            if (usePreloaded && pMembers[m]) {
                mName = pMembers[m].name || '';
                mDesg = pMembers[m].designation || '';
            }

            membersHtml += `
                <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 1rem; display: flex; flex-direction: column; gap: 10px;">
                    <h5 style="color: var(--primary); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Member ${m + 1}</h5>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label>Name</label>
                        <input type="text" class="form-control panel-member-name" data-panel="${p}" data-member="${m}" placeholder="e.g. Dr. Jane Doe (Optional)" value="${mName.replace(/"/g, '&quot;')}">
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label>Designation</label>
                        <input type="text" class="form-control panel-member-desg" data-panel="${p}" data-member="${m}" placeholder="e.g. Professor (Optional)" value="${mDesg.replace(/"/g, '&quot;')}">
                    </div>
                </div>
            `;
        }

        container.innerHTML += `
            <div class="card panel-card" data-panel="${p}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.8rem;">
                    <div class="form-group" style="margin-bottom: 0; flex: 1; max-width: 400px;">
                        <label style="font-weight: 600;">Panel Name</label>
                        <input type="text" class="form-control panel-name-input" value="${pName.replace(/"/g, '&quot;')}" placeholder="e.g. Panel ${p + 1}" required>
                    </div>
                    <span class="badge badge-info" style="align-self: flex-end; margin-bottom: 6px; padding: 6px 12px;">Panel ${p + 1}</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
                    ${membersHtml}
                </div>
            </div>
        `;
    }

    form.style.display = 'block';
    
    if (!usePreloaded) {
        form.scrollIntoView({ behavior: 'smooth' });
    }
}

async function saveHodInterviewPanels(e) {
    e.preventDefault();

    const panelCards = document.querySelectorAll('.panel-card');
    const panelsData = [];

    panelCards.forEach(card => {
        const pIndex = card.getAttribute('data-panel');
        const pNameInput = card.querySelector('.panel-name-input');
        const panel_name = pNameInput.value.trim();

        const memberNames = card.querySelectorAll('.panel-member-name');
        const memberDesgs = card.querySelectorAll('.panel-member-desg');

        const members = [];
        memberNames.forEach((nameInput, i) => {
            const name = nameInput.value.trim();
            const designation = memberDesgs[i].value.trim();
            if (name || designation) {
                members.push({ name, designation });
            }
        });

        panelsData.push({
            panel_name,
            members
        });
    });

    try {
        const res = await api('/api/hod/panels', 'POST', { panels: panelsData });
        showToast(res.message || 'Interview panels saved successfully!');
        await loadHodInterviewPanels();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function assignCandidatePanel(candidateId, panelId) {
    try {
        const res = await api(`/api/hod/candidates/${candidateId}/assign-panel`, 'POST', { panel_id: panelId ? parseInt(panelId) : null });
        showToast(res.message || 'Candidate assigned to panel successfully');
        await loadCandidateDossier(candidateId, `dossier-container-${candidateId}`);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function assignPanelInline(candidateId, panelId) {
    try {
        const res = await api(`/api/hod/candidates/${candidateId}/assign-panel`, 'POST', { panel_id: panelId ? parseInt(panelId) : null });
        showToast(res.message || 'Candidate assigned to panel successfully');
        const candidate = state.candidates.find(c => c.id === candidateId);
        if (candidate) {
            candidate.panel_id = panelId ? parseInt(panelId) : null;
        }
    } catch (err) {
        showToast(err.message, 'error');
        // On error, reload data to reset the dropdown state
        loadTabSpecificData();
    }
}

window.loadHodInterviewPanels = loadHodInterviewPanels;
window.resetHodInterviewPanels = resetHodInterviewPanels;
window.renderHodInterviewPanelsPage = renderHodInterviewPanelsPage;
window.generatePanelInputs = generatePanelInputs;
window.saveHodInterviewPanels = saveHodInterviewPanels;
window.assignCandidatePanel = assignCandidatePanel;
window.assignPanelInline = assignPanelInline;
window.markAttendanceModal = markAttendanceModal;

// --- COORDINATOR DASHBOARD: MONITOR INTERVIEW PANELS & QUERY HOD ---

async function loadCoordinatorInterviewPanels() {
    try {
        const res = await api('/api/coordinator/panels');
        state.coordinatorPanels = res.departments || [];
        renderCoordinatorInterviewPanelsPage();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderCoordinatorInterviewPanelsPage() {
    const mainContent = document.getElementById('main-content');
    const depts = state.coordinatorPanels || [];

    if (depts.length === 0) {
        mainContent.innerHTML = `
            <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;"><i class="fa-solid fa-users"></i> Monitor Interview Panels</h2>
            <div class="card" style="text-align: center; padding: 3rem;">
                <i class="fa-solid fa-folder-open fa-3x" style="color: var(--text-muted); margin-bottom: 1rem;"></i>
                <p style="font-size: 1.1rem; color: var(--text-secondary);">No interview panels have been set up by any HOD in your institution yet.</p>
            </div>
        `;
        return;
    }

    if (!state.activeCoordinatorPanelsDept || !depts.some(d => d.department_name === state.activeCoordinatorPanelsDept)) {
        state.activeCoordinatorPanelsDept = depts[0].department_name;
    }

    const activeDeptName = state.activeCoordinatorPanelsDept;
    const selectedDept = depts.find(d => d.department_name === activeDeptName);

    const deptButtonsHtml = depts.map(d => {
        const isActive = d.department_name === activeDeptName;
        return `
            <button class="sub-tab-btn ${isActive ? 'active' : ''}" 
                    onclick="state.activeCoordinatorPanelsDept = '${d.department_name.replace(/'/g, "\\'")}'; renderCoordinatorInterviewPanelsPage();">
                <i class="fa-solid fa-graduation-cap" style="margin-right: 6px;"></i> ${d.department_name} (${d.panels.length} Panel(s))
            </button>
        `;
    }).join('');

    let panelsHtml = '';
    if (selectedDept.panels.length === 0) {
        panelsHtml = `<p style="font-size:0.88rem; color:var(--text-muted); padding: 1rem;">No panels configured in this department.</p>`;
    } else {
        const rows = selectedDept.panels.map(p => {
            const membersList = p.members && p.members.length > 0
                ? p.members.map(m => `<li><strong>${m.name}</strong> (${m.designation})</li>`).join('')
                : `<span style="color:var(--text-muted)">No members added</span>`;

            return `
                <tr>
                    <td style="font-weight:600; font-size:0.95rem;">${p.panel_name}</td>
                    <td>
                        <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.85rem; line-height: 1.4;">
                            ${p.members && p.members.length > 0 ? membersList : `<li>${membersList}</li>`}
                        </ul>
                    </td>
                    <td style="text-align: center;">
                        <span class="badge badge-info" style="font-size:0.85rem; padding: 4px 10px;">${p.candidate_count} candidates</span>
                    </td>
                </tr>
            `;
        }).join('');

        panelsHtml = `
            <div class="table-container" style="margin-top: 1rem; margin-bottom: 0;">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 30%;">Panel Name</th>
                            <th style="width: 50%;">Panelist Details</th>
                            <th style="width: 20%; text-align: center;">Assigned Candidates</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    const cardHtml = `
        <div class="card" style="margin-bottom: 1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--glass-border); padding-bottom: 1rem; margin-bottom: 1rem;">
                <h3 style="color:var(--primary); font-size:1.3rem;"><i class="fa-solid fa-graduation-cap"></i> ${selectedDept.department_name}</h3>
                <button class="btn btn-secondary" onclick="openSendQueryModal(${selectedDept.department_id}, '${selectedDept.department_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-comment-dots"></i> Send Query to HOD
                </button>
            </div>
            ${panelsHtml}
        </div>
    `;

    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;"><i class="fa-solid fa-users"></i> Monitor Interview Panels</h2>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.5rem; border-bottom: 1px dashed var(--glass-border); padding-bottom: 12px;">
            ${deptButtonsHtml}
        </div>
        <div style="display:flex; flex-direction:column; gap: 1rem;">
            ${cardHtml}
        </div>
    `;
}

function openSendQueryModal(departmentId, departmentName) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'query-hod-modal';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 550px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-comment-dots" style="color: var(--primary); margin-right: 8px;"></i>Send Query to HOD</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <form id="panel-query-form">
                <div class="modal-body">
                    <p style="font-size:0.9rem; margin-bottom: 1.2rem;">Department: <strong>${departmentName}</strong></p>
                    <div class="form-group">
                        <label for="query-text-input">Query / Message for HOD</label>
                        <textarea id="query-text-input" class="form-control" rows="5" placeholder="e.g. Please clarify why Panel 2 has only 1 member, or please complete your panel assignments." required></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button type="submit" id="query-submit-btn" class="btn btn-primary">
                        Send Email Query <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('panel-query-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const queryText = document.getElementById('query-text-input').value;
        const btn = document.getElementById('query-submit-btn');

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

        try {
            const res = await api('/api/coordinator/panels/query', 'POST', {
                department_id: departmentId,
                query_text: queryText
            });
            showToast(res.message || 'Query sent successfully.');
            modal.remove();
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Send Email Query <i class="fa-solid fa-paper-plane"></i>';
        }
    });
}

window.loadCoordinatorInterviewPanels = loadCoordinatorInterviewPanels;
window.renderCoordinatorInterviewPanelsPage = renderCoordinatorInterviewPanelsPage;
window.openSendQueryModal = openSendQueryModal;

// Shared allocation entry point for Dashboard and Candidates.
function renderHodPanelAction(candidate) {
    if (state.user.role !== 'hod' || !canAllotInterviewPanel(candidate)) return '';
    const deadline = getDeadlineStatus('deadline_allocate_panels', 'Candidate Panel Allocation');
    return `<button type="button" class="btn btn-secondary" data-panel-action="${candidate.id}" onclick="openHodPanelAllocation(${candidate.id})" style="padding:4px 8px; font-size:0.75rem; white-space:normal;" ${deadline.isPast ? 'disabled title="Panel allocation deadline has passed"' : 'title="Allot or change the interview panel"'}><i class="fa-solid fa-users"></i> ${deadline.isPast ? 'Panel Allocation Closed' : 'Allot Interview Panel'}</button>`;
}
async function openHodPanelAllocation(candidateId) {
    if (state.user.role !== 'hod') return;
    if (getDeadlineStatus('deadline_allocate_panels', 'Candidate Panel Allocation').isPast) {
        return showToast('The deadline for allocating candidates to panels has passed.', 'error');
    }
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    try {
        const [details, result] = await Promise.all([api('/api/candidates/' + candidateId), api('/api/hod/panels')]);
        if (!canAllotInterviewPanel(details.candidate)) return showToast('Interview panels can be allotted only to eligible applicants.', 'error');
        const panels = result.panels || [];
        document.getElementById('hod-panel-allocation-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'hod-panel-allocation-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="hod-panel-title" style="max-width:520px; width:90%;">
            <h3 id="hod-panel-title">Allot Interview Panel</h3>
            <p>${escape(details.candidate.application_no)} — ${escape(details.candidate.registered_name)}</p>
            ${panels.length ? `<form id="hod-panel-allocation-form"><label for="hod-panel-choice">Interview panel</label><select id="hod-panel-choice" class="form-control"><option value="">Not assigned</option>${panels.map(p => `<option value="${Number(p.id)}" ${Number(details.candidate.panel_id) === Number(p.id) ? 'selected' : ''}>${escape(p.panel_name)}</option>`).join('')}</select><div style="display:flex;gap:8px;margin-top:16px;"><button type="submit" class="btn btn-primary">Save Panel</button><button type="button" class="btn btn-secondary" data-close-panel>Cancel</button></div></form>` : '<p>No interview panels have been created for your department. Create a panel in Interview Panels first.</p><button type="button" class="btn btn-secondary" data-close-panel>Close</button>'}
        </div>`;
        document.body.appendChild(modal);
        modal.querySelector('[data-close-panel]').onclick = () => modal.remove();
        const form = modal.querySelector('form');
        if (!form) return;
        const select = modal.querySelector('select');
        select.focus();
        form.onsubmit = async event => {
            event.preventDefault();
            const button = form.querySelector('[type="submit"]');
            button.disabled = true;
            const panelId = select.value ? Number(select.value) : null;
            try {
                const saved = await api('/api/hod/candidates/' + candidateId + '/assign-panel', 'POST', {panel_id: panelId});
                const candidate = state.candidates.find(c => Number(c.id) === Number(candidateId));
                if (candidate) candidate.panel_id = panelId;
                if (state.selectedCandidate && Number(state.selectedCandidate.id) === Number(candidateId)) state.selectedCandidate.panel_id = panelId;
                const name = panels.find(p => Number(p.id) === panelId)?.panel_name || 'None';
                document.querySelectorAll('[data-assigned-panel="' + candidateId + '"]').forEach(el => el.textContent = name);
                document.querySelectorAll('select[onchange*="assignPanelInline(' + candidateId + ',"]').forEach(el => el.value = panelId || '');
                modal.remove();
                showToast(saved.message || 'Interview panel saved.');
            } catch (error) {
                showToast(error.message, 'error');
                button.disabled = false;
            }
        };
    } catch (error) { showToast(error.message, 'error'); }
}
window.renderHodPanelAction = renderHodPanelAction;
window.openHodPanelAllocation = openHodPanelAllocation;
