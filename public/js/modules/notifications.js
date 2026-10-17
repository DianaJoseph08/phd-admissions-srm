// --- NOTIFICATIONS & SOCKET.IO ---
let socket = null;
let notifications = [];

function initSocket() {
    if (socket) return;
    socket = io();
    
    socket.on('connect', () => {
        if (state.token) {
            socket.emit('register', state.token);
            void refreshAdmissionsLiveData();
        }
    });

    socket.on('new_notification', (notif) => {
        notifications.unshift(notif);
        updateNotificationUI();
        showToast('New notification received', 'info');
    });

    socket.on('admissions_updated', () => refreshAdmissionsLiveData());

    socket.on('settings_updated', (updatedSettings) => {
        if (!state.settings) state.settings = {};
        Object.assign(state.settings, updatedSettings);
        // Refresh whatever view is currently active so notes/warnings and deadlines update in real-time
        if (state.activeTab === 'important_dates' && typeof renderImportantDatesPage === 'function') {
            renderImportantDatesPage();
        } else if (state.activeTab === 'candidates' && typeof renderCandidateManager === 'function') {
            renderCandidateManager();
        } else if (state.activeTab === 'question_papers' && typeof renderHodQuestionPapersPage === 'function') {
            renderHodQuestionPapersPage();
        } else if (state.activeTab === 'panels' && typeof renderHodInterviewPanelsPage === 'function') {
            renderHodInterviewPanelsPage();
        } else if (state.activeTab === 'supervisors' && typeof renderCoordinatorSupervisorsPage === 'function') {
            renderCoordinatorSupervisorsPage();
        } else if (state.activeTab === 'dashboard' && typeof renderDashboardMetrics === 'function') {
            renderDashboardMetrics();
        }
    });

    fetchNotifications();
}


async function fetchNotifications() {
    try {
        const res = await api('/api/notifications', 'GET');
        notifications = res.notifications || [];
        updateNotificationUI();
    } catch (e) {
        console.error('Failed to fetch notifications:', e);
    }
}

function updateNotificationUI() {
    const unreadCount = notifications.filter(n => !n.is_read).length;
    const badge = document.getElementById('notification-badge');
    
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }

    const list = document.getElementById('notification-list');
    if (list) {
        if (notifications.length === 0) {
            list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center;">No new notifications</div>';
        } else {
            list.innerHTML = notifications.map(n => `
                <div style="padding: 10px; border-bottom: 1px solid var(--glass-border); ${n.is_read ? 'opacity: 0.7;' : 'background: rgba(52, 152, 219, 0.05); font-weight: bold;'}">
                    <div style="font-size: 0.9rem;">${n.message}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
                        ${new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                        ${n.sender_name ? ' &bull; From ' + n.sender_name : ''}
                    </div>
                </div>
            `).join('');
        }
    }
}

async function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;
    
    const isShowing = dropdown.style.display === 'block';
    dropdown.style.display = isShowing ? 'none' : 'block';
    
    if (!isShowing) {
        // Mark as read when opened
        const unreadCount = notifications.filter(n => !n.is_read).length;
        if (unreadCount > 0) {
            try {
                await api('/api/notifications/read', 'POST');
                notifications.forEach(n => n.is_read = 1);
                updateNotificationUI();
            } catch (e) {
                console.error(e);
            }
        }
    }
}

// Close dropdown if clicked outside
document.addEventListener('click', (e) => {
    const container = document.querySelector('.notification-container');
    const dropdown = document.getElementById('notification-dropdown');
    if (container && dropdown && dropdown.style.display === 'block') {
        if (!container.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    }
});

let admissionsRefreshInFlight=false;
let admissionsRefreshQueued=false;
async function refreshAdmissionsLiveData() {
    if(!state.token || !state.user)return;
    if(admissionsRefreshInFlight){admissionsRefreshQueued=true;return;}
    admissionsRefreshInFlight=true;const token=state.token;
    try {
        const [vacancies,candidates]=await Promise.all([api('/api/vacancies'),api('/api/candidates')]);
        if(token!==state.token)return;
        state.vacancies=vacancies.vacancies||[];state.candidates=candidates.candidates||[];
        document.querySelectorAll('[data-selection-limit]').forEach(el=>el.textContent=selectionLimitText(Number(el.dataset.selectionLimit)));
        document.querySelectorAll('[data-selection-candidate]').forEach(select=>{const candidate=state.candidates.find(c=>Number(c.id)===Number(select.dataset.selectionCandidate));const option=select.querySelector('option[value="Selected"]');if(candidate&&option)option.disabled=!canSelectWithinAllotment(candidate);});
        const editing=document.querySelector('.modal-overlay,.candidate-checkbox:checked')||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
        if(state.activeTab==='candidates'&&!editing)renderCandidatesTable();
        if(state.activeTab==='dashboard'&&!editing)renderDashboardMetrics();
        if(state.activeTab==='overview'&&!editing)renderOverviewPage();
    }catch(error){console.warn('Could not refresh admission updates:',error.message);}finally{admissionsRefreshInFlight=false;if(admissionsRefreshQueued){admissionsRefreshQueued=false;void refreshAdmissionsLiveData();}}
}
