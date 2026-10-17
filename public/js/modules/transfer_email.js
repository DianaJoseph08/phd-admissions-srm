function canInitiateCandidateTransfer(c) { return !( ['rank','total_marks','written_marks','avg_interview_marks','scaled_written_marks','interview_marks_1','interview_marks_2','interview_marks_3','interview_marks_4','interview_marks_5'].some(key=>c[key]!=null)||!['','Pending Selection'].includes(c.selection_status||'')||c.supervisor_name ); }
// Transfer remarks are plain text. SQLite timestamps without an offset are UTC.
function transferEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function transferAction(name, ...args) { return transferEscape(name + '(' + args.map(value => JSON.stringify(value)).join(',') + ')'); }
function transferTimestamp(value, dateOnly = false) {
    if (!value) return '—';
    let timestamp = String(value).trim().replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) timestamp += 'Z';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-IN', {timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', ...(dateOnly ? {} : {hour:'2-digit', minute:'2-digit', hour12:true})}).format(date);
}
async function populateTransferInstitutions(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.disabled = true;
    try {
        const metadata = await api('/api/transfers/destinations');
        if (!select.isConnected) return;
        select.replaceChildren(new Option('-- Select Institution / Faculty --', ''));
        for (const campus of metadata.campuses) {
            const group = document.createElement('optgroup');
            group.label = campus.name + ' Campus';
            for (const institute of metadata.institutions.filter(i => Number(i.campus_id) === Number(campus.id))) group.appendChild(new Option(institute.name, institute.id));
            if (group.children.length) select.appendChild(group);
        }
    } catch (error) { showToast(error.message, 'error'); }
    finally { select.disabled = false; }
}
function transferSubmitLock(form) {
    if (form.dataset.submitting) return false;
    form.dataset.submitting = 'true';
    form.querySelector('button[type="submit"]').disabled = true;
    return true;
}
function transferSubmitUnlock(form) {
    delete form.dataset.submitting;
    form.querySelector('button[type="submit"]').disabled = false;
}

// ══════════════════════════════════════════════════════════════════════════════
// --- CANDIDATE TRANSFER & MULTI-TIER APPROVAL DASHBOARD ---
// ══════════════════════════════════════════════════════════════════════════════

function getTransferStageBadge(stage, status) {
    switch (stage) {
        case 'ORIG_RC':
            return `<span class="badge badge-warning" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);"><i class="fa-solid fa-clock"></i> Awaiting Orig RC</span>`;
        case 'ORIG_DEAN':
            return `<span class="badge badge-warning" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);"><i class="fa-solid fa-clock"></i> Awaiting Orig Dean</span>`;
        case 'TARGET_DEAN':
            return `<span class="badge badge-info" style="background: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3);"><i class="fa-solid fa-share"></i> Awaiting Target Dean</span>`;
        case 'TARGET_RC':
            return `<span class="badge badge-info" style="background: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3);"><i class="fa-solid fa-share"></i> Awaiting Target RC</span>`;
        case 'TARGET_HOD':
            return `<span class="badge badge-primary" style="background: rgba(99,102,241,0.15); color: #6366f1; border: 1px solid rgba(99,102,241,0.3);"><i class="fa-solid fa-hourglass-half"></i> Pending Target HOD Decision</span>`;
        case 'COMPLETED':
            return `<span class="badge badge-success" style="background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3);"><i class="fa-solid fa-circle-check"></i> Accepted & Transferred</span>`;
        case 'REJECTED_RC':
            return `<span class="badge badge-danger" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-triangle-exclamation"></i> Rejected by HOD (RC Review)</span>`;
        case 'REJECTED_DEAN':
            return `<span class="badge badge-danger" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-triangle-exclamation"></i> Rejected by HOD (Dean Review)</span>`;
        case 'REJECTED_ADMIN':
            return `<span class="badge badge-danger" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-shield-halved"></i> Escalated to Admin</span>`;
        case 'ADMIN_REJECTED':
            return `<span class="badge" style="background: rgba(107,114,128,0.15); color: #9ca3af; border: 1px solid rgba(107,114,128,0.3);"><i class="fa-solid fa-ban"></i> Not Selected (Admin)</span>`;
        default:
            return `<span class="badge badge-secondary">${transferEscape(stage || status)}</span>`;
    }
}

