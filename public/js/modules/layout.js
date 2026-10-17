// --- VIEWS RENDERING ---

function renderApp() {
    if (!state.token) {
        renderLoginScreen();
        return;
    }

    const appDiv = document.getElementById('app');

    appDiv.innerHTML = `
        <div id="app-container">
            <header>
                <div class="logo-section">
                    <i class="fa-solid fa-graduation-cap fa-2xl" style="color: var(--primary)"></i>
                    <div>
                        <h1>SRMIST</h1>
                        <p style="font-size: 0.65rem; color: var(--text-muted); font-weight:600; letter-spacing:1px; text-transform:uppercase;">Directorate of Research</p>
                    </div>
                    <span>PhD Portal</span>
                </div>
                
                <div class="global-search-container" style="flex: 1; max-width: 500px; margin: 0 2rem; position: relative;">
                    <div style="position: relative;">
                        <i class="fa-solid fa-search" style="position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: var(--text-muted);"></i>
                        <input type="text" id="global-search-input" class="form-control" placeholder="Search candidates by App No, Name, Mobile, Email..." style="padding-left: 40px; border-radius: 20px; background-color: var(--glass-bg); backdrop-filter: blur(12px);">
                    </div>
                    <div id="global-search-results" class="card" style="display: none; position: absolute; top: 110%; left: 0; width: 100%; max-height: 400px; overflow-y: auto; z-index: 1000; padding: 0.5rem; flex-direction: column; gap: 4px;">
                    </div>
                </div>

                <div class="nav-user">
                    <div class="notification-container" style="position: relative; margin-right: 8px;">
                        <button class="theme-toggle" id="notification-bell" onclick="toggleNotificationDropdown()" title="Notifications" style="background-color: transparent;">
                            <i class="fa-solid fa-bell"></i>
                            <span id="notification-badge" class="badge" style="display: none; position: absolute; top: -5px; right: -5px; background: #e74c3c; color: white; border-radius: 50%; padding: 2px 6px; font-size: 0.7rem; font-weight: bold;">0</span>
                        </button>
                        <div id="notification-dropdown" class="card" style="display: none; position: absolute; top: 100%; right: 0; width: 300px; max-height: 400px; overflow-y: auto; z-index: 1000; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                            <div style="padding: 10px; border-bottom: 1px solid var(--glass-border); font-weight: bold;">Notifications</div>
                            <div id="notification-list" style="padding: 10px;">
                                <div style="color: var(--text-muted); font-size: 0.9rem; text-align: center;">No new notifications</div>
                            </div>
                        </div>
                    </div>
                    <button class="theme-toggle" onclick="openContactModal()" title="Contact / Send Message" style="margin-right: 4px; background-color: rgba(52, 152, 219, 0.15); color: #3498db;">
                        <i class="fa-solid fa-envelope"></i>
                    </button>
                    <button class="theme-toggle" id="theme-toggle-btn" title="Toggle Theme">
                        <i class="fa-solid ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'fa-sun' : 'fa-moon'}"></i>
                    </button>
                    <button class="theme-toggle" onclick="showProfileModal()" title="My Profile & Edit Email" style="margin-right: 4px;">
                        <i class="fa-solid fa-user-gear"></i>
                    </button>
                    <button class="theme-toggle" onclick="showChangePasswordModal()" title="Change Password" style="margin-right: 4px;">
                        <i class="fa-solid fa-key"></i>
                    </button>
                    <div class="user-info" onclick="showProfileModal()" style="cursor: pointer;" title="Click to view Profile & Edit Email">
                        <span class="name">${state.user.name}</span>
                        <span class="role">${state.user.role.replace('_', ' ').toUpperCase()}</span>
                    </div>
                    <button class="btn btn-secondary" onclick="handleLogout()" style="padding: 8px 12px;">
                        <i class="fa-solid fa-right-from-bracket"></i>
                    </button>
                </div>
            </header>
            <div style="display: flex; flex: 1;">
                <aside class="app-sidebar">
                    <button class="btn ${state.activeTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('dashboard')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-chart-pie"></i> Dashboard
                    </button>

                    <button id="overview-tab" class="btn ${state.activeTab === 'overview' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('overview')" title="Overview" aria-label="Overview" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-chart-column"></i> Overview
                    </button>

                    <button class="btn ${state.activeTab === 'candidates' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('candidates')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-user-graduate"></i> Candidates
                    </button>
                    ${['hod', 'coordinator'].includes(state.user.role) ? `
                    <button class="btn ${state.activeTab === 'supervisors' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('supervisors')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-user-tie"></i> Supervisors
                    </button>
                    ` : ''}
                    ${['hod', 'coordinator'].includes(state.user.role) ? `
                    <button class="btn ${state.activeTab === 'panels' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('panels')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-users"></i> Interview Panels
                    </button>
                    ` : ''}
                    ${['hod', 'admin', 'super_admin'].includes(state.user.role) ? `
                    <button class="btn ${state.activeTab === 'question_papers' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('question_papers')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-file-invoice"></i> Question Papers
                    </button>
                    ` : ''}
                    ${['hod', 'coordinator', 'dean', 'admin', 'super_admin'].includes(state.user.role) ? `
                    <button class="btn ${state.activeTab === 'transfers' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('transfers')" style="justify-content: flex-start; width: 100%; position: relative;">
                        <i class="fa-solid fa-arrow-right-arrow-left"></i> Transferred Candidates
                        <span id="sidebar-transfer-badge" style="margin-left: auto; background: #ef4444; color: white; border-radius: 9999px; padding: 2px 7px; font-size: 0.72rem; font-weight: bold; box-shadow: 0 0 8px rgba(239,68,68,0.6); display: ${(state.transferPendingCount && state.transferPendingCount > 0) ? 'inline-block' : 'none'};">
                            ${state.transferPendingCount || 0}
                        </span>
                    </button>
                    ` : ''}
                    ${['admin', 'super_admin'].includes(state.user.role) ? `
                    <button class="btn ${state.activeTab === 'emails' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('emails')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-envelope-open-text"></i> Email Logs
                    </button>
                    <button class="btn ${state.activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('users')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-users-gear"></i> User Accounts
                    </button>
                    <button class="btn ${state.activeTab === 'entrance_exam_docs' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('entrance_exam_docs')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-file-pdf"></i> Entrance Exam Docs
                    </button>
                    ` : ''}
                    ${['admin', 'super_admin'].includes(state.user.role) ? `
                    <button class="btn ${state.activeTab === 'audit_logs' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('audit_logs')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-clock-rotate-left"></i> Audit Logs
                    </button>
                    ` : ''}
                    <button class="btn ${state.activeTab === 'regulations' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('regulations')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-book-bookmark"></i> Regulations & SOP
                    </button>
                    <button class="btn ${state.activeTab === 'important_dates' ? 'btn-primary' : 'btn-secondary'}" onclick="navigateToTab('important_dates')" style="justify-content: flex-start; width: 100%;">
                        <i class="fa-solid fa-calendar-days"></i> Important Dates
                    </button>
                </aside>
                <main id="main-content" class="animate-fade-in"></main>
            </div>
        </div>
    `;

    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
    if (window.refreshTransferPendingCount) window.refreshTransferPendingCount();

    // Global Search Logic
    const searchInput = document.getElementById('global-search-input');
    const searchResults = document.getElementById('global-search-results');
    let searchTimeout = null;

    if (searchInput && searchResults) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                searchResults.style.display = 'none';
                return;
            }

            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                try {
                    const res = await api(`/api/candidates/search?q=${encodeURIComponent(query)}`);
                    searchResults.innerHTML = '';
                    
                    if (res.length === 0) {
                        searchResults.innerHTML = '<div style="padding: 10px; color: var(--text-muted); text-align: center;">No candidates found</div>';
                    } else {
                        res.forEach(candidate => {
                            const div = document.createElement('div');
                            div.className = 'search-result-item';
                            div.innerHTML = `
                                <div style="font-weight: 600; color: var(--primary);">${candidate.application_no} - ${candidate.registered_name}</div>
                                <div style="font-size: 0.75rem; color: var(--text-secondary);">${candidate.department_name || 'Unmapped'} | ${candidate.status.replace(/_/g, ' ')}</div>
                            `;
                            div.style.padding = '10px';
                            div.style.cursor = 'pointer';
                            div.style.borderBottom = '1px solid var(--glass-border)';
                            div.style.borderRadius = 'var(--radius-sm)';
                            div.addEventListener('mouseover', () => div.style.backgroundColor = 'hsla(255, 65%, 62%, 0.1)');
                            div.addEventListener('mouseout', () => div.style.backgroundColor = 'transparent');
                            div.addEventListener('click', () => {
                                searchResults.style.display = 'none';
                                searchInput.value = '';
                                if (typeof openGlobalCandidateDossierModal === 'function') {
                                    openGlobalCandidateDossierModal(candidate.id);
                                }
                            });
                            searchResults.appendChild(div);
                        });
                    }
                    searchResults.style.display = 'flex';
                } catch (err) {
                    console.error("Search error:", err);
                }
            }, 300); // 300ms debounce
        });

        // Hide search when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const target = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', target);
    localStorage.setItem('phd_theme', target);
    
    document.querySelectorAll('#theme-toggle-btn i, #login-theme-toggle i').forEach(icon => {
        if (target === 'light') {
            icon.className = 'fa-solid fa-moon';
        } else {
            icon.className = 'fa-solid fa-sun';
        }
    });

    // Overview charts follow the selected theme.
    if (state.activeTab === 'overview' && state.user) {
        renderOverviewPage();
    }
}

