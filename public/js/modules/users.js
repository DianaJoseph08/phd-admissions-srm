// --- PASSWORD CHANGE AND USER MANAGEMENT VIEWS ---

function showChangePasswordModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 450px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-shield-halved" style="color: var(--primary); margin-right: 8px;"></i>Change Password</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="change-password-form">
                    <div class="form-group">
                        <label for="current-password">Current Password</label>
                        <input type="password" id="current-password" class="form-control" placeholder="Enter current password" required autocomplete="current-password">
                    </div>
                    <div class="form-group">
                        <label for="new-password">New Password</label>
                        <input type="password" id="new-password" class="form-control" placeholder="Enter new password" required autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label for="confirm-password">Confirm New Password</label>
                        <input type="password" id="confirm-password" class="form-control" placeholder="Confirm new password" required autocomplete="new-password">
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 1.5rem;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Update Password</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector('#change-password-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = modal.querySelector('#current-password').value;
        const newPassword = modal.querySelector('#new-password').value;
        const confirmPassword = modal.querySelector('#confirm-password').value;

        if (newPassword !== confirmPassword) {
            showToast('New passwords do not match', 'error');
            return;
        }

        try {
            const res = await api('/api/auth/change-password', 'POST', { currentPassword, newPassword });
            showToast(res.message || 'Password updated successfully!', 'success');
            modal.remove();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}
window.showChangePasswordModal = showChangePasswordModal;

async function showProfileModal() {
    let profile = state.user || {};
    try {
        const res = await api('/api/user/profile');
        if (res && res.profile) {
            profile = { ...state.user, ...res.profile };
            state.user = profile;
        }
    } catch (e) {
        console.warn('Could not fetch latest profile from server:', e);
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    const roleTitle = (profile.role || '').replace('_', ' ').toUpperCase();
    const campusTitle = profile.campus_name || (profile.campus_id === 1 ? 'Ramapuram Campus' : (profile.campus_id === 2 ? 'Trichy Campus' : 'Ramapuram & Trichy'));
    const deptTitle = profile.department_name ? `<div style="margin-bottom: 0.6rem;"><strong>Department:</strong> ${profile.department_name}</div>` : '';
    const instTitle = profile.institution_name ? `<div style="margin-bottom: 0.6rem;"><strong>Faculty/Institution:</strong> ${profile.institution_name}</div>` : '';

    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 520px; border-radius: 12px;">
            <div class="modal-header" style="border-bottom: 1px solid var(--glass-border); padding-bottom: 12px;">
                <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-address-card" style="color: var(--primary);"></i>
                    <span>My Profile & Registered Email</span>
                </h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body" style="padding-top: 1.2rem;">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 1.2rem; padding: 12px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: 8px;">
                    <div style="width: 50px; height: 50px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: bold;">
                        ${(profile.name || 'U').charAt(0)}
                    </div>
                    <div>
                        <h4 style="margin: 0 0 4px 0; font-size: 1.1rem; color: var(--text-primary);">${profile.name || 'User'}</h4>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <span class="badge badge-primary" style="font-size: 0.72rem; padding: 2px 8px;">${roleTitle}</span>
                            <span style="font-size: 0.8rem; color: var(--text-muted);">&bull; ${campusTitle}</span>
                        </div>
                    </div>
                </div>

                <div style="font-size: 0.88rem; background: var(--bg-tertiary); padding: 12px; border-radius: 8px; margin-bottom: 1.5rem; border: 1px solid var(--glass-border);">
                    <div style="margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center;">
                        <span><strong>Login Username:</strong></span>
                        <code style="background: rgba(0,0,0,0.06); padding: 2px 8px; border-radius: 4px; font-weight: bold; color: var(--primary);">${profile.username}</code>
                    </div>
                    ${deptTitle}
                    ${instTitle}
                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 6px; border-top: 1px dashed var(--glass-border); padding-top: 6px;">
                        <i class="fa-solid fa-circle-info"></i> Always use your unique <strong>Username</strong> to log in to your specific department.
                    </div>
                </div>

                <form id="profile-email-form">
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label for="profile-email-input" style="font-weight: 600; display: flex; justify-content: space-between;">
                            <span>Official Email ID</span>
                            <span style="font-size: 0.78rem; font-weight: normal; color: var(--primary);"><i class="fa-solid fa-pen"></i> Editable</span>
                        </label>
                        <div style="position: relative;">
                            <i class="fa-solid fa-envelope" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted);"></i>
                            <input type="email" id="profile-email-input" class="form-control" style="padding-left: 36px; font-size: 0.95rem; font-weight: 500;" value="${profile.email || ''}" required placeholder="e.g. hod.dept@srmist.edu.in">
                        </div>
                        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 5px;">
                            Departmental candidate queries, portal notices, and workflow notifications will be delivered to this email.
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 1.5rem; border-top: 1px solid var(--glass-border); padding-top: 12px;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
                        <button type="submit" class="btn btn-primary" id="save-profile-email-btn" style="display: inline-flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-check"></i> Save Email Address
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector('#profile-email-form');
    const input = modal.querySelector('#profile-email-input');
    const saveBtn = modal.querySelector('#save-profile-email-btn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmail = input.value.trim();
        if (!newEmail) {
            showToast('Please enter an email address', 'error');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
            const res = await api('/api/user/email', 'PUT', { email: newEmail });
            showToast(res.message || 'Email address updated successfully!', 'success');
            state.user.email = res.email || newEmail;

            // Update in-place elements
            const dashEmailEl = document.getElementById('hod-dashboard-email');
            if (dashEmailEl) {
                dashEmailEl.textContent = res.email || newEmail;
            }

            modal.remove();
        } catch (err) {
            showToast(err.message || 'Failed to update email', 'error');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save Email Address';
        }
    });
}
window.showProfileModal = showProfileModal;