function renderTransferRequestsTable() {
    const mainContent = document.getElementById('main-content');
    const role = state.user.role;
    const allRequests = state.transferRequests || [];

    // Determine subtabs based on role
    let subTabs = [];
    if (role === 'hod') {
        const incomingCount = allRequests.filter(r => r.is_incoming && r.is_actionable).length;
        const outgoingCount = allRequests.filter(r => r.is_outgoing).length;
        const completedCount = allRequests.filter(r => r.is_incoming && r.stage === 'COMPLETED').length;
        
        subTabs = [
            { key: 'incoming', label: 'Incoming Transfers (Action Required)', count: incomingCount, icon: 'fa-solid fa-inbox' },
            { key: 'outgoing', label: 'Transferred Out (Tracking)', count: outgoingCount, icon: 'fa-solid fa-paper-plane' },
            { key: 'completed', label: 'Accepted into Department', count: completedCount, icon: 'fa-solid fa-circle-check' }
        ];
        if (!state.activeTransferSubTab) {
            state.activeTransferSubTab = incomingCount > 0 ? 'incoming' : 'outgoing';
        }
    } else if (role === 'coordinator' || role === 'dean') {
        const actionableCount = allRequests.filter(r => r.is_actionable).length;
        subTabs = [
            { key: 'actionable', label: 'Pending Your Review & Forwarding', count: actionableCount, icon: 'fa-solid fa-clock' },
            { key: 'all', label: role === 'coordinator' ? 'All Institution Transfers' : 'All Faculty Transfers', count: allRequests.length, icon: 'fa-solid fa-list-check' }
        ];
        if (!state.activeTransferSubTab) {
            state.activeTransferSubTab = actionableCount > 0 ? 'actionable' : 'all';
        }
    } else if (['admin', 'super_admin'].includes(role)) {
        const escalatedCount = allRequests.filter(r => r.stage === 'REJECTED_ADMIN' && r.is_actionable).length;
        subTabs = [
            { key: 'escalated', label: 'Escalated Rejections (Admin Action Required)', count: escalatedCount, icon: 'fa-solid fa-triangle-exclamation' },
            { key: 'all', label: role === 'super_admin' ? 'All University Transfers' : 'Campus Transfers (Including Cross-Campus)', count: allRequests.length, icon: 'fa-solid fa-list-check' }
        ];
        if (!state.activeTransferSubTab) {
            state.activeTransferSubTab = escalatedCount > 0 ? 'escalated' : 'all';
        }
    }

    if (!subTabs.some(tab => tab.key === state.activeTransferSubTab)) state.activeTransferSubTab = subTabs[0]?.key;

    // Filter displayed requests
    let displayedRequests = allRequests;
    if (role === 'hod') {
        if (state.activeTransferSubTab === 'incoming') {
            displayedRequests = allRequests.filter(r => r.is_incoming && r.is_actionable);
        } else if (state.activeTransferSubTab === 'outgoing') {
            displayedRequests = allRequests.filter(r => r.is_outgoing);
        } else if (state.activeTransferSubTab === 'completed') {
            displayedRequests = allRequests.filter(r => r.is_incoming && r.stage === 'COMPLETED');
        }
    } else if (role === 'coordinator' || role === 'dean') {
        if (state.activeTransferSubTab === 'actionable') {
            displayedRequests = allRequests.filter(r => r.is_actionable);
        }
    } else if (['admin', 'super_admin'].includes(role)) {
        if (state.activeTransferSubTab === 'escalated') {
            displayedRequests = allRequests.filter(r => r.stage === 'REJECTED_ADMIN' && r.is_actionable);
        }
    }

    const subTabsHtml = subTabs.map(t => `
        <button class="tab-btn ${state.activeTransferSubTab === t.key ? 'active' : ''}" onclick="switchTransferSubTab('${t.key}')" style="font-family: Cambria, Georgia, serif;">
            <i class="${t.icon}"></i> ${t.label} <span style="font-size: 0.8rem; opacity: 0.85; margin-left: 4px;">(${t.count})</span>
        </button>
    `).join('');

    const rows = displayedRequests.map((r, index) => {
        let actionButtonsHtml = '';

        // Remarks history view button (available for all)
        const remarksBtn = `
            <button class="btn btn-secondary" onclick="${transferAction('viewTransferRemarksHistory', r.id, r.application_no)}" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;" title="View Remarks & History">
                <i class="fa-solid fa-comments"></i> Remarks
            </button>
        `;

        // Dossier viewer button
        const dossierBtn = `
            <button class="btn btn-secondary" onclick="toggleCandidateDossier(${r.candidate_id}, this)" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;" title="View Dossier">
                <i class="fa-solid fa-folder-open"></i> Docs
            </button>
        `;

        // Role-specific action buttons
        if (role === 'hod' && r.is_incoming && r.is_actionable) {
            actionButtonsHtml = `
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button class="btn btn-success" onclick="${transferAction('openTargetHodAcceptModal', r.id, r.application_no, r.registered_name || '')}" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;" title="Accept into Department">
                        <i class="fa-solid fa-circle-check"></i> Accept
                    </button>
                    <button class="btn btn-danger" onclick="${transferAction('openTargetHodRejectModal', r.id, r.application_no, r.registered_name || '')}" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;" title="Reject Transfer">
                        <i class="fa-solid fa-circle-xmark"></i> Reject
                    </button>
                    ${dossierBtn}
                    ${remarksBtn}
                </div>
            `;
        } else if ((role === 'coordinator' || role === 'dean') && r.is_actionable) {
            actionButtonsHtml = `
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="${transferAction('openForwardTransferModal', r.id, r.stage, r.application_no, r.from_institution_id === r.to_institution_id)}" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;">
                        <i class="fa-solid fa-share-from-square"></i> Forward
                    </button>
                    ${dossierBtn}
                    ${remarksBtn}
                </div>
            `;
        } else if (['admin', 'super_admin'].includes(role) && r.stage === 'REJECTED_ADMIN' && r.is_actionable) {
            actionButtonsHtml = `
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="${transferAction('openAdminReassignModal', r.id, r.application_no, r.registered_name || '')}" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;" title="Reassign to Another Department">
                        <i class="fa-solid fa-map-location-dot"></i> Reassign
                    </button>
                    <button class="btn btn-danger" onclick="${transferAction('openAdminRejectModal', r.id, r.application_no, r.registered_name || '')}" style="padding: 4px 8px; font-size: 0.75rem; white-space: nowrap;" title="Reject (Not Selected)">
                        <i class="fa-solid fa-ban"></i> Reject (Not Selected)
                    </button>
                    ${dossierBtn}
                    ${remarksBtn}
                </div>
            `;
        } else {
            actionButtonsHtml = `
                <div style="display: flex; gap: 4px;">
                    ${dossierBtn}
                    ${remarksBtn}
                </div>
            `;
        }

        return `
            <tr>
                <td style="text-align: center; color: var(--text-muted); font-size: 0.78rem;">${index + 1}</td>
                <td>
                    <strong style="color: var(--text-primary); font-size: 0.85rem;">${transferEscape(r.application_no)}</strong>
                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                        ${transferTimestamp(r.created_at, true)}
                    </div>
                </td>
                <td>
                    <div style="font-weight: 600; font-size: 0.85rem;">${transferEscape(r.registered_name)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">${transferEscape(r.email || '')} &bull; ${transferEscape(r.mobile || '')}</div>
                </td>
                <td>
                    <div style="font-weight: 600; font-size: 0.82rem; color: var(--text-secondary);">${transferEscape(r.from_dept_name)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">${transferEscape(r.from_inst_name)}</div>
                </td>
                <td>
                    <div style="font-weight: 700; font-size: 0.85rem; color: var(--primary);">${transferEscape(r.to_dept_name)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">${transferEscape(r.to_inst_name)}</div>
                </td>
                <td style="max-width: 200px;">
                    <div style="font-size: 0.78rem; color: var(--text-secondary); word-break: break-word; background: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--glass-border);">
                        <strong>${transferEscape(r.requested_by)}:</strong> ${transferEscape(r.initial_reason || 'Department transfer requested')}
                    </div>
                </td>
                <td style="text-align: center;">
                    ${getTransferStageBadge(r.stage, r.status)}
                </td>
                <td style="vertical-align: middle;">
                    ${actionButtonsHtml}
                </td>
            </tr>
        `;
    }).join('');

    mainContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.2rem;">
            <div>
                <h2 style="font-size: 1.8rem; margin: 0;"><i class="fa-solid fa-arrow-right-arrow-left" style="color: var(--primary); margin-right: 8px;"></i> Transferred Candidates Dashboard</h2>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">
                    Track and manage candidate departmental transfers through the approved review and escalation hierarchy.
                </p>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="loadTabSpecificData()" style="padding: 6px 12px; font-family: Cambria, Georgia, serif;">
                <i class="fa-solid fa-rotate"></i> Refresh
            </button>
        </div>

        <div class="tabs-header" style="margin-bottom: 1.2rem; display: flex; gap: 8px; flex-wrap: wrap;">
            ${subTabsHtml}
        </div>

        <div class="table-container candidate-table-wrapper animate-fade-in" style="background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--glass-border);">
            <table class="candidate-data-table">
                <thead>
                    <tr>
                        <th style="width: 3%; text-align: center;">S.No</th>
                        <th style="width: 11%;">App No</th>
                        <th style="width: 15%;">Candidate Name</th>
                        <th style="width: 14%;">Originating Dept</th>
                        <th style="width: 16%;">Target Dept</th>
                        <th style="width: 18%;">Transfer Reason</th>
                        <th style="width: 12%; text-align: center;">Status / Stage</th>
                        <th style="width: 11%;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || `<tr><td colspan="8" style="text-align:center; padding: 2.5rem; color:var(--text-muted);"><i class="fa-solid fa-inbox fa-2x" style="opacity:0.3; display:block; margin-bottom:8px;"></i> No transfers found under this section.</td></tr>`}
                </tbody>
            </table>
        </div>
    `;
}

function switchTransferSubTab(tabKey) {
    state.activeTransferSubTab = tabKey;
    renderTransferRequestsTable();
}
window.switchTransferSubTab = switchTransferSubTab;

// --- MODALS FOR TRANSFER ACTIONS ---

// 1. Remarks & History Timeline Modal
async function viewTransferRemarksHistory(transferId, appNo) {
    appNo = transferEscape(appNo);
    try {
        const res = await api(`/api/transfers/${transferId}/remarks`);
        const remarks = res.remarks || [];

        const timelineHtml = remarks.map((rm, idx) => {
            let roleBadge = `<span class="badge badge-secondary" style="font-size: 0.68rem; padding: 2px 6px;">${transferEscape(rm.actor_role.toUpperCase())}</span>`;
            if (rm.actor_role === 'hod') roleBadge = `<span class="badge badge-primary" style="font-size: 0.68rem; padding: 2px 6px;">HOD</span>`;
            else if (rm.actor_role === 'coordinator') roleBadge = `<span class="badge badge-info" style="font-size: 0.68rem; padding: 2px 6px;">RESEARCH COORD</span>`;
            else if (rm.actor_role === 'dean') roleBadge = `<span class="badge badge-warning" style="font-size: 0.68rem; padding: 2px 6px;">DEAN / VP</span>`;
            else if (['admin', 'super_admin'].includes(rm.actor_role)) roleBadge = `<span class="badge badge-danger" style="font-size: 0.68rem; padding: 2px 6px;">ADMIN</span>`;

            return `
                <div style="position: relative; padding-left: 28px; margin-bottom: 1.2rem; border-left: 2px solid var(--primary);">
                    <div style="position: absolute; left: -7px; top: 0; width: 12px; height: 12px; border-radius: 50%; background: var(--primary);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <div>
                            <strong>${transferEscape(rm.actor_name || rm.actor_username)}</strong> ${roleBadge}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-muted);">
                            ${transferTimestamp(rm.created_at)}
                        </div>
                    </div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">
                        <i class="fa-solid fa-arrow-right" style="font-size: 0.7rem; color: var(--primary);"></i> ${transferEscape(rm.action)}
                    </div>
                    <div style="background: var(--bg-secondary); padding: 8px 12px; border-radius: 6px; font-size: 0.82rem; border: 1px solid var(--glass-border); line-height: 1.4;">
                        ${transferEscape(rm.remarks)}
                    </div>
                </div>
            `;
        }).join('');

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content animate-fade-in-up" style="max-width: 600px; max-height: 85vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-clock-rotate-left" style="color: var(--primary); margin-right: 8px;"></i> Transfer Remarks & History &bull; ${appNo}</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body" style="overflow-y: auto; flex: 1; padding: 1.5rem;">
                    ${timelineHtml || '<p style="text-align: center; color: var(--text-muted);">No remarks recorded yet.</p>'}
                </div>
                <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--glass-border); display: flex; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.viewTransferRemarksHistory = viewTransferRemarksHistory;

// 2. Forward Transfer Modal (Coordinator & Dean)
function openForwardTransferModal(transferId, currentStage, appNo, isIntraFaculty) {
    appNo = transferEscape(appNo);
    let nextStepLabel = '';
    if (state.user.role === 'coordinator') {
        if (currentStage === 'ORIG_RC') nextStepLabel = 'Originating Dean / VP';
        else if (currentStage === 'TARGET_RC') nextStepLabel = 'Target Department HOD';
        else if (currentStage === 'REJECTED_RC') nextStepLabel = 'Dean / VP (Rejection Escalation)';
    } else if (state.user.role === 'dean') {
        if (currentStage === 'ORIG_DEAN') {
            nextStepLabel = isIntraFaculty ? 'Target Department HOD (Intra-Faculty Transfer)' : 'Target Faculty Dean / VP';
        } else if (currentStage === 'TARGET_DEAN') {
            nextStepLabel = 'Target Research Coordinator';
        } else if (currentStage === 'REJECTED_DEAN') {
            nextStepLabel = 'Receiving Campus Admin (Rejection Escalation)';
        }
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-share-from-square" style="color: var(--primary); margin-right: 8px;"></i> Forward Transfer Request</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="forward-transfer-form">
                    <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 1rem;">
                        Forward application <strong>${appNo}</strong> to <strong>${nextStepLabel}</strong>.
                    </p>
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="forward-remarks"><strong>Remarks / Recommendation Notes (Optional)</strong></label>
                        <textarea id="forward-remarks" class="form-control" rows="3" placeholder="Enter remarks, approval comments, or instructions..."></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">
                            <i class="fa-solid fa-paper-plane"></i> Confirm Forward
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('forward-transfer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const remarks = document.getElementById('forward-remarks').value;
        if (!transferSubmitLock(e.currentTarget)) return;
        const submittedForm = e.currentTarget;
        try {
            await api(`/api/transfers/${transferId}/forward`, 'POST', { remarks });
            showToast('Transfer request successfully forwarded.');
            modal.remove();
            if (window.refreshTransferPendingCount) await window.refreshTransferPendingCount();
            loadTabSpecificData();
        } catch (err) {
            showToast(err.message, 'error');
        } finally { transferSubmitUnlock(submittedForm); }
    });
}
window.openForwardTransferModal = openForwardTransferModal;

// 3. Target HOD Accept Modal
function openTargetHodAcceptModal(transferId, appNo, candidateName) {
    appNo = transferEscape(appNo);
    candidateName = transferEscape(candidateName);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-user-check" style="color: var(--success); margin-right: 8px;"></i> Accept Candidate Transfer</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="target-hod-accept-form">
                    <div style="background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); padding: 1rem; border-radius: 6px; margin-bottom: 1.2rem;">
                        <p style="margin: 0; font-size: 0.88rem; color: var(--text-primary); line-height: 1.4;">
                            Are you sure you want to accept <strong>${candidateName}</strong> (${appNo}) into your department?
                        </p>
                        <p style="margin: 8px 0 0 0; font-size: 0.8rem; color: var(--text-secondary);">
                            <i class="fa-solid fa-circle-info" style="color: var(--success);"></i> Upon accepting, the candidate will officially move into your <strong>Candidate Eligibility Verification</strong> tab, where they will be evaluated and verified like any other applicant.
                        </p>
                    </div>
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="accept-notes"><strong>Acceptance Remarks (Optional)</strong></label>
                        <textarea id="accept-notes" class="form-control" rows="2" placeholder="e.g., Eligible for department programs, accepted for verification..."></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-success">
                            <i class="fa-solid fa-check"></i> Accept Candidate
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('target-hod-accept-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = document.getElementById('accept-notes').value;
        if (!transferSubmitLock(e.currentTarget)) return;
        const submittedForm = e.currentTarget;
        try {
            await api(`/api/transfers/${transferId}/target-hod-decision`, 'POST', { action: 'Accept', reason });
            showToast('Candidate successfully accepted! Moving to your Eligibility Verification queue.');
            modal.remove();
            if (window.refreshTransferPendingCount) await window.refreshTransferPendingCount();
            navigateToTab('dashboard'); // Takes HOD to dashboard where eligibility verification tab lives
        } catch (err) {
            showToast(err.message, 'error');
        } finally { transferSubmitUnlock(submittedForm); }
    });
}
window.openTargetHodAcceptModal = openTargetHodAcceptModal;

// 4. Target HOD Reject Modal
function openTargetHodRejectModal(transferId, appNo, candidateName) {
    appNo = transferEscape(appNo);
    candidateName = transferEscape(candidateName);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-circle-xmark" style="color: var(--danger); margin-right: 8px;"></i> Reject Candidate Transfer</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="target-hod-reject-form">
                    <div style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); padding: 1rem; border-radius: 6px; margin-bottom: 1.2rem;">
                        <p style="margin: 0; font-size: 0.88rem; color: var(--text-primary); line-height: 1.4;">
                            Reject candidate <strong>${candidateName}</strong> (${appNo}) transfer to your department.
                        </p>
                        <p style="margin: 8px 0 0 0; font-size: 0.8rem; color: var(--text-secondary);">
                            <i class="fa-solid fa-circle-exclamation" style="color: var(--danger);"></i> A mandatory reason must be provided. This rejection will be escalated up through the Research Coordinator and Dean to the Admin for resolution.
                        </p>
                    </div>
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="reject-reason"><strong>Reason for Rejection <span style="color: var(--danger);">*</span></strong></label>
                        <textarea id="reject-reason" class="form-control" rows="3" required placeholder="State why this candidate cannot be accepted into your department..."></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-danger">
                            <i class="fa-solid fa-ban"></i> Reject & Escalate
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('target-hod-reject-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = document.getElementById('reject-reason').value;
        if (!reason || !reason.trim()) {
            showToast('Please state a reason for rejection.', 'error');
            return;
        }
        if (!transferSubmitLock(e.currentTarget)) return;
        const submittedForm = e.currentTarget;
        try {
            await api(`/api/transfers/${transferId}/target-hod-decision`, 'POST', { action: 'Reject', reason: reason.trim() });
            showToast('Transfer rejected with reason. Escalated to Research Coordinator and Dean.');
            modal.remove();
            if (window.refreshTransferPendingCount) await window.refreshTransferPendingCount();
            loadTabSpecificData();
        } catch (err) {
            showToast(err.message, 'error');
        } finally { transferSubmitUnlock(submittedForm); }
    });
}
window.openTargetHodRejectModal = openTargetHodRejectModal;

// 5. Admin Reassign Modal
function openAdminReassignModal(transferId, appNo, candidateName) {
    appNo = transferEscape(appNo);
    candidateName = transferEscape(candidateName);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 520px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-map-location-dot" style="color: var(--primary); margin-right: 8px;"></i> Reassign Candidate &bull; ${appNo}</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="admin-reassign-form">
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem;">
                        Target HOD rejected this applicant. Select a new target institution and department to re-route <strong>${candidateName}</strong>.
                    </p>
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label for="admin-reassign-inst"><strong>New Target Institution / Faculty <span style="color:var(--danger)">*</span></strong></label>
                        <select id="admin-reassign-inst" class="form-control" required onchange="populateAdminReassignDepts(this.value)">
                            <option value="">-- Select Institution / Faculty --</option>
                            
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label for="admin-reassign-dept"><strong>New Target Department <span style="color:var(--danger)">*</span></strong></label>
                        <select id="admin-reassign-dept" class="form-control" required>
                            <option value="">-- Select Department --</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="admin-reassign-notes"><strong>Admin Reassignment Notes (Optional)</strong></label>
                        <textarea id="admin-reassign-notes" class="form-control" rows="2" placeholder="State reason or instructions for the new department HOD..."></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">
                            <i class="fa-solid fa-share"></i> Reassign & Route
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    populateTransferInstitutions('admin-reassign-inst');

    document.getElementById('admin-reassign-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const new_institution_id = document.getElementById('admin-reassign-inst').value;
        const new_department_id = document.getElementById('admin-reassign-dept').value;
        const reason = document.getElementById('admin-reassign-notes').value;

        if (!transferSubmitLock(e.currentTarget)) return;
        const submittedForm = e.currentTarget;
        try {
            await api(`/api/transfers/${transferId}/admin-decision`, 'POST', {
                action: 'Reassign',
                new_institution_id,
                new_department_id,
                reason
            });
            showToast('Reassignment sent to the new HoD for acceptance.');
            modal.remove();
            if (window.refreshTransferPendingCount) await window.refreshTransferPendingCount();
            loadTabSpecificData();
        } catch (err) {
            showToast(err.message, 'error');
        } finally { transferSubmitUnlock(submittedForm); }
    });
}
window.openAdminReassignModal = openAdminReassignModal;

async function populateAdminReassignDepts(instId) {
    const select = document.getElementById('admin-reassign-dept');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Department --</option>';
    if (!instId) return;
    select.disabled = true;
    try {
        const metadata = await api('/api/transfers/destinations');
        if (document.getElementById('admin-reassign-dept') !== select) return;
        const instituteSelect = document.getElementById('admin-reassign-inst');
        if (instituteSelect && Number(instituteSelect.value) !== Number(instId)) return;
        for (const department of metadata.departments.filter(d => Number(d.institution_id) === Number(instId))) {
            select.add(new Option(department.name, department.id));
        }
    } catch (error) { showToast(error.message, 'error'); }
    finally { select.disabled = false; }
}
window.populateAdminReassignDepts = populateAdminReassignDepts;

// 6. Admin Reject Modal (Move to Not Selected with reason)
function openAdminRejectModal(transferId, appNo, candidateName) {
    appNo = transferEscape(appNo);
    candidateName = transferEscape(candidateName);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-ban" style="color: var(--danger); margin-right: 8px;"></i> Mark as Not Selected &bull; ${appNo}</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="admin-reject-form">
                    <div style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); padding: 1rem; border-radius: 6px; margin-bottom: 1.2rem;">
                        <p style="margin: 0; font-size: 0.88rem; color: var(--text-primary); line-height: 1.4;">
                            You are rejecting candidate <strong>${candidateName}</strong> (${appNo}).
                        </p>
                        <p style="margin: 8px 0 0 0; font-size: 0.8rem; color: var(--text-secondary);">
                            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i> This will move the applicant into the <strong>Not Selected</strong> tab. The reason specified below will be visibly displayed in the Not Selected list.
                        </p>
                    </div>
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="admin-reject-reason"><strong>Reason for Non-Selection <span style="color:var(--danger)">*</span></strong></label>
                        <textarea id="admin-reject-reason" class="form-control" rows="3" required placeholder="Specify the definitive reason for non-selection (e.g., Target department unable to accommodate; no suitable faculty/supervisor vacant)..."></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-danger">
                            <i class="fa-solid fa-user-xmark"></i> Confirm Non-Selection
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('admin-reject-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = document.getElementById('admin-reject-reason').value;
        if (!reason || !reason.trim()) {
            showToast('Please state a reason for non-selection.', 'error');
            return;
        }

        if (!transferSubmitLock(e.currentTarget)) return;
        const submittedForm = e.currentTarget;
        try {
            await api(`/api/transfers/${transferId}/admin-decision`, 'POST', {
                action: 'Reject',
                reason: reason.trim()
            });
            showToast('Candidate marked as Not Selected with reason recorded.');
            modal.remove();
            if (window.refreshTransferPendingCount) await window.refreshTransferPendingCount();
            loadTabSpecificData();
        } catch (err) {
            showToast(err.message, 'error');
        } finally { transferSubmitUnlock(submittedForm); }
    });
}
window.openAdminRejectModal = openAdminRejectModal;

// --- EMAIL LOGS TABLE ---
function renderEmailLogsTable() {
    const mainContent = document.getElementById('main-content');
    const rows = state.emailLogs.map(l => `
        <div class="email-log-item">
            <div class="email-log-header">
                <div>
                    <strong>To: ${l.registered_name} (${l.recipient_email})</strong>
                    ${l.application_no && !l.subject.includes('[Summary]') && !l.subject.includes('[Action Required]') ? `
                        <span style="font-size:0.75rem; color:var(--text-muted); margin-left: 8px;">App No: ${l.application_no}</span>
                    ` : ''}
                </div>
                <span class="badge ${l.status.startsWith('Mock') || l.status === 'Sent' ? 'badge-success' : 'badge-danger'}">${l.status}</span>
            </div>
            <div style="font-size:0.9rem; font-weight:600; margin-bottom: 4px;">Subject: ${l.subject}</div>
            <div class="email-log-body">${l.body}</div>
            <div style="font-size:0.7rem; color:var(--text-muted); text-align:right; margin-top:4px;">Dispatched at: ${new Date(l.sent_at.replace(' ', 'T') + 'Z').toLocaleString()}</div>
        </div>
    `).join('');

    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;">Admissions Email Communications Log</h2>
        <div class="card animate-fade-in" style="max-height: 70vh; overflow-y: auto;">
            ${rows || '<p style="text-align:center; color:var(--text-muted); padding: 2rem;">No emails dispatched yet.</p>'}
        </div>
    `;
}