function handleLogout() {
    localStorage.removeItem('phd_token');
    localStorage.removeItem('phd_user');
    state.token = null;
    state.user = null;
    state.vacancies = [];
    state.activeVacancyInst = null;
    state.activeCandidateCampus = null;
    state.activeCandidateInst = null;
    state.activeCandidateDept = 'All';
    state.activeCandidateFilter = 'Complete Applications';
    state.activeTab = 'dashboard';
    renderLoginScreen();
}

function renderLoginScreen() {
    const appDiv = document.getElementById('app');
    appDiv.innerHTML = `
        <div class="login-wrapper">
            <button class="theme-toggle" id="login-theme-toggle" title="Toggle Theme" style="position: absolute; top: 20px; right: 20px; border-radius: 50%; width: 42px; height: 42px; background: var(--bg-secondary); border: 1px solid var(--glass-border); color: var(--text-primary); cursor: pointer; transition: var(--transition);">
                <i class="fa-solid ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'fa-sun' : 'fa-moon'}"></i>
            </button>
            <div class="login-card animate-fade-in-up">
                <div style="text-align: center; margin-bottom: 1.5rem;">
                    <i class="fa-solid fa-graduation-cap fa-3x" style="color: var(--primary)"></i>
                </div>
                <h2>PhD Admissions Portal</h2>
                <p>Enter your credentials to manage candidate evaluation, ranking, and supervisor allocation.</p>
                <form id="login-form">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" class="form-control" placeholder="e.g. suresh, hod_et_commerce_rmp" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <div style="position: relative;">
                            <input type="password" id="password" class="form-control" placeholder="••••••••" required autocomplete="current-password" style="padding-right: 40px;">
                            <i class="fa-solid fa-eye" id="toggle-password" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; color: var(--text-muted);" title="Toggle Password Visibility" onclick="const p = document.getElementById('password'); if (p.type === 'password') { p.type = 'text'; this.classList.remove('fa-eye'); this.classList.add('fa-eye-slash'); } else { p.type = 'password'; this.classList.remove('fa-eye-slash'); this.classList.add('fa-eye'); }"></i>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem; padding: 12px;">
                        Sign In <i class="fa-solid fa-right-to-bracket"></i>
                    </button>
                </form>
            </div>
        </div>
    `;

    document.getElementById('login-theme-toggle').addEventListener('click', toggleTheme);

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const res = await api('/api/auth/login', 'POST', { username, password });
            state.token = res.token;
            state.user = res.user;
            state.settings = res.settings || {};
            localStorage.setItem('phd_token', res.token);
            localStorage.setItem('phd_user', JSON.stringify(res.user));
            showToast(`Welcome back, ${res.user.name}!`);
            if (typeof initSocket === 'function') initSocket();
            navigateToTab('dashboard');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

async function openGlobalCandidateDossierModal(candidateId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay animate-fade-in';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 900px; width: 90%; max-height: 90vh; overflow-y: auto; background: var(--bg-primary); padding: 0;">
            <div class="modal-header" style="position: sticky; top: 0; z-index: 10; background: var(--glass-bg); backdrop-filter: blur(12px); padding: 1rem 1.5rem; border-bottom: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0;"><i class="fa-solid fa-folder-open"></i> Candidate Dossier</h3>
                <div style="display:flex; gap:10px; align-items:center;">
                    ${state && state.user && ['admin', 'super_admin'].includes(state.user.role) ? `<button class="btn btn-danger" onclick="if(confirm('Are you sure you want to delete this candidate?')) { if(typeof deleteCandidates === 'function') { deleteCandidates([${candidateId}]); this.closest('.modal-overlay').remove(); } else { alert('Delete functionality missing.'); } }" style="background-color: #ef4444; border-color: #ef4444; padding: 6px 12px; font-size: 0.85rem;"><i class="fa-solid fa-trash"></i> Delete Candidate</button>` : ''}
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>
            </div>
            <div class="modal-body" style="padding: 1.5rem;">
                <div id="global-dossier-panel">
                    <div style="text-align: center; color: var(--text-muted); padding: 2rem;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Loading Dossier...</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    if (typeof loadCandidateDossier === 'function') {
        try {
            await loadCandidateDossier(candidateId, 'global-dossier-panel');
            // Ensure the panel is visible since loadCandidateDossier sets it to display:block
            document.getElementById('global-dossier-panel').style.display = 'block';
        } catch (err) {
            document.getElementById('global-dossier-panel').innerHTML = `<div style="color: red;">Error loading dossier: ${err.message}</div>`;
        }
    } else {
        document.getElementById('global-dossier-panel').innerHTML = `<div style="color: red;">Dossier viewer is not loaded on this page.</div>`;
    }
}