function switchCandidateCampusTab(campusId) {
    state.activeCandidateCampus = campusId;
    if (state.metadata && state.metadata.institutions) {
        const campusInsts = state.metadata.institutions.filter(inst => inst.campus_id === campusId);
        if (campusInsts.length > 0) {
            state.activeCandidateInst = campusInsts[0].id;
        } else {
            state.activeCandidateInst = null;
        }
    }
    state.activeCandidateDept = 'All';
    if (state.activeCandidateFilter !== 'Needs My Action') state.activeCandidateFilter = 'Complete Applications';
    renderCandidatesTable();
}
window.switchCandidateCampusTab = switchCandidateCampusTab;

function switchCandidateInstTab(instId) {
    state.activeCandidateInst = instId;
    state.activeCandidateDept = 'All';
    if (state.activeCandidateFilter !== 'Needs My Action') state.activeCandidateFilter = 'Complete Applications';
    renderCandidatesTable();
}
window.switchCandidateInstTab = switchCandidateInstTab;

function switchCandidateDeptTab(deptName) {
    state.activeCandidateDept = deptName;
    renderCandidatesTable();
}
window.switchCandidateDeptTab = switchCandidateDeptTab;

function switchUserCampusTab(campusId) {
    state.activeUserCampus = campusId;
    if (campusId === 'global') {
        state.activeUserInst = null;
    } else {
        state.activeUserInst = 'admin'; // Default to Campus Admins first
    }
    renderUsersTable();
}
window.switchUserCampusTab = switchUserCampusTab;

function switchUserInstTab(instId) {
    state.activeUserInst = instId;
    renderUsersTable();
}
window.switchUserInstTab = switchUserInstTab;