// Render sub rank lists in grouped view
// Render sub rank lists in grouped view
function renderMiniRankTable(candList) {
    const checkableList = candList.filter(c => {
        if (rankAwaitingAdminRelease(c) && !['admin','super_admin'].includes(state.user.role)) return false;
        if (candidateBulkForwardKey(c)) return true;
        if (['admin', 'super_admin'].includes(state.user.role)) {
            return c.current_owner === 'Admin' && ['Pending Verification', 'Complete', 'Eligible', 'Not Eligible', 'Incomplete', 'Approved Guides', 'Ranked', 'Marks Entered'].includes(c.status);
        } else if (state.user.role === 'coordinator') {
            return (c.current_owner === 'RC' || c.current_owner === 'Coordinator') && ['Under RC Review', 'Returned to RC', 'Under RC Review (Ranks)', 'Selection Finalized', 'Returned to RC (Guides)', 'Under Coordinator Review', 'Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible', 'Ranks Released'].includes(c.status);
        } else if (state.user.role === 'dean') {
            return c.current_owner === 'Dean' && ['Under Dean Review', 'Returned to Dean', 'Under Dean Review (Ranks)', 'Under Dean Final Review', 'Returned to Dean (Final)', 'Under Dean Initial Review', 'Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status);
        } else if (state.user.role === 'hod') {
            if ((c.form_status || '').toLowerCase() === 'incomplete' || c.status === 'Incomplete') return false;
            return c.current_owner === 'HOD' && ['HOD Verified Eligible', 'HOD Verified Ineligible', 'Guide Allocation Open', 'Guide Allocated', 'Returned to HOD (Guides)'].includes(c.status);
        }
        return false;
    });
    const hasCheckboxes = checkableList.length > 0;
    const selectAllCheckbox = hasCheckboxes 
        ? `<input type="checkbox" class="select-all-candidates" onchange="toggleSelectAllCandidates(this, '${candList.map(c => c.id).join(',')}')" style="transform: scale(1.15); cursor: pointer; margin:0;" title="Select all in this group">` 
        : `<input type="checkbox" disabled style="opacity: 0.25; transform: scale(1.15); margin:0;">`;

    const rowsHtml = candList.map((c, index) => {
        let badge = `<span class="badge badge-pending">${c.status}</span>`;
        if (c.selection_status === 'Not Selected' || c.status === 'Entrance Exam Absent') {
            const reason = c.exam_attendance === 'Absent' ? ' (Absent)' : (c.status === 'Evaluated (Failed Cutoff)' ? ' (Failed Cutoff)' : '');
            badge = `<span class="badge badge-danger" style="background-color: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-user-xmark"></i> Not Selected${reason}</span>`;
            if (c.status_reason) {
                badge += `<div style="font-size: 0.74rem; color: #b91c1c; margin-top: 4px; max-width: 240px; word-break: break-word; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); padding: 4px 7px; border-radius: 4px; text-align: left;" title="${transferEscape(c.status_reason)}"><i class="fa-solid fa-circle-exclamation" style="margin-right:3px;"></i><strong>Reason:</strong> ${transferEscape(c.status_reason)}</div>`;
            }
        } else if (c.selection_status === 'Selected') {
            badge = `<span class="badge badge-success"><i class="fa-solid fa-user-check"></i> Selected</span>`;
        } else if (c.status && c.status.startsWith('Returned to')) {
            badge = `<span class="badge badge-danger" style="background-color: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-triangle-exclamation"></i> ${c.status}</span>`;
            if (c.return_remark) {
                badge += `<div style="font-size: 0.72rem; color: #ef4444; margin-top: 4px; max-width: 180px; word-break: break-word; background: rgba(239,68,68,0.08); padding: 3px 6px; border-radius: 4px;" title="${c.return_remark.replace(/"/g, '&quot;')}"><i class="fa-solid fa-comment-dots"></i> <strong>Query:</strong> ${c.return_remark}</div>`;
            }
        }
        else if (c.status === 'Approved Guides') badge = `<span class="badge badge-success" style="background-color: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3);">Guide Approved</span>`;
        else if (c.status === 'Selection Finalized') badge = `<span class="badge badge-info" style="background-color: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3);">Selection Confirmed</span>`;
        else if (c.status === 'Guide Allocated') badge = `<span class="badge badge-info">Guide Allocated</span>`;
        else if (c.status === 'Guide Allocation Open') badge = `<span class="badge badge-warning">Ready for HoD Selection</span>`;
        else if (c.status === 'Under RC Review (Ranks)' || c.status === 'Ranks Released') badge = `<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);">Awaiting Admin Rank Release</span>`;
        else if (c.status === 'Under Dean Review (Ranks)') badge = `<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);">Release Ranks to All</span>`;
        else if (c.status === 'Ranked') badge = `<span class="badge badge-pending"><i class="fa-solid fa-ranking-star"></i> Ranked</span>`;
        else if (c.status === 'Marks Entered') badge = `<span class="badge badge-info"><i class="fa-solid fa-check"></i> Marks Entered</span>`;
        else if (c.status === 'Entrance Exam Attended') badge = `<span class="badge badge-info"><i class="fa-solid fa-user-clock"></i> Exam Attended</span>`;
        else if (c.current_owner === 'HOD' && c.status === 'HOD Verified Eligible') badge = `<span class="badge badge-success"><i class="fa-solid fa-check"></i> HOD Verified Eligible</span>`;
        else if (c.current_owner === 'HOD' && c.status === 'HOD Verified Ineligible') badge = `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> HOD Verified Ineligible</span>`;
        else if (['Eligible', 'Verified Eligible'].includes(c.status) || c.status_reason === 'Eligible' || (c.status === 'HOD Verified Eligible' && c.current_owner !== 'HOD')) {
            if (c.current_owner === 'Admin' && (c.status === 'Eligible' || c.status_reason === 'Eligible')) badge = `<span class="badge badge-success">Eligibility Checked by Dean</span>`;
            else if (c.current_owner === 'Dean') badge = `<span class="badge badge-success">Eligibility Checked by RC</span>`;
            else if (c.current_owner === 'RC' || c.current_owner === 'Coordinator') badge = `<span class="badge badge-success">Eligibility Checked by HOD</span>`;
            else badge = `<span class="badge badge-success">Eligible</span>`;
        }
        else if (['Not Eligible', 'Verified Ineligible'].includes(c.status) || c.status_reason === 'Not Eligible' || (c.status === 'HOD Verified Ineligible' && c.current_owner !== 'HOD')) {
            if (c.current_owner === 'Admin' && (c.status === 'Not Eligible' || c.status_reason === 'Not Eligible')) badge = `<span class="badge badge-danger">Eligibility Checked by Dean (Not Eligible)</span>`;
            else if (c.current_owner === 'Dean') badge = `<span class="badge badge-danger">Eligibility Checked by RC (Not Eligible)</span>`;
            else if (c.current_owner === 'RC' || c.current_owner === 'Coordinator') badge = `<span class="badge badge-danger">Eligibility Checked by HOD (Not Eligible)</span>`;
            else badge = `<span class="badge badge-danger">Not Eligible</span>`;
        }
        else if (c.status === 'Incomplete' || (c.form_status || '').toLowerCase() === 'incomplete') {
            badge = `<span class="badge badge-danger">Incomplete Application</span>`;
        }
        else if (c.status === 'Complete' || c.status === 'Pending Verification' || c.status === 'Under HOD Verification') {
            badge = `<span class="badge badge-info">Complete Application</span>`;
        }

        let viewBtn = `<button class="btn btn-secondary" onclick="toggleCandidateDossier(${c.id}, this)" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="View Docs"><i class="fa-solid fa-folder-open"></i></button>`;
        let editBtn = '';
        let workflowBtn = '';
        let deleteBtn = '';

        if (state.user.username === 'rmp_research_office' || state.user.username === 'trichy_research_office') {
            workflowBtn = `<button class="btn btn-primary" onclick="openReassignModal(${c.id})" style="padding: 4px 8px; font-size:0.75rem;">Re-route Dept <i class="fa-solid fa-map-location-dot"></i></button>`;
        } else if (['admin', 'super_admin'].includes(state.user.role)) {
            if (c.current_owner === 'Admin' && c.status === 'Approved Guides') {
                workflowBtn = `<button class="btn btn-warning" onclick="showRemarkModal('Return Selections to Dean with Query', 'Query for Dean...', (remark) => executeSingleReturn('/api/admin/return-selections-to-dean', ${c.id}, remark, 'Returned to Dean'))" style="padding:4px 8px;font-size:0.75rem">Return Selections to Dean for Query</button>`;
            } else if (c.selection_status === 'Not Selected' || c.status === 'Entrance Exam Absent') {
                editBtn = `<button class="btn btn-secondary" onclick="markAttendanceModal(${c.id})" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Edit Marks / Attendance"><i class="fa-solid fa-pen-to-square"></i> Edit Marks</button>`;
                workflowBtn = ``;
            } else if (rankAwaitingAdminRelease(c)) {
                editBtn = `<button class="btn btn-secondary" onclick="markAttendanceModal(${c.id})" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Edit Marks"><i class="fa-solid fa-pen-to-square"></i> Edit Marks</button>`;
                workflowBtn = `<button class="btn btn-primary" onclick="executeSingleAction('/api/admin/release-ranks-to-all', ${c.id}, 'Ranks released to all')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Release Ranks to All"><i class="fa-solid fa-share-from-square"></i> Release Ranks to All</button>`;
            } else if (c.current_owner === 'Admin' && (c.status === 'Eligible' || c.status === 'Marks Entered' || c.status === 'Entrance Exam Attended' || (c.status_reason === 'Eligible' && !isCandidateRanked(c)))) {
                const hasMarks = (c.total_marks !== null && c.total_marks !== undefined) || c.status === 'Marks Entered';
                editBtn = `<button class="btn ${hasMarks ? 'btn-secondary' : 'btn-primary'}" onclick="markAttendanceModal(${c.id})" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="${hasMarks ? 'Edit Marks' : 'Enter Marks'}"><i class="fa-solid fa-pen-to-square"></i> ${hasMarks ? 'Edit Marks' : 'Enter Marks'}</button>`;
                workflowBtn = `<button class="btn btn-warning" onclick="showRemarkModal('Return to Dean for query', 'Enter query for Dean...', (remark) => executeSingleReturn('/api/admin/return-to-dean', ${c.id}, remark, 'Returned to Dean'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return to Dean for query"><i class="fa-solid fa-reply"></i> Return to Dean for query</button>`;
            } else if (c.current_owner === 'Admin' && (c.status === 'Pending Verification' || c.status === 'Complete' || isCandidateComplete(c))) {
                workflowBtn = `
                    <button class="btn btn-primary" onclick="executeSingleAction('/api/admin/forward-to-dean', ${c.id}, 'Forwarded to Dean')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward to Dean"><i class="fa-solid fa-paper-plane"></i> Forward to Dean</button>
                `;
            } else if (c.status === 'Incomplete' && c.current_owner === 'Admin' && c.department_id && ![100, 101].includes(c.department_id)) {
                workflowBtn = `
                    <button class="btn btn-info" onclick="executeSingleAction('/api/admin/forward-incomplete-to-hod', ${c.id}, 'Incomplete forwarded to HOD')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward Incomplete to HOD"><i class="fa-solid fa-paper-plane"></i> Forward to HOD</button>
                `;
            } else if (c.current_owner === 'Admin' && (c.status === 'Not Eligible' || c.status_reason === 'Not Eligible')) {
                workflowBtn = `<button class="btn btn-warning" onclick="showRemarkModal('Return to Dean for query', 'Enter query for Dean...', (remark) => executeSingleReturn('/api/admin/return-to-dean', ${c.id}, remark, 'Returned to Dean'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return to Dean for query"><i class="fa-solid fa-reply"></i> Return to Dean for query</button>`;
            } else if (c.status === 'Approved Guides' && c.current_owner === 'Admin') {
                workflowBtn = `<button class="btn btn-warning" onclick="showRemarkModal('Return Selections to Dean with Query', 'Query for Dean...', (remark) => executeSingleReturn('/api/admin/return-selections-to-dean', ${c.id}, remark, 'Returned to Dean'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return Selections to Dean"><i class="fa-solid fa-reply"></i> Return Selections to Dean</button>`;
            }
            deleteBtn = `<button class="btn btn-danger" onclick="if(confirm('Are you sure you want to delete this candidate?')) { deleteCandidates([${c.id}]); }" style="padding: 4px 8px; font-size:0.75rem; background-color: #ef4444; border-color: #ef4444;" title="Delete Candidate"><i class="fa-solid fa-trash"></i></button>`;

        } else if (state.user.role === 'coordinator') {
            const isOwner = (c.current_owner === 'RC' || c.current_owner === 'Coordinator');
            if (rankAwaitingAdminRelease(c)) {
                workflowBtn = '<span>Awaiting Admin rank release</span>';
            } else if (isOwner && ['Selection Finalized', 'Returned to RC (Guides)'].includes(c.status)) {
                // Selections review
                workflowBtn = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <button class="btn btn-success" onclick="executeSingleAction('/api/rc/forward-selections-to-dean', ${c.id}, 'Selections forwarded to Dean')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward Selections to Dean"><i class="fa-solid fa-paper-plane"></i> Forward Selections to Dean</button>
                        <button class="btn btn-warning" onclick="showRemarkModal('Return Selections to HOD for query', 'Enter query for HOD...', (remark) => executeSingleReturn('/api/rc/return-selections-to-hod', ${c.id}, remark, 'Returned to HOD'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return Selections to HOD"><i class="fa-solid fa-reply"></i> Return Selections to HOD</button>
                    </div>
                `;
            } else if (isOwner && (isCandidateEligible(c) || isCandidateIneligible(c) || c.status_reason || ['Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status))) {
                // After HOD eligibility check: Forward Eligibility Status to Dean OR Return to HOD for query
                workflowBtn = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <button class="btn btn-success" onclick="executeSingleAction('/api/rc/forward-to-dean', ${c.id}, 'Eligibility status forwarded to Dean')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward Eligibility Status to Dean"><i class="fa-solid fa-paper-plane"></i> Forward Eligibility Status to Dean</button>
                        <button class="btn btn-warning" onclick="showRemarkModal('Return to HOD for query', 'Enter query for HOD...', (remark) => executeSingleReturn('/api/rc/return-to-hod', ${c.id}, remark, 'Returned to HOD'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return to HOD for query"><i class="fa-solid fa-reply"></i> Return to HOD for query</button>
                    </div>
                `;
            } else if (isOwner && ['Under RC Review', 'Returned to RC', 'Under Coordinator Review'].includes(c.status)) {
                // Initial scrutiny before HOD check: only Forward to HOD
                workflowBtn = `<button class="btn btn-primary" onclick="executeSingleAction('/api/rc/forward-to-hod', ${c.id}, 'Forwarded to HOD')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward to HOD"><i class="fa-solid fa-share-from-square"></i> Forward to HOD</button>`;
            }

        } else if (state.user.role === 'dean') {
            const isOwner = (c.current_owner === 'Dean');
            if (rankAwaitingAdminRelease(c)) {
                workflowBtn = '<span>Awaiting Admin rank release</span>';
            } else if (isOwner && ['Under Dean Final Review', 'Returned to Dean (Final)'].includes(c.status)) {
                // Selections review
                workflowBtn = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <button class="btn btn-success" onclick="executeSingleAction('/api/dean/forward-selections-to-admin', ${c.id}, 'Selections approved and forwarded to Admin')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Approve Selections to Admin"><i class="fa-solid fa-paper-plane"></i> Approve Selections to Admin</button>
                        <button class="btn btn-warning" onclick="showRemarkModal('Return Selections to RC for query', 'Query for RC...', (remark) => executeSingleReturn('/api/dean/return-selections-to-rc', ${c.id}, remark, 'Returned to RC'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return Selections to RC"><i class="fa-solid fa-reply"></i> Return Selections to RC</button>
                    </div>
                `;
            } else if (isOwner && (isCandidateEligible(c) || isCandidateIneligible(c) || c.status_reason || ['Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status))) {
                // After HOD & RC check: Forward Eligibility Status to Admin OR Return to RC for query
                workflowBtn = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <button class="btn btn-success" onclick="executeSingleAction('/api/dean/forward-eligibility-to-admin', ${c.id}, 'Eligibility status forwarded to Admin')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward Eligibility Status to Admin"><i class="fa-solid fa-paper-plane"></i> Forward Eligibility Status to Admin</button>
                        <button class="btn btn-warning" onclick="showRemarkModal('Return to RC for query', 'Enter query for RC...', (remark) => executeSingleReturn('/api/dean/return-to-rc', ${c.id}, remark, 'Returned to RC'))" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Return to RC for query"><i class="fa-solid fa-reply"></i> Return to RC for query</button>
                    </div>
                `;
            } else if (isOwner && ['Under Dean Review', 'Returned to Dean', 'Under Dean Initial Review'].includes(c.status)) {
                // Initial scrutiny before HOD check: only Forward to RC
                workflowBtn = `<button class="btn btn-primary" onclick="executeSingleAction('/api/dean/forward-to-rc', ${c.id}, 'Forwarded to RC')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward to RC"><i class="fa-solid fa-share-from-square"></i> Forward to RC</button>`;
            }

        } else if (state.user.role === 'hod') {
            // Incomplete tab: strictly show only names with documents and details — NO workflow/verification buttons
            if ((c.form_status || '').toLowerCase() === 'incomplete' || c.status === 'Incomplete' || state.activeCandidateFilter === 'Incomplete Applications') {
                workflowBtn = '';
            } else if (['Under HOD Verification', 'Returned to HOD', 'Complete', 'Pending Verification'].includes(c.status) && c.current_owner === 'HOD') {
                const dl = getDeadlineStatus('deadline_eligibility', 'Candidate Eligibility Verification');
                if (dl.isPast) {
                    workflowBtn = `<button class="btn btn-secondary" disabled style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap; opacity:0.6; cursor:not-allowed;" title="Deadline passed on ${dl.dateStr}"><i class="fa-solid fa-lock"></i> Verification Closed</button>`;
                } else {
                    workflowBtn = `<button class="btn btn-primary" onclick="openHodEligibilityDashboard(${c.id})" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;"><i class="fa-solid fa-user-check"></i> Check Eligibility</button>`;
                }
            } else if (['HOD Verified Eligible', 'HOD Verified Ineligible'].includes(c.status) && c.current_owner === 'HOD') {
                const dl = getDeadlineStatus('deadline_eligibility', 'Candidate Eligibility Verification');
                workflowBtn = `
                    <div style="display:flex; align-items:center; gap:4px;">
                        <button class="btn btn-success" onclick="executeSingleAction('/api/hod/forward-to-rc', ${c.id}, 'Eligibility status forwarded to RC')" style="padding: 4px 8px; font-size:0.75rem; white-space:nowrap;" title="Forward Eligibility Status to RC"><i class="fa-solid fa-paper-plane"></i> Forward to RC</button>
                        ${dl.isPast ? '' : `<button class="btn btn-secondary" onclick="openHodEligibilityDashboard(${c.id})" style="padding: 4px 7px; font-size:0.75rem;" title="Change Eligibility Verdict"><i class="fa-solid fa-user-pen"></i></button>`}
                    </div>
                `;
            } else if (['Guide Allocation Open', 'Returned to HOD (Guides)'].includes(c.status) && c.current_owner === 'HOD') {
                const isSelectedOrNot = ['Selected', 'Not Selected'].includes(c.selection_status);
                workflowBtn = `
                    <div style="display:flex; flex-direction:column; gap:3px; min-width: 125px;">
                        <select class="form-select" data-selection-candidate="${Number(c.id)}" onchange="changeSelectionStatus(${c.id}, this.value)" style="padding: 3px 6px; font-size:0.74rem; border-radius:4px; border: 1px solid var(--glass-border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer;">
                            <option value="" ${!isSelectedOrNot ? 'selected' : ''}>-- Mark Status --</option>
                            <option value="Selected" ${c.selection_status === 'Selected' ? 'selected' : ''} ${canSelectWithinAllotment(c) ? '' : 'disabled'}>Selected</option>
                            <option value="Not Selected" ${c.selection_status === 'Not Selected' ? 'selected' : ''}>Not Selected</option>
                        </select>
                        <div style="display:flex; gap:3px;">
                            <button class="btn btn-primary" onclick="assignSupervisorModal(${c.id})" style="padding: 3px 6px; font-size:0.72rem; flex:1; white-space:nowrap;" title="Assign Guide"><i class="fa-solid fa-user-plus"></i> Guide</button>
                            ${isSelectedOrNot ? `<button class="btn btn-success" onclick="executeSingleAction('/api/hod/forward-selections-to-rc', ${c.id}, 'Selections forwarded to RC')" style="padding: 3px 6px; font-size:0.72rem; flex:1; white-space:nowrap;" title="Forward Selections to RC"><i class="fa-solid fa-paper-plane"></i> Fwd</button>` : ''}
                        </div>
                    </div>
                `;
            } else if (c.status === 'Guide Allocated' && c.current_owner === 'HOD') {
                workflowBtn = `
                    <div style="display:flex; gap:3px;">
                        <select class="form-select" data-selection-candidate="${Number(c.id)}" aria-label="Selection status" onchange="changeSelectionStatus(${c.id},this.value)"><option value="Selected" selected>Selected</option><option value="Not Selected">Not Selected</option></select>
                        <button class="btn btn-primary" onclick="assignSupervisorModal(${c.id})" style="padding: 3px 6px; font-size:0.72rem; white-space:nowrap;" title="Change Guide"><i class="fa-solid fa-user-pen"></i> Guide</button>
                        <button class="btn btn-success" onclick="executeSingleAction('/api/hod/forward-selections-to-rc', ${c.id}, 'Selections forwarded to RC')" style="padding: 3px 6px; font-size:0.72rem; white-space:nowrap;" title="Forward Selections to RC"><i class="fa-solid fa-paper-plane"></i> Fwd</button>
                    </div>
                `;
            }
        }

        let prefHtml = '';
        if (c.preference_1 || c.preference_2) {
            prefHtml = `<div style="margin-top:4px; padding-top:4px; border-top:1px dashed var(--glass-border); font-size:0.7rem; color:var(--text-muted);">
                ${c.preference_1 ? `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;" title="${c.preference_1}"><strong>Pref 1:</strong> ${c.preference_1}</div>` : ''}
                ${c.preference_2 ? `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;" title="${c.preference_2}"><strong>Pref 2:</strong> ${c.preference_2}</div>` : ''}
            </div>`;
        }

        const scoreStr = c.total_marks ? `<strong>${c.total_marks.toFixed(1)}</strong>` : '-';
        const rankStr = c.rank ? `Rank #${c.rank}` : '-';
        const allocationReasonHtml = c.allocation_remark ? '<div style="margin-top:4px;font-size:0.75rem"><strong>Allocation reason:</strong> '+transferEscape(c.allocation_remark)+'</div>' : '';
        const supervisorStr = c.supervisor_name ? `<strong>${c.supervisor_name}</strong><br><span style="font-size:0.72rem; color:var(--text-muted);">${c.supervisor_designation || ''}</span>${prefHtml}` : `<span style="color:var(--text-muted); font-size:0.75rem;">Not Assigned</span>${prefHtml}`;

        const isCheckable = checkableList.some(item => item.id === c.id);
        const checkboxTd = `<td style="text-align:center; vertical-align:middle;">
            ${isCheckable 
                ? `<input type="checkbox" class="candidate-checkbox" value="${c.id}" onchange="updateBulkActionVisibility()" style="transform: scale(1.15); cursor: pointer; margin:0;">` 
                : `<input type="checkbox" disabled style="opacity: 0.25; transform: scale(1.15); margin:0;">`
            }
        </td>`;

        return `
            <tr>
                ${checkboxTd}
                <td style="text-align:center; color:var(--text-muted); font-size:0.78rem;">${index + 1}</td>
                <td style="overflow:hidden;">
                    <strong style="color:var(--text-primary); font-size:0.82rem; white-space:nowrap;">${c.application_no}</strong>
                    <div style="font-size:0.70rem; color:var(--text-muted); margin-top:1px; display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                        <span style="white-space:nowrap;"><i class="fa-solid fa-location-dot" style="font-size:0.65rem; color:var(--primary);"></i> ${c.campus_name || ''}</span>
                        ${c.category ? `<span class="badge" style="font-size:0.60rem; padding:1px 4px; background:rgba(255,255,255,0.06); border:1px solid var(--glass-border); line-height:1.2;">${c.category}</span>` : ''}
                    </div>
                </td>
                <td style="overflow:hidden;">
                    <div style="font-weight:600; color:var(--text-primary); font-size:0.82rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${c.registered_name}">${c.registered_name}</div>
                    <div style="font-size:0.71rem; color:var(--text-muted); margin-top:2px;">
                        <a href="tel:${c.mobile}" style="color:var(--text-muted); text-decoration:none; white-space:nowrap; display:inline-flex; align-items:center; gap:3px;">
                            <i class="fa-solid fa-phone" style="color:var(--success); font-size:0.65rem;"></i> ${c.mobile || '—'}
                        </a>
                    </div>
                </td>
                <td style="font-size:0.76rem; color:var(--text-secondary); line-height:1.25; overflow:hidden;">
                    <span title="${c.mode_of_study || '—'}">${c.mode_of_study || '<span style="color:var(--text-muted)">—</span>'}</span>
                </td>
                ${isExternalEmploymentView() ? `<td>${pendingEscape(c.employment_position || 'Not provided')}</td><td>${pendingEscape(c.employment_organization || 'Not provided')}</td>` : ''}
                <td style="text-align:center;">
                    <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; max-width:100%; gap:4px;">${badge}</div>
                </td>
                <td style="text-align:center; white-space:nowrap; vertical-align:middle;">
                    <div>${c.total_marks !== null && c.total_marks !== undefined ? `<strong style="color:var(--text-primary); font-size:0.84rem;">${c.total_marks.toFixed(1)}</strong>` : '<span style="color:var(--text-muted); font-size:0.78rem;">—</span>'}</div>
                    ${editBtn ? `<div style="margin-top:2px;">${editBtn}</div>` : ''}
                </td>
                <td style="text-align:center; white-space:nowrap;">${c.rank ? `<span class="badge" style="background:rgba(59,130,246,0.15); color:#3b82f6; border:1px solid rgba(59,130,246,0.3); font-weight:bold; font-size:0.74rem;">#${c.rank}</span>` : '<span style="color:var(--text-muted); font-size:0.78rem;">—</span>'}</td>
                <td style="font-size:0.76rem; word-break:break-word; overflow:hidden;">${supervisorStr}${allocationReasonHtml}</td>
                <td style="text-align:center; vertical-align:middle;">
                    <div style="display:inline-flex; align-items:center; justify-content:center; gap:4px;">
                        ${viewBtn}
                        ${state.user.role === 'hod' ? renderHodPanelAction(c) : ''}
                        ${deleteBtn}
                    </div>
                </td>
                <td style="text-align:center; vertical-align:middle;">
                    ${workflowBtn || '<span style="color:var(--text-muted); font-size:0.75rem;">—</span>'}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="table-container candidate-table-wrapper" style="margin-bottom: 1.25rem; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--glass-border);">
            <table class="candidate-data-table">
                <thead>
                    <tr>
                        <th style="width:3.5%; text-align:center;">${selectAllCheckbox}</th>
                        <th style="width:3%; text-align:center;">S.No</th>
                        <th onclick="handleSort('application_no')" style="cursor: pointer; width:12%; text-align:left;">Application No. ${getSortIcon('application_no')}</th>
                        <th onclick="handleSort('registered_name')" style="cursor: pointer; width:14%; text-align:left;">Name & Contact ${getSortIcon('registered_name')}</th>
                        <th onclick="handleSort('mode_of_study')" style="cursor: pointer; width:9%; text-align:left;">Mode of Study ${getSortIcon('mode_of_study')}</th>
                        ${isExternalEmploymentView() ? '<th style="width:150px">Position / Designation</th><th style="width:180px">Company / Institution</th>' : ''}
                        <th onclick="handleSort('status')" style="cursor: pointer; width:13%; text-align:center;">Status ${getSortIcon('status')}</th>
                        <th onclick="handleSort('total_marks')" style="cursor: pointer; width:7.5%; text-align:center;">Score ${getSortIcon('total_marks')}</th>
                        <th onclick="handleSort('rank')" style="cursor: pointer; width:4.5%; text-align:center;">Rank ${getSortIcon('rank')}</th>
                        <th onclick="handleSort('supervisor_name')" style="cursor: pointer; width:12%; text-align:left;">Supervisor ${getSortIcon('supervisor_name')}</th>
                        <th style="width:8%; text-align:center;">View / Delete</th>
                        <th style="width:12.5%; text-align:center;">Workflow</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

function renderHodSupervisorsTable() {
    const mainContent = document.getElementById('main-content');
    const list = state.hodSupervisors || [];

    const totalCount = list.length;
    const eligibleCount = list.filter(s => s.is_eligible === 'Yes').length;
    const ineligibleCount = totalCount - eligibleCount;
    
    // Calculate total vacancies in the department (for eligible supervisors)
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

    const deptName = state.user.name.replace('HOD of ', '');
    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;"><i class="fa-solid fa-user-tie"></i> Supervisors Directory — ${deptName}</h2>
        
        <div class="dashboard-grid" style="margin-bottom: 2rem; grid-template-columns: repeat(4, 1fr);">
            <div class="card">
                <div class="card-title">Total Supervisors <i class="fa-solid fa-user-tie" style="color: var(--primary)"></i></div>
                <div class="card-value">${totalCount}</div>
                <div class="card-trend">In your department</div>
            </div>
            <div class="card" style="border-left: 4px solid var(--success);">
                <div class="card-title">Eligible <i class="fa-solid fa-circle-check" style="color: var(--success)"></i></div>
                <div class="card-value">${eligibleCount}</div>
                <div class="card-trend">${ineligibleCount} not eligible / no vacancy</div>
            </div>
            <div class="card" style="border-left: 4px solid var(--info);">
                <div class="card-title">Session Open Vacancies <i class="fa-solid fa-door-open" style="color: var(--info)"></i></div>
                <div class="card-value">${totalSessionVacancies}</div>
                <div class="card-trend">Max 2 per guide | ${totalOverallVacancies} overall</div>
            </div>
            <div class="card" style="border-left: 4px solid var(--warning);">
                <div class="card-title">Allocated (Session) <i class="fa-solid fa-user-check" style="color: var(--warning)"></i></div>
                <div class="card-value">${totalAllocated}</div>
                <div class="card-trend">Candidates assigned so far</div>
            </div>
        </div>

        <div class="card animate-fade-in">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.2rem;">
                <h3 style="margin:0;"><i class="fa-solid fa-list"></i> Department Supervisors List</h3>
                <input type="text" id="supervisor-search" class="form-control" placeholder="Search by name or area..." 
                    style="max-width:280px; padding:6px 12px;" oninput="filterSupervisorRows(this.value)">
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:1rem;">
                <strong>Session Vacancy</strong>: Remaining new PhD slots allowed this session (max 2). 
                <strong>Total Vacancy</strong>: Remaining lifetime PhD slots allowed (per Excel upload).
            </div>
            <div class="table-container">
                <table id="hod-supervisors-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Supervisor Name</th>
                            <th>Faculty ID</th>
                            <th>Designation</th>
                            <th>Area of Research</th>
                            <th style="text-align: center;">Eligibility</th>
                            <th style="text-align: center;">Maximum Students Allowed (N)</th>
                            <th style="text-align: center;">Currently Guiding (C)</th>
                            <th style="text-align: center;">Completed</th>
                            <th style="text-align: center;">Session Vacancy</th>
                            <th style="text-align: center;">Available Vacancy (N-C)</th>
                        </tr>
                    </thead>
                    <tbody id="supervisor-tbody">
                        ${list.length === 0 ? `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding: 2rem;">No supervisors directory uploaded for your department yet.</td></tr>` : list.map((s, idx) => {
                            const sessionLimit = Math.min(2, Math.max(0, s.max_students - (s.current_guiding || 0)));
                            const sessionAvail = s.is_eligible === 'Yes' ? Math.max(0, sessionLimit - (s.allocated_count || 0)) : 0;
                            const totalAvail = s.is_eligible === 'Yes' ? Math.max(0, s.max_students - ((s.current_guiding || 0) + (s.allocated_count || 0))) : 0;
                            
                            const sessionStr = s.is_eligible === 'Yes' ? `${sessionAvail} / ${sessionLimit}` : '—';
                            
                            let statusBadge;
                            let rowClass = '';
                            if (s.is_eligible === 'Yes') {
                                statusBadge = `<span class="badge badge-success">Eligible</span>`;
                                if (sessionAvail === 0 || totalAvail === 0) rowClass = 'style="opacity:0.65;"';
                            } else if ((s.is_eligible || '').toLowerCase().includes('retiring')) {
                                statusBadge = `<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);">Retiring Soon</span>`;
                                rowClass = 'style="opacity:0.55;"';
                            } else if ((s.is_eligible || '').toLowerCase().includes('no vacancy')) {
                                statusBadge = `<span class="badge badge-danger">No Vacancy</span>`;
                                rowClass = 'style="opacity:0.55;"';
                            } else {
                                statusBadge = `<span class="badge badge-danger">${s.is_eligible || 'Ineligible'}</span>`;
                                rowClass = 'style="opacity:0.55;"';
                            }
                            return `
                            <tr class="supervisor-row" data-name="${(s.name || '').toLowerCase()}" data-area="${(s.area_of_research || '').toLowerCase()}" ${rowClass}>
                                <td>${idx + 1}</td>
                                <td><strong>${s.name}</strong></td>
                                <td style="font-size:0.82rem;">${s.faculty_id || '-'}</td>
                                <td>${s.designation || '-'}</td>
                                <td style="max-width: 200px; font-size: 0.82rem; color:var(--text-secondary);">${s.area_of_research || '-'}</td>
                                <td style="text-align: center;">${statusBadge}</td>
                                <td style="text-align: center;">${s.max_students !== undefined ? s.max_students : '-'}</td>
                                <td style="text-align: center;">${(s.current_guiding || 0) + (s.allocated_count || 0)}</td>
                                <td style="text-align: center;">${s.completed_students}</td>
                                <td style="text-align: center; font-weight: bold; color: ${sessionAvail > 0 ? 'var(--success)' : 'var(--danger)'};">${sessionStr}</td>
                                <td style="text-align: center; font-weight: bold; color: ${totalAvail > 0 ? 'var(--info)' : 'var(--danger)'};">${totalAvail}</td>
                            </tr>
                        `}).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Start Client SPA
function filterSupervisorRows(query) {
    const q = (query || '').toLowerCase().trim();
    const rows = document.querySelectorAll('#supervisor-tbody .supervisor-row');
    rows.forEach(row => {
        const name = row.getAttribute('data-name') || '';
        const area = row.getAttribute('data-area') || '';
        row.style.display = (!q || name.includes(q) || area.includes(q)) ? '' : 'none';
    });
}
window.filterSupervisorRows = filterSupervisorRows;

// =====================================================================
//  DOWNLOAD: EXCEL & PDF EXPORT FUNCTIONS
// =====================================================================


/** Returns the currently filtered candidate list (same logic as renderCandidatesTable) */
function getFilteredCandidateList(ignoreDept = false, allInstitutes = false) {
    let list = state.candidates || [];
    if (state.user.role === 'hod') {
        list = list.filter(c => {
            if (state.user.department_id) return c.department_id === state.user.department_id;
            return true;
        });
    } else {
        if (!allInstitutes && state.activeCandidateInst) {
            list = list.filter(c => c.institution_id === state.activeCandidateInst);
        }
    }

    if (!ignoreDept && state.user.role !== 'hod' && state.activeCandidateDept && state.activeCandidateDept !== 'All') {
        list = list.filter(c => (c.department_name || 'Unassigned / Pending Mapping') === state.activeCandidateDept);
    }

    list = list.filter(candidateMatchesStudyMode);
    if (allInstitutes) list = list.filter(c => Number(c.campus_id) === Number(state.user.role === 'super_admin' ? state.activeCandidateCampus : state.user.campus_id));
    const f = state.activeCandidateFilter;
    if (f && f !== 'All') {
        if (f === 'Needs My Action')             list = list.filter(c => candidateNeedsMyAction(c));
        else if (f === 'Complete Applications')   list = list.filter(c => isCandidateComplete(c));
        else if (f === 'Incomplete Applications') list = list.filter(c => (c.form_status || '').toLowerCase() === 'incomplete');
        else if (f === 'Selected')                list = list.filter(c => c.selection_status === 'Selected');
        else if (f === 'Not Selected')            list = list.filter(c => c.selection_status === 'Not Selected');
        else if (f === 'Eligible')                list = list.filter(c => isCandidateEligible(c) && !isCandidateRanked(c));
        else if (f === 'Not Eligible')            list = list.filter(c => isCandidateIneligible(c));
        else if (f === 'Ranked')                  list = list.filter(c => isCandidateRanked(c));
        else                                      list = list.filter(c => c.status === f);
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

    return sortCandidatesList(list);
}

/** Convert a candidate object into a flat export row */
function buildExportRow(c, idx) {
    return {
        'S.No':                 idx,
        'Application No':       c.application_no || '',
        'Name':                 c.registered_name || '',
        'Department':           c.department_name || '',
        'Campus':               c.campus_name || '',
        'Mode of Study':        c.mode_of_study || '',
        'Position / Designation': c.employment_position || '',
        'Company / Institution': c.employment_organization || '',
        'Category':             c.category || '',
        'Status':               c.status || '',
        'Rank':                 c.rank || '',
        'Total Marks (100)':    c.total_marks != null ? c.total_marks.toFixed(1) : '',
        'Written Marks (50)':   c.written_marks != null ? Number(c.written_marks).toFixed(1) : '',
        'Interview Mark 1':     c.interview_marks_1 || '',
        'Interview Mark 2':     c.interview_marks_2 || '',
        'Interview Mark 3':     c.interview_marks_3 || '',
        'Supervisor':           c.supervisor_name || '',
        'Supervisor Desg':      c.supervisor_designation || '',
        'Supervisor Affil.':    c.supervisor_affiliation || '',
        'Selection Status':     c.selection_status || '',
        'Email':                c.email || '',
        'Mobile':               c.mobile || '',
    };
}

// ──────────────────────────────────────────────────────────────────────
//  EXCEL DOWNLOAD — Full filtered list (all departments, multi-sheet)
// ──────────────────────────────────────────────────────────────────────
function downloadCandidatesExcel() {
    const list = getFilteredCandidateList();
    if (!list.length) { showToast('No data to export.', 'error'); return; }

    const wb = XLSX.utils.book_new();
    const filterLabel = (state.activeCandidateFilter || 'All') + ' - ' + studyModeFilterLabel();

    // Group by department
    const deptGroups = {};
    list.forEach(c => { const d = c.department_name || 'Unknown'; (deptGroups[d] = deptGroups[d] || []).push(c); });

    // One sheet per department, with mode-wise sections separated by blank row
    Object.keys(deptGroups).sort().forEach(deptName => {
        const deptList = deptGroups[deptName];
        const allRows = [];

        STUDY_MODES.forEach(mode => {
            const modeList = deptList.filter(c => mode.match(c.mode_of_study || '',c));
            if (!modeList.length) return;
            // Header row for this mode block
            allRows.push({ 'S.No': `── ${mode.label} ──`, 'Application No': '', 'Name': '', 'Department': '', 'Campus': '',
                'Mode of Study': '', 'Category': '', 'Status': '', 'Rank': '', 'Total Marks (100)': '',
                'Written Marks (50)': '', 'Interview Mark 1': '', 'Interview Mark 2': '', 'Interview Mark 3': '',
                'Supervisor': '', 'Supervisor Desg': '', 'Supervisor Affil.': '', 'Selection Status': '', 'Email': '', 'Mobile': '' });
            modeList.forEach((c, i) => allRows.push(buildExportRow(c, i + 1)));
            allRows.push({}); // blank separator
        });

        // Sanitise sheet name (max 31 chars, no special chars)
        const sheetName = deptName.replace(/[:\\/\[\]*?]/g, '').substring(0, 31);
        const ws = XLSX.utils.json_to_sheet(allRows);

        // Auto column widths
        const cols = Object.keys(buildExportRow({}, 0));
        ws['!cols'] = cols.map(k => ({ wch: Math.max(k.length, 14) }));
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // Summary sheet
    const summaryRows = list.map((c, i) => buildExportRow(c, i + 1));
    const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'ALL CANDIDATES');

    const fname = `PhD_Candidates_${filterLabel.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    showToast(`Exported ${list.length} candidates to Excel.`);
}

// ──────────────────────────────────────────────────────────────────────
//  EXCEL DOWNLOAD — Single department
// ──────────────────────────────────────────────────────────────────────
function downloadDeptExcel(instName, deptName) {
    const list = getFilteredCandidateList(true).filter(c => c.institution_name === instName && (c.department_name || 'Unassigned / Pending Mapping') === deptName);
    if (!list.length) { showToast('No data for this department.', 'error'); return; }

    const wb = XLSX.utils.book_new();

    STUDY_MODES.forEach(mode => {
        const modeList = list.filter(c => mode.match(c.mode_of_study || '',c));
        if (!modeList.length) return;
        const rows = modeList.map((c, i) => buildExportRow(c, i + 1));
        const ws = XLSX.utils.json_to_sheet(rows);
        const sheetName = mode.label.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    if (wb.SheetNames.length === 0) { showToast('No data to export.', 'error'); return; }
    const fname = `PhD_${instName.replace(/\s+/g,'_')}_${deptName.replace(/\s+/g,'_')}_${state.activeCandidateFilter || 'All'}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    showToast(`Exported ${list.length} candidates for ${deptName} (${instName}).`);
}
window.downloadDeptExcel = downloadDeptExcel;

// ──────────────────────────────────────────────────────────────────────
//  PDF HELPER: generate print-ready HTML
// ──────────────────────────────────────────────────────────────────────
function buildPdfTableHtml(candidates, title, subtitle) {
    const rows = candidates.map((c, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${c.application_no || ''}</strong></td>
            <td>${c.registered_name || ''}</td>
            ${isExternalEmploymentView() ? `<td>${pendingEscape(c.employment_position || 'Not provided')}</td><td>${pendingEscape(c.employment_organization || 'Not provided')}</td>` : ''}
            <td>${c.category || ''}</td>
            <td>${c.campus_name || ''}</td>
            <td>${c.status || ''}</td>
            <td style="text-align:center;">${c.rank || '-'}</td>
            <td style="text-align:center;">${c.total_marks != null ? Number(c.total_marks).toFixed(1) : '-'}</td>
            <td>${c.supervisor_name || '-'}</td>
            <td>${c.selection_status || ''}</td>
        </tr>`).join('');

    return `
        <div class="section">
            <h3>${subtitle}</h3>
            ${candidates.length === 0
                ? '<p class="empty">No candidates in this category.</p>'
                : `<table>
                    <thead><tr>
                        <th>#</th><th>App No</th><th>Name</th>${isExternalEmploymentView() ? '<th>Position / Designation</th><th>Company / Institution</th>' : ''}<th>Category</th><th>Campus</th>
                        <th>Status</th><th>Rank</th><th>Score</th><th>Supervisor</th><th>Selection</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                   </table>`}
        </div>`;
}

function openPdfWindow(htmlBody, title, orientation = 'portrait') {
    const win = window.open('', '_blank');
    if (!win) { showToast('Popup blocked. Please allow popups for this site.', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: "Times New Roman", Times, serif !important; }
            body, h1, h2, h3, h4, th, td, p, strong, div, span, table { font-size: 12px !important; }
            .omr-circle { font-size: 7px !important; }
            .small-text, .small-text * { font-size: 10px !important; }
            .meta { text-align: center; color: #333; margin-bottom: 10px; }
            .section { margin-bottom: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 8px; }
            th { border: 1px solid #111; padding: 5px; background: #f2f2f2; color: #000; font-weight: bold; text-align: center; }
            td { border: 1px solid #111; padding: 5px; vertical-align: middle; }
            tr:nth-child(even) { background: #fff; }
            .empty { color: #666; font-style: italic; padding: 4px 0; }
            
            /* CSS page setups for A4 printing */
            @page {
                size: A4 ${orientation};
                margin: 10mm;
            }
            
            @media print {
                .no-print { display: none !important; }
                body { margin: 0 !important; padding: 0 !important; background: #fff; }
                .print-page {
                    border: none !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                    width: 100% !important;
                    page-break-after: always;
                    page-break-inside: avoid;
                }
            }
            
            .print-btn { position: fixed; top: 12px; right: 12px; background: #1a56db; color: white; border: none;
                padding: 8px 16px; border-radius: 6px; cursor: pointer; z-index: 999; }
        </style>
    </head><body>
        <button class="print-btn no-print" onclick="window.print()">🖨 Print / Save PDF</button>
        ${htmlBody}
    </body></html>`);
    win.document.close();
}

// ──────────────────────────────────────────────────────────────────────
//  PDF DOWNLOAD — Full filtered list (all departments)
// ──────────────────────────────────────────────────────────────────────
function downloadCandidatesPDF() {
    const list = getFilteredCandidateList();
    if (!list.length) { showToast('No data to export.', 'error'); return; }

    const filterLabel = state.activeCandidateFilter || 'All';
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    // Group by department
    const deptGroups = {};
    list.forEach(c => { const d = c.department_name || 'Unknown'; (deptGroups[d] = deptGroups[d] || []).push(c); });

    let body = `
        <h1>SRMIST — PhD Admissions July 2026</h1>
        <p class="meta">Filter: <strong>${filterLabel}</strong> &nbsp;|&nbsp; Total: <strong>${list.length}</strong> candidates &nbsp;|&nbsp; Generated: ${today}</p>
    `;

    Object.keys(deptGroups).sort().forEach(deptName => {
        const deptList = deptGroups[deptName];
        body += `<div class="dept-block"><h2>Department of ${deptName} (${deptList.length} candidates)</h2>`;
        STUDY_MODES.forEach(mode => {
            const modeList = deptList.filter(c => mode.match(c.mode_of_study || '',c));
            body += buildPdfTableHtml(modeList, deptName, mode.label);
        });
        body += `</div>`;
    });

    openPdfWindow(body, `PhD_${filterLabel}_${today}`);
    showToast('PDF opened in new tab — use Print / Save PDF.');
}

// ──────────────────────────────────────────────────────────────────────
//  PDF DOWNLOAD — Single department
// ──────────────────────────────────────────────────────────────────────
function downloadDeptPDF(instName, deptName) {
    const list = getFilteredCandidateList(true).filter(c => c.institution_name === instName && (c.department_name || 'Unassigned / Pending Mapping') === deptName);
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    let body = `
        <h1>SRMIST — PhD Admissions July 2026</h1>
        <p class="meta">Institution: <strong>${instName}</strong> &nbsp;|&nbsp; Department: <strong>${deptName}</strong> &nbsp;|&nbsp; Filter: <strong>${state.activeCandidateFilter || 'All'}</strong> &nbsp;|&nbsp; ${list.length} candidates &nbsp;|&nbsp; ${today}</p>
        <div class="dept-block">
    `;
    STUDY_MODES.forEach(mode => {
        const modeList = list.filter(c => mode.match(c.mode_of_study || '',c));
        body += buildPdfTableHtml(modeList, deptName, mode.label);
    });
    body += `</div>`;

    openPdfWindow(body, `PhD_${instName.replace(/\s+/g,'_')}_${deptName.replace(/\s+/g,'_')}_${today}`);
    showToast('PDF opened in new tab — use Print / Save PDF.');
}
window.downloadDeptPDF = downloadDeptPDF;

// ──────────────────────────────────────────────────────────────────────
//  ZIP DOWNLOAD — ZIP of candidate certificates/documents
// ──────────────────────────────────────────────────────────────────────
async function downloadCandidatesDocsZip(candidatesList, zipName) {
    if (!candidatesList || candidatesList.length === 0) {
        showToast('No candidates found to download documents.', 'error');
        return;
    }
    
    try {
        showToast('Preparing ZIP archive of candidate documents...', 'info');
        const headers = {
            'Content-Type': 'application/json'
        };
        if (state.token) {
            headers['Authorization'] = `Bearer ${state.token}`;
        }
        
        const response = await fetch('/api/candidates/download-documents-zip', {
            method: 'POST',
            headers,
            body: JSON.stringify({ candidateIds: candidatesList.map(c => c.id) })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `HTTP error! status: ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName || 'PhD_Candidate_Documents.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('Documents ZIP downloaded successfully.');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to download documents ZIP archive.', 'error');
    }
}
window.downloadCandidatesDocsZip = downloadCandidatesDocsZip;

// Register global download functions
window.downloadCandidatesExcel = downloadCandidatesExcel;
window.downloadCandidatesPDF   = downloadCandidatesPDF;

// ──────────────────────────────────────────────────────────────────────
//  MINUTES OF MEETING DOWNLOAD (authenticated fetch → Blob)
// ──────────────────────────────────────────────────────────────────────
// Helper functions for dynamic DRCC members modal
function addDrccMemberRow(name = '', designation = '', affiliation = '') {
    const tbody = document.getElementById('drcc-members-tbody');
    if (!tbody) return;
    const rowCount = tbody.children.length;
    const tr = document.createElement('tr');
    tr.className = 'drcc-member-row';
    tr.innerHTML = `
        <td class="row-num" style="text-align: center; vertical-align: middle; padding: 8px;">${rowCount + 1}</td>
        <td style="padding: 8px;"><input type="text" class="form-control member-name" value="${name}" placeholder="e.g. Dr. A. Smith" required style="padding: 6px 10px; font-size: 0.85rem; width: 100%;"></td>
        <td style="padding: 8px;"><input type="text" class="form-control member-designation" value="${designation}" placeholder="e.g. Professor" required style="padding: 6px 10px; font-size: 0.85rem; width: 100%;"></td>
        <td style="padding: 8px;"><input type="text" class="form-control member-affiliation" value="${affiliation}" placeholder="e.g. SRMIST" required style="padding: 6px 10px; font-size: 0.85rem; width: 100%;"></td>
        <td style="text-align: center; vertical-align: middle; padding: 8px;">
            <button class="btn btn-danger" onclick="removeDrccMemberRow(this)" style="padding: 6px 10px; font-size: 0.8rem;"><i class="fa-solid fa-trash"></i></button>
        </td>
    `;
    tbody.appendChild(tr);
}

function removeDrccMemberRow(btn) {
    const tbody = document.getElementById('drcc-members-tbody');
    if (!tbody) return;
    btn.closest('tr').remove();
    // Re-index row numbers
    const rows = tbody.querySelectorAll('.drcc-member-row');
    rows.forEach((row, idx) => {
        row.querySelector('.row-num').textContent = idx + 1;
    });
}

async function submitDownloadMinutes(btn) {
    const tbody = document.getElementById('drcc-members-tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('.drcc-member-row');
    const drcc_members = [];
    
    for (let i = 0; i < rows.length; i++) {
        const name = rows[i].querySelector('.member-name').value.trim();
        const designation = rows[i].querySelector('.member-designation').value.trim();
        const affiliation = rows[i].querySelector('.member-affiliation').value.trim();
        
        if (!name || !designation || !affiliation) {
            showToast('All fields are required for each member.', 'error');
            return;
        }
        drcc_members.push({ name, designation, affiliation });
    }
    
    // Close modal
    btn.closest('.modal-overlay').remove();
    
    try {
        showToast('Generating Minutes of Meeting…');
        const response = await fetch('/api/hod/download-minutes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ drcc_members })
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server error: ${response.status}`);
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        a.download = match ? match[1] : `Minutes_of_Meeting_${new Date().toISOString().slice(0,10)}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('Minutes of Meeting downloaded successfully.');
    } catch (err) {
        showToast(err.message || 'Failed to download minutes', 'error');
    }
}

// ──────────────────────────────────────────────────────────────────────
//  RESEARCH OFFICE: REASSIGN CANDIDATE
// ──────────────────────────────────────────────────────────────────────
function openReassignModal(candidateId) {
    const c = state.candidates.find(cand => cand.id === candidateId);
    if (!c) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    // Build Institute Dropdown
    let instOptions = '<option value="">Select Institution</option>';
    if (state.metadata && state.metadata.institutions) {
        // filter by campus of the candidate
        const insts = state.metadata.institutions.filter(i => i.campus_id === c.campus_id && i.id !== 100 && i.id !== 101);

        instOptions += insts.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    }

    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-map-location-dot" style="color: var(--primary);"></i> Re-route Candidate</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <form onsubmit="submitReassignCandidate(event, ${candidateId})" style="padding: 1.5rem;">
                <p style="margin-bottom: 1rem; color: var(--text-muted); font-size: 0.9rem;">
                    Re-route <strong>${c.registered_name}</strong> to the correct institution and department. They will be transferred to the respective department's incomplete menu.
                </p>
                <div class="form-group">
                    <label>Target Institution</label>
                    <select id="reassign-inst" class="form-control" required onchange="populateReassignDepts(this.value)">
                        ${instOptions}
                    </select>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <label>Target Department</label>
                    <select id="reassign-dept" class="form-control" required>
                        <option value="">Select Department</option>
                    </select>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 1.5rem;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i> Transfer Candidate</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
}
window.openReassignModal = openReassignModal;

function populateReassignDepts(instId) {
    const deptSelect = document.getElementById('reassign-dept');
    deptSelect.innerHTML = '<option value="">Select Department</option>';
    if (!instId || !state.metadata || !state.metadata.departments) return;
    
    const depts = state.metadata.departments.filter(d => d.institution_id == instId);
    deptSelect.innerHTML += depts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
}
window.populateReassignDepts = populateReassignDepts;

async function submitReassignCandidate(event, candidateId) {
    event.preventDefault();
    const instId = document.getElementById('reassign-inst').value;
    const deptId = document.getElementById('reassign-dept').value;
    
    if (!instId || !deptId) {
        showToast('Please select both Institution and Department', 'error');
        return;
    }
    
    try {
        await api('/api/research-office/reassign-candidate', 'POST', {
            candidateId,
            institutionId: instId,
            departmentId: deptId
        });
        showToast('Candidate successfully re-routed and transferred to incomplete menu.');
        event.target.closest('.modal-overlay').remove();
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.submitReassignCandidate = submitReassignCandidate;

async function downloadMinutes() {
    try {
        showToast('Fetching DRCC defaults...', 'info');
        const response = await fetch('/api/hod/drcc-defaults', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server error: ${response.status}`);
        }
        const data = await response.json();
        
        // Open the modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content animate-fade-in-up" style="max-width: 650px;">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-users-gear" style="color: var(--primary); margin-right: 8px;"></i>Configure DRCC Members</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem;">
                        Specify the DRCC members to include in the generated minutes. You can modify names, designations, affiliations, or add/remove rows.
                    </p>
                    <p role="note" style="font-size: 0.85rem; line-height: 1.5; padding: 12px 14px; margin-bottom: 1rem; border-radius: 8px; background: #fff2cc; color: #503d00;">
                        <strong>Update the example before submission.</strong> In the downloaded minutes, Mathematics and its topics under &ldquo;Test Structure and Content&rdquo; are examples only. Replace them with your department's actual written-test subject areas and remove the example instruction before submitting.
                    </p>
                    <div class="table-container" style="max-height: 300px; overflow-y: auto; margin-bottom: 1.2rem; border: 1px solid var(--glass-border); border-radius: 6px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: var(--bg-secondary);">
                                    <th style="width: 50px; text-align: center; padding: 10px;">#</th>
                                    <th style="padding: 10px; text-align: left;">Name</th>
                                    <th style="padding: 10px; text-align: left;">Designation</th>
                                    <th style="padding: 10px; text-align: left;">Affiliation</th>
                                    <th style="width: 60px; text-align: center; padding: 10px;">Action</th>
                                </tr>
                            </thead>
                            <tbody id="drcc-members-tbody">
                            </tbody>
                        </table>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="btn btn-secondary" onclick="addDrccMemberRow()"><i class="fa-solid fa-plus"></i> Add Member</button>
                        <div style="display: flex; gap: 12px;">
                            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                            <button type="button" class="btn btn-primary" onclick="submitDownloadMinutes(this)"><i class="fa-solid fa-file-word"></i> Generate & Download</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Add default rows
        const defaults = data.drcc_members || [];
        defaults.forEach(m => {
            addDrccMemberRow(m.name, m.designation, m.affiliation);
        });
        
    } catch (err) {
        showToast(err.message || 'Failed to fetch defaults', 'error');
    }
}

window.addDrccMemberRow = addDrccMemberRow;
window.removeDrccMemberRow = removeDrccMemberRow;
window.submitDownloadMinutes = submitDownloadMinutes;
window.downloadMinutes = downloadMinutes;

async function clearAllUploadedData() {
    const confirmation = prompt('WARNING: This will permanently delete all candidate profiles, test marks, ranking lists, and uploaded document files for this campus.\n\nTo confirm this action, please type "DELETE" below:');
    
    if (confirmation !== 'DELETE') {
        showToast('Action cancelled. Confirmation mismatch.', 'error');
        return;
    }

    try {
        showToast('Clearing database and deleting files...', 'info');
        const res = await api('/api/admin/clear-data', 'POST');
        showToast(res.message);
        
        // Reset local state candidate-related arrays
        state.candidates = [];
        
        // Re-render dashboard/table views
        renderApp();
        loadTabSpecificData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.clearAllUploadedData = clearAllUploadedData;

async function deleteSupervisor(id) {
    if (!confirm('Are you sure you want to delete this supervisor from the directory?')) return;

    try {
        const res = await api(`/api/coordinator/supervisors/${id}`, 'DELETE');
        showToast(res.message);
        loadSupervisorsDirectory();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.deleteSupervisor = deleteSupervisor;

async function clearAllSupervisors() {
    const confirmation = prompt('WARNING: This will permanently delete all supervisor details for your campus/faculty.\n\nTo confirm, please type "DELETE" below:');
    if (confirmation !== 'DELETE') {
        showToast('Action cancelled.', 'error');
        return;
    }

    try {
        showToast('Clearing supervisor directory...', 'info');
        const res = await api('/api/coordinator/clear-supervisors', 'POST');
        showToast(res.message);
        loadSupervisorsDirectory();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.clearAllSupervisors = clearAllSupervisors;

function sortSupervisorsList(list) {
    const sorted = [...list];
    const col = state.supervisorSortColumn;
    const order = state.supervisorSortOrder;
    
    if (col) {
        sorted.sort((a, b) => {
            let valA = a[col];
            let valB = b[col];
            
            // Treat null/undefined values consistently (put at the end)
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            
            // For vacancy remaining
            if (col === 'vacancy_remaining') {
                valA = (a.vacancy || 0) - (a.allocated_count || 0);
                valB = (b.vacancy || 0) - (b.allocated_count || 0);
            }
            
            // For session vacancy remaining
            if (col === 'session_vacancy') {
                valA = Math.max(0, Math.min(2, a.vacancy || 0) - (a.allocated_count || 0));
                valB = Math.max(0, Math.min(2, b.vacancy || 0) - (b.allocated_count || 0));
            }
            
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
    }
    return sorted;
}

function handleSupervisorSort(col) {
    if (state.supervisorSortColumn === col) {
        state.supervisorSortOrder = state.supervisorSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        state.supervisorSortColumn = col;
        state.supervisorSortOrder = 'asc';
    }
    renderSupervisorsTableBody();
}
window.handleSupervisorSort = handleSupervisorSort;

function getSupervisorSortIcon(col) {
    if (state.supervisorSortColumn === col) {
        return state.supervisorSortOrder === 'asc' 
            ? ' <i class="fa-solid fa-arrow-up-a-z" style="color: var(--primary); margin-left: 4px;"></i>' 
            : ' <i class="fa-solid fa-arrow-down-z-a" style="color: var(--primary); margin-left: 4px;"></i>';
    }
    return ' <i class="fa-solid fa-sort" style="color: var(--text-muted); opacity: 0.5; margin-left: 4px;"></i>';
}
window.getSupervisorSortIcon = getSupervisorSortIcon;

// Contact / Send Message Modal
async function openContactModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    // Fetch recipients first
    let recipients = [];
    try {
        const res = await api('/api/contact/recipients');
        recipients = res.recipients || [];
    } catch (e) {
        showToast('Failed to load recipients.', 'error');
        return;
    }

    if (recipients.length === 0) {
        showToast('You have no contacts available to message.', 'error');
        return;
    }

    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-envelope" style="color: var(--primary); margin-right: 8px;"></i>Send Message</h3>
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()" style="padding: 4px 8px;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <form id="contact-message-form" style="padding: 1rem;">
                <div class="form-group">
                    <label>To:</label>
                    <select id="contact-recipient" class="form-control" required style="width: 100%;">
                        <option value="">Select Recipient...</option>
                        ${recipients.map(r => `<option value="${r.id}">${r.name} (${r.role.replace('_', ' ').toUpperCase()})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Subject:</label>
                    <input type="text" id="contact-subject" class="form-control" placeholder="Enter subject..." required style="width: 100%;">
                </div>
                <div class="form-group">
                    <label>Message:</label>
                    <textarea id="contact-body" class="form-control" rows="6" placeholder="Type your message here..." required style="width: 100%;"></textarea>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 1rem;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="contact-send-btn">
                        <i class="fa-solid fa-paper-plane"></i> Send Message
                    </button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('contact-message-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('contact-send-btn');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
        btn.disabled = true;

        try {
            await api('/api/contact/send', 'POST', {
                recipient_id: document.getElementById('contact-recipient').value,
                subject: document.getElementById('contact-subject').value,
                message: document.getElementById('contact-body').value
            });
            showToast('Message sent successfully!', 'success');
            modal.remove();
        } catch (err) {
            showToast(err.message, 'error');
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });
}
window.openContactModal = openContactModal;
window.renderMiniRankTable = renderMiniRankTable;

async function executeSingleAction(endpoint, candidateId, successMsg) {
    try {
        await api(endpoint, 'POST', { candidateIds: [candidateId], campus_id:state.activeCandidateCampus });
        showToast(successMsg || 'Action completed successfully.');
        if (typeof loadTabSpecificData === 'function') loadTabSpecificData();
        else if (typeof renderCandidatesTable === 'function') renderCandidatesTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.executeSingleAction = executeSingleAction;

async function executeSingleReturn(endpoint, candidateId, remark, successMsg) {
    try {
        await api(endpoint, 'POST', { candidateIds: [candidateId], remark });
        showToast(successMsg || 'Returned successfully with query.');
        if (typeof loadTabSpecificData === 'function') loadTabSpecificData();
        else if (typeof renderCandidatesTable === 'function') renderCandidatesTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.executeSingleReturn = executeSingleReturn;
