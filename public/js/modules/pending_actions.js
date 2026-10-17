// Ownership is the work queue; viewing an application never acknowledges it.
function candidateNeedsMyAction(c, user = state.user) {
    if (!c || !user || c.status === 'Transfer in Progress') return false;
    if (user.role !== 'super_admin' && Number(c.campus_id) !== Number(user.campus_id)) return false;
    if (user.role === 'hod' && (Number(c.department_id) !== Number(user.department_id) || Number(c.institution_id) !== Number(user.institution_id))) return false;
    if (user.role === 'dean' && state.metadata && !state.metadata.institutions.some(i => Number(i.id) === Number(c.institution_id) && i.dean_username === user.username)) return false;
    if (user.role === 'coordinator' && state.metadata && !state.metadata.institutions.some(i => Number(i.id) === Number(c.institution_id) && (i.coord_username === user.username || Number(i.id) === Number(user.institution_id)))) return false;
    if (rankAwaitingAdminRelease(c)) return ['admin','super_admin'].includes(user.role) && Number(c.rank)>0;
    const owners = {admin:['Admin'],super_admin:['Admin'],dean:['Dean'],coordinator:['RC','Coordinator'],hod:['HOD']};
    if (!(owners[user.role] || []).includes(c.current_owner)) return false;
    // Final approvals and non-selection require no further work from the current owner.
    return !['Approved Guides','Entrance Exam Absent','Evaluated (Failed Cutoff)','Selected','Not Selected'].includes(c.status);
}
function pendingActionCount(instituteId, departmentId = 0) {
    return (state.candidates || []).filter(c => candidateNeedsMyAction(c) && Number(c.institution_id) === Number(instituteId) && (!departmentId || Number(c.department_id) === Number(departmentId))).length;
}
function pendingActionBadge(instituteId, departmentId = 0) {
    const count = pendingActionCount(instituteId, departmentId);
    return '<span class="pending-action-badge" data-pending-inst="'+Number(instituteId)+'" data-pending-dept="'+Number(departmentId)+'" '+(count ? '' : 'hidden')+' role="button" tabindex="0" aria-label="'+count+' applications awaiting your action" title="'+count+' applications awaiting your action. Open Needs My Action" onclick="event.stopPropagation(); openPendingWork('+Number(instituteId)+','+Number(departmentId)+')" onkeydown="if(event.code===&quot;Enter&quot;||event.code===&quot;Space&quot;){event.preventDefault();event.stopPropagation();openPendingWork('+Number(instituteId)+','+Number(departmentId)+')}">'+count+'</span>';
}
async function openPendingWork(instituteId, departmentId = 0) {
    if (!state.metadata) state.metadata = await api('/api/admin/metadata');
    const institute = state.metadata.institutions.find(i => Number(i.id) === Number(instituteId));
    const department = state.metadata.departments.find(d => Number(d.id) === Number(departmentId));
    if (!institute) return;
    state.activeCandidateCampus = Number(institute.campus_id);
    state.activeCandidateInst = Number(instituteId);
    state.activeCandidateDept = department ? department.name : 'All';
    state.activeCandidateFilter = 'Needs My Action';
    state.candidateSearchQuery = '';
    await navigateToTab('candidates');
}
function pendingEscape(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function renderPendingActionSummary() {
    requestAnimationFrame(setupPendingActionLayout);
    const pending = (state.candidates || []).filter(c => candidateNeedsMyAction(c));
    const institutes = [...new Set(pending.map(c => Number(c.institution_id)))];
    const cards = institutes.map(id => {
        const rows = pending.filter(c => Number(c.institution_id) === id);
        const first = rows[0];
        const departments = [...new Set(rows.map(c => Number(c.department_id)))];
        const isOffice = [100,101].includes(id);
        return `<article class="action-institute-card">
            <button type="button" class="action-institute-heading" onclick="openPendingWork(${id})" aria-label="${pendingEscape(first.institution_name || 'Research Office')}: ${rows.length} applications awaiting your action">
                <span class="action-institute-icon" aria-hidden="true"><i class="fa-solid ${isOffice ? 'fa-inbox' : 'fa-building-columns'}"></i></span>
                <span class="action-institute-title"><strong>${pendingEscape(first.institution_name || 'Research Office')}</strong><small>${isOffice ? 'Applications awaiting mapping' : departments.length + (departments.length === 1 ? ' department needs attention' : ' departments need attention')}${state.user.role === 'super_admin' && first.campus_name ? ' · ' + pendingEscape(first.campus_name) : ''}</small></span>
                <span class="action-institute-total">${rows.length}<small>pending</small></span>
            </button>
            <div class="action-department-list">${departments.map(deptId => {
                const matches = rows.filter(c => Number(c.department_id) === deptId);
                const name = matches[0].department_name || 'Pending Mapping';
                return `<button type="button" class="action-department-row" onclick="openPendingWork(${id},${deptId})" aria-label="${pendingEscape(name)}: ${matches.length} applications awaiting your action">
                    <span class="action-department-name">${pendingEscape(name)}</span>
                    <span class="action-department-count">${matches.length}</span>
                    <i class="fa-solid fa-chevron-right action-department-arrow" aria-hidden="true"></i>
                </button>`;
            }).join('')}</div>
        </article>`;
    }).join('');
    return `<section id="pending-action-summary" class="card action-summary" aria-labelledby="action-summary-title">
        <div class="action-summary-header">
            <div class="action-summary-title-group"><span class="action-summary-icon" aria-hidden="true"><i class="fa-solid fa-list-check"></i></span><div><h3 id="action-summary-title">Needs My Action</h3><p>Choose an institute or department to continue.</p></div></div>
            <span class="action-summary-total"><span class="action-summary-dot" aria-hidden="true"></span><strong>${pending.length + Number(state.transferPendingCount || 0)}</strong> awaiting action</span>
        </div>
        <div id="pending-transfer-summary" ${state.transferPendingCount ? '' : 'hidden'} style="margin-bottom:12px"><button type="button" class="btn btn-secondary" onclick="state.activeTransferSubTab=null;navigateToTab('transfers')"><i class="fa-solid fa-arrow-right-arrow-left"></i> <strong id="pending-transfer-total">${Number(state.transferPendingCount || 0)}</strong> transfers awaiting your action · Review transfers</button></div>
        ${pending.length ? '<div class="action-institute-grid">' + cards + '</div><div class="action-summary-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Counts stay until the required action is completed or the application is forwarded.</div>' : '<div class="action-summary-empty"><i class="fa-regular fa-circle-check" aria-hidden="true"></i><strong>' + (state.transferPendingCount ? 'No other application actions' : 'You’re up to date') + '</strong><p>' + (state.transferPendingCount ? 'Review the pending transfers above.' : 'No applications currently await your action.') + '</p></div>'}
    </section>`;
}
// Pack short institute cards into available gaps below other cards.
let pendingActionLayoutObserver = null;
function setupPendingActionLayout() {
    if (pendingActionLayoutObserver) pendingActionLayoutObserver.disconnect();
    const grid = document.querySelector('#pending-action-summary .action-institute-grid');
    if (!grid) return;
    const layout = () => {
        if (!grid.isConnected) return;
        const gap = 12;
        const columns = Math.min(3, grid.children.length, Math.max(1, Math.floor((grid.clientWidth + gap) / 312)));
        grid.style.setProperty('--action-columns', columns);
        for (const card of grid.children) {
            const height = card.getBoundingClientRect().height;
            card.style.gridRowEnd = 'span ' + Math.ceil((height + gap) / (1 + gap));
        }
    };
    let previousWidth = grid.clientWidth;
    layout();
    pendingActionLayoutObserver = new ResizeObserver(() => {
        if (grid.clientWidth === previousWidth) return;
        previousWidth = grid.clientWidth;
        layout();
    });
    pendingActionLayoutObserver.observe(grid);
    if (document.fonts) document.fonts.ready.then(layout);
}

// Refresh counts without replacing forms, selections or an open dossier.
let pendingRefreshInFlight = false;
async function refreshPendingActionIndicators() {
    if (pendingRefreshInFlight || !state.token || !state.user || document.hidden || !['dashboard','overview','candidates'].includes(state.activeTab)) return;
    pendingRefreshInFlight = true;
    const token = state.token;
    try {
        await refreshTransferPendingCount();
        const [result,vacancyResult] = await Promise.all([api('/api/candidates'),api('/api/vacancies')]);
        if (state.token !== token) return;
        state.candidates = result.candidates || [];
        state.vacancies = vacancyResult.vacancies || [];
        document.querySelectorAll('[data-selection-limit]').forEach(el=>el.textContent=selectionLimitText(Number(el.dataset.selectionLimit)));
        if (state.activeTab === 'candidates' && !document.querySelector('.modal-overlay, .candidate-checkbox:checked, .select-all-candidates:checked') && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) {
            renderCandidatesTable();
            return;
        }
        document.querySelectorAll('[data-pending-inst]').forEach(el => { el.outerHTML = pendingActionBadge(Number(el.dataset.pendingInst), Number(el.dataset.pendingDept)); });
        const summary = document.getElementById('pending-action-summary');
        if (summary) summary.outerHTML = renderPendingActionSummary();
        const cards=document.getElementById('dashboard-summary-cards');
        if(cards&&state.activeTab==='dashboard')cards.innerHTML=renderDashboardSummaryCards();
        if (state.activeTab === 'overview') {
            const editing=document.querySelector('.modal-overlay')||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
            if(state.user.role==='super_admin'&&!editing)renderSuperAdminCharts();
            else refreshRoleInsights();
        }
    } catch (error) { console.warn('Could not refresh pending action counts:', error.message); }
    finally { pendingRefreshInFlight = false; }
}
setInterval(refreshPendingActionIndicators, 30000);