function renderUsersTable() {
    const mainContent = document.getElementById('main-content');
    
    // 1. Campus Tabs (Level 1)
    const campusTabsHtml = `
        <div class="tabs-header" style="margin-bottom: 1rem;">
            <button class="tab-btn ${state.activeUserCampus === 1 ? 'active' : ''}" onclick="switchUserCampusTab(1)">
                <i class="fa-solid fa-building-columns"></i> Ramapuram Campus
            </button>
            <button class="tab-btn ${state.activeUserCampus === 2 ? 'active' : ''}" onclick="switchUserCampusTab(2)">
                <i class="fa-solid fa-building-columns"></i> Trichy Campus
            </button>
            <button class="tab-btn ${state.activeUserCampus === 'global' ? 'active' : ''}" onclick="switchUserCampusTab('global')">
                <i class="fa-solid fa-gears"></i> Global & System Accounts
            </button>
        </div>
    `;

    // 2. Institution Tabs (Level 2)
    let subTabsHtml = '';
    if (state.activeUserCampus !== 'global') {
        const campusInsts = state.metadata.institutions.filter(inst => inst.campus_id === state.activeUserCampus);
        
        const subTabButtons = [
            `<button class="sub-tab-btn ${state.activeUserInst === 'admin' ? 'active' : ''}" onclick="switchUserInstTab('admin')">
                <i class="fa-solid fa-user-shield"></i> Campus Admins
             </button>`,
            `<button class="sub-tab-btn ${state.activeUserInst === 'dean' ? 'active' : ''}" onclick="switchUserInstTab('dean')">
                <i class="fa-solid fa-user-tie"></i> Campus Deans
             </button>`
        ];

        campusInsts.forEach(inst => {
            subTabButtons.push(
                `<button class="sub-tab-btn ${state.activeUserInst === inst.id ? 'active' : ''}" onclick="switchUserInstTab(${inst.id})">
                    <i class="fa-solid fa-university"></i> ${inst.name}
                 </button>`
            );
        });

        subTabsHtml = `
            <div class="sub-tabs-header" style="display: flex; gap: 8px; border-bottom: 1px dashed var(--glass-border); margin-bottom: 1.5rem; padding-bottom: 12px; flex-wrap: wrap;">
                ${subTabButtons.join('')}
            </div>
        `;
    }

    // 3. Filter users based on selections
    let filteredUsers = state.usersList;
    if (state.activeUserCampus === 'global') {
        filteredUsers = state.usersList.filter(u => u.role === 'super_admin' || !u.campus_id);
    } else {
        filteredUsers = state.usersList.filter(u => u.campus_id === state.activeUserCampus);
        if (state.activeUserInst === 'admin') {
            filteredUsers = filteredUsers.filter(u => u.role === 'admin');
        } else if (state.activeUserInst === 'dean') {
            filteredUsers = filteredUsers.filter(u => u.role === 'dean');
        } else {
            filteredUsers = filteredUsers.filter(u => u.institution_id === state.activeUserInst && u.role !== 'admin' && u.role !== 'dean');
        }
    }
    
    let rowsHtml = '';
    filteredUsers.forEach(u => {
        const campusText = u.campus_name || '<span style="color: var(--text-muted)">-</span>';
        const institutionText = u.institution_name || '<span style="color: var(--text-muted)">-</span>';
        const deptText = u.department_name || '<span style="color: var(--text-muted)">-</span>';
        
        let detailsHtml = '';
        if (u.role === 'hod') {
            detailsHtml = `Dept of ${deptText} (${institutionText}, ${campusText})`;
        } else if (u.role === 'coordinator') {
            detailsHtml = `Coordinator - ${institutionText} (${campusText})`;
        } else if (u.role === 'admin') {
            detailsHtml = `Admin - ${campusText}`;
        } else {
            detailsHtml = `Super Administrator`;
        }

        const isSelf = u.id === state.user.id;
        const escapedPassword = u.password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        rowsHtml += `
            <tr id="user-row-${u.id}">
                <td>
                    <div style="font-weight: 600;">${u.name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${u.email || ''}</div>
                </td>
                <td><span class="badge" title="${u.username}" style="background-color: var(--bg-tertiary); font-family: monospace; font-size: 0.85rem; padding: 4px 8px; border: 1px solid var(--glass-border); border-radius: 4px; display: inline-block; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle;">${u.username}</span></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="password-masked" id="pwd-text-${u.id}" style="font-family: monospace;">••••••••</span>
                        <button class="btn btn-secondary" onclick="togglePasswordVisibility(${u.id}, '${escapedPassword}')" style="padding: 4px 8px; font-size: 0.75rem;">
                            <i class="fa-solid fa-eye" id="pwd-icon-${u.id}"></i>
                        </button>
                    </div>
                </td>
                <td><span class="badge badge-primary">${u.role.replace('_', ' ').toUpperCase()}</span></td>
                <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 250px; white-space: normal; line-height: 1.4; word-break: break-word;">${detailsHtml}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" onclick="openAdminSetPasswordModal(${u.id}, '${u.name.replace(/'/g, "\\'")}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Reset Password">
                            <i class="fa-solid fa-key"></i>
                        </button>
                        ${!isSelf ? `
                        <button class="btn btn-danger" onclick="deleteUserAccount(${u.id}, '${u.name.replace(/'/g, "\\'")}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Delete User">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                        ` : `
                        <button class="btn btn-secondary btn-disabled" style="padding: 6px 10px; font-size: 0.8rem;" title="Cannot delete yourself" disabled>
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    });

    if (rowsHtml === '') {
        rowsHtml = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem;">
                    No user accounts configured under this campus/institution category.
                </td>
            </tr>
        `;
    }

    mainContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 10px;">
            <h2 style="font-size: 1.8rem; margin: 0;">User Accounts Management</h2>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="btn btn-secondary" onclick="downloadUsersTemplate()" title="Download Excel Template to Collect User Data">
                    <i class="fa-solid fa-file-excel"></i> Download Excel Template
                </button>
                <button class="btn btn-secondary" onclick="document.getElementById('bulk-user-file-input').click()" title="Upload User Data in Bulk">
                    <i class="fa-solid fa-upload"></i> Bulk Upload Users
                </button>
                <input type="file" id="bulk-user-file-input" accept=".xlsx, .xls" style="display: none;" onchange="uploadUsersBulk(event)">
                <button class="btn btn-primary" onclick="openCreateUserModal()">
                    <i class="fa-solid fa-user-plus"></i> Add New User Account
                </button>
            </div>
        </div>
        
        ${campusTabsHtml}
        ${subTabsHtml}

        <div class="card" style="margin-bottom: 2rem;">
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
                Administrators can create login accounts for HODs, Research Coordinators, and Admins. Standard seeded accounts can be assigned simpler usernames and secure passwords to ensure safe portal operations.
            </p>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>User Details</th>
                            <th>Username</th>
                            <th>Password</th>
                            <th>Role</th>
                            <th>Affiliation</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Define visibility toggle helper globally if not defined
    if (!window.togglePasswordVisibility) {
        window.togglePasswordVisibility = function(userId, plainText) {
            const textSpan = document.getElementById(`pwd-text-${userId}`);
            const icon = document.getElementById(`pwd-icon-${userId}`);
            if (textSpan.classList.contains('password-masked')) {
                textSpan.innerText = plainText;
                textSpan.classList.remove('password-masked');
                icon.className = 'fa-solid fa-eye-slash';
            } else {
                textSpan.innerText = '••••••••';
                textSpan.classList.add('password-masked');
                icon.className = 'fa-solid fa-eye';
            }
        };
    }
}
window.renderUsersTable = renderUsersTable;

async function toggleSupervisorUploads() {
    const currentState = state.settings && state.settings.supervisor_upload_enabled !== false;
    const newState = !currentState;
    const btn = document.getElementById('toggle-supervisor-btn');
    const originalHtml = btn.innerHTML;
    
    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
        btn.disabled = true;
        
        const res = await api('/api/admin/settings', 'POST', { 
            key: 'supervisor_upload_enabled', 
            value: newState 
        });
        
        if (!state.settings) state.settings = {};
        state.settings.supervisor_upload_enabled = newState;
        
        showToast(`Supervisor uploads are now ${newState ? 'OPEN' : 'CLOSED'}.`, 'success');
        if (typeof renderImportantDatesPage === 'function') {
            renderImportantDatesPage();
        } else {
            renderUsersTable();
        }
    } catch (err) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        showToast(err.message, 'error');
    }
}
window.toggleSupervisorUploads = toggleSupervisorUploads;

async function saveAdminDeadlines(event) {
    const btn = event.currentTarget;
    const originalHtml = btn.innerHTML;
    
    const settingsUpdate = [
        { key: 'deadline_supervisor_upload', value: document.getElementById('dl-supervisor-upload').value },
        { key: 'deadline_question_paper', value: document.getElementById('dl-question-paper').value },
        { key: 'deadline_eligibility', value: document.getElementById('dl-eligibility').value },
        { key: 'deadline_create_panels', value: document.getElementById('dl-create-panels').value },
        { key: 'deadline_allocate_panels', value: document.getElementById('dl-allocate-panels').value }
    ];

    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;
        
        const res = await api('/api/admin/settings', 'POST', { settings: settingsUpdate });
        
        if (res && res.settings) {
            state.settings = res.settings;
        } else {
            if (!state.settings) state.settings = {};
            settingsUpdate.forEach(s => {
                state.settings[s.key] = s.value;
            });
        }
        
        showToast('Deadlines saved successfully.', 'success');
        if (typeof renderImportantDatesPage === 'function') {
            await renderImportantDatesPage();
        } else {
            renderUsersTable();
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}
window.saveAdminDeadlines = saveAdminDeadlines;

function openCreateUserModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    // Build options for campuses
    const campusOptions = state.metadata.campuses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const institutionOptions = state.metadata.institutions.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    const departmentOptions = state.metadata.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 550px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-user-plus" style="color: var(--primary); margin-right: 8px;"></i>Create User Account</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="create-user-form">
                    <div class="form-group">
                        <label for="new-user-name">Full Name</label>
                        <input type="text" id="new-user-name" class="form-control" placeholder="e.g. Dr. Rajesh Kumar" required>
                    </div>
                    <div class="form-group">
                        <label for="new-user-email">Email Address</label>
                        <input type="email" id="new-user-email" class="form-control" placeholder="e.g. rajesh.k@srmist.edu.in" required>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div class="form-group">
                            <label for="new-user-username">Username</label>
                            <input type="text" id="new-user-username" class="form-control" placeholder="e.g. rajesh_hod" required autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label for="new-user-password">Password</label>
                            <input type="text" id="new-user-password" class="form-control" placeholder="e.g. SecurePass123" required autocomplete="new-password">
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="new-user-role">Role</label>
                        <select id="new-user-role" class="form-control" required>
                            <option value="">-- Select Role --</option>
                            <option value="hod">Head of Department (HOD)</option>
                            <option value="coordinator">Research Coordinator</option>
                            <option value="admin">Administrator</option>
                            <option value="super_admin">Super Administrator</option>
                        </select>
                    </div>
                    
                    <div id="metadata-selectors" style="display: none; border-top: 1px dashed var(--glass-border); padding-top: 1rem; margin-top: 1rem;">
                        <div class="form-group" id="campus-group" style="display: none;">
                            <label for="new-user-campus">Campus</label>
                            <select id="new-user-campus" class="form-control">
                                <option value="">-- Select Campus --</option>
                                ${campusOptions}
                            </select>
                        </div>
                        <div class="form-group" id="institution-group" style="display: none;">
                            <label for="new-user-institution">Institution / Faculty</label>
                            <select id="new-user-institution" class="form-control">
                                <option value="">-- Select Institution --</option>
                                ${institutionOptions}
                            </select>
                        </div>
                        <div class="form-group" id="department-group" style="display: none;">
                            <label for="new-user-department">Department</label>
                            <select id="new-user-department" class="form-control">
                                <option value="">-- Select Department --</option>
                                ${departmentOptions}
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 1.5rem;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Create Account</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const roleSelect = modal.querySelector('#new-user-role');
    const metadataSelectors = modal.querySelector('#metadata-selectors');
    const campusGroup = modal.querySelector('#campus-group');
    const institutionGroup = modal.querySelector('#institution-group');
    const departmentGroup = modal.querySelector('#department-group');

    roleSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val || val === 'super_admin') {
            metadataSelectors.style.display = 'none';
            campusGroup.style.display = 'none';
            institutionGroup.style.display = 'none';
            departmentGroup.style.display = 'none';
        } else if (val === 'admin') {
            metadataSelectors.style.display = 'block';
            campusGroup.style.display = 'block';
            institutionGroup.style.display = 'none';
            departmentGroup.style.display = 'none';
        } else if (val === 'coordinator') {
            metadataSelectors.style.display = 'block';
            campusGroup.style.display = 'block';
            institutionGroup.style.display = 'block';
            departmentGroup.style.display = 'none';
        } else if (val === 'hod') {
            metadataSelectors.style.display = 'block';
            campusGroup.style.display = 'block';
            institutionGroup.style.display = 'block';
            departmentGroup.style.display = 'block';
        }
    });

    const form = modal.querySelector('#create-user-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const role = roleSelect.value;
        const name = modal.querySelector('#new-user-name').value;
        const email = modal.querySelector('#new-user-email').value;
        const username = modal.querySelector('#new-user-username').value;
        const password = modal.querySelector('#new-user-password').value;

        const payload = { role, name, email, username, password };
        if (role !== 'super_admin') {
            payload.campus_id = modal.querySelector('#new-user-campus').value || null;
        }
        if (['coordinator', 'hod'].includes(role)) {
            payload.institution_id = modal.querySelector('#new-user-institution').value || null;
        }
        if (role === 'hod') {
            payload.department_id = modal.querySelector('#new-user-department').value || null;
        }

        try {
            const res = await api('/api/admin/users', 'POST', payload);
            showToast(res.message || 'User created successfully!', 'success');
            modal.remove();
            navigateToTab('users'); // Refresh user list
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}
window.openCreateUserModal = openCreateUserModal;

function openAdminSetPasswordModal(userId, userName) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 450px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-key" style="color: var(--primary); margin-right: 8px;"></i>Set Password</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem;">Set a new password for user <strong>${userName}</strong>.</p>
                <form id="admin-set-password-form">
                    <div class="form-group">
                        <label for="admin-new-password">New Password</label>
                        <input type="text" id="admin-new-password" class="form-control" placeholder="Enter new password" required>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 1.5rem;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Set Password</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector('#admin-set-password-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPassword = modal.querySelector('#admin-new-password').value;

        try {
            const res = await api(`/api/admin/users/${userId}/password`, 'POST', { newPassword });
            showToast(res.message || 'Password updated successfully!', 'success');
            modal.remove();
            navigateToTab('users');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}
window.openAdminSetPasswordModal = openAdminSetPasswordModal;

async function deleteUserAccount(userId, userName) {
    if (!confirm(`Are you sure you want to permanently delete user account "${userName}"?`)) return;

    try {
        const res = await api(`/api/admin/users/${userId}`, 'DELETE');
        showToast(res.message || 'User deleted successfully!', 'success');
        navigateToTab('users');
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.deleteUserAccount = deleteUserAccount;

async function downloadUsersTemplate() {
    try {
        showToast('Generating users collect template...');
        const response = await fetch('/api/admin/users-template', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });
        if (!response.ok) throw new Error('Failed to download template');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Users_Collect_Template.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Template downloaded successfully.');
    } catch (err) {
        showToast(err.message || 'Failed to download template', 'error');
    }
}
window.downloadUsersTemplate = downloadUsersTemplate;

async function uploadUsersBulk(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        showToast('Uploading and parsing users...');
        const response = await fetch('/api/admin/users-bulk-upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });

        const result = await response.json();
        event.target.value = ''; // Reset input

        if (!response.ok) {
            throw new Error(result.error || 'Failed to upload users.');
        }

        // Show custom modal with summary
        showBulkUploadSummaryModal(result);
        
        // Reload users list
        await loadUsersList();
        renderUsersTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
window.uploadUsersBulk = uploadUsersBulk;

function showBulkUploadSummaryModal(result) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    const rowsHtml = result.details.map(d => `
        <tr>
            <td style="font-family: monospace; font-weight: 600;">${d.username}</td>
            <td>
                ${d.success 
                    ? `<span class="badge badge-success"><i class="fa-solid fa-check"></i> ${d.action || 'Success'}</span>` 
                    : `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Failed</span>`
                }
            </td>
            <td style="font-size: 0.85rem; color: ${d.success ? 'var(--text-secondary)' : 'var(--danger)'};">
                ${d.success ? '' : d.error}
            </td>
        </tr>
    `).join('');

    modal.innerHTML = `
        <div class="modal-content animate-fade-in-up" style="max-width: 650px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-users-gear" style="color: var(--primary); margin-right: 8px;"></i>Bulk Upload Results</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="font-weight: 600; margin-bottom: 1rem; color: var(--text-primary);">${result.message}</p>
                <div class="table-container" style="max-height: 300px; overflow-y: auto;">
                    <table style="width: 100%;">
                        <thead>
                            <tr>
                                <th>Username</th>
                                <th>Result</th>
                                <th>Details / Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
                <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}
window.showBulkUploadSummaryModal = showBulkUploadSummaryModal;
window.switchHodSubTab = switchHodSubTab;
window.filterHodCandidatesList = filterHodCandidatesList;
window.renderCoordinatorSupervisorSummary = renderCoordinatorSupervisorSummary;
window.renderCoordinatorSupervisorsPage = renderCoordinatorSupervisorsPage;
