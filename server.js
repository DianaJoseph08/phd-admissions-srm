const express = require('express');
const studyModePolicy = require('./public/js/modules/study_mode_policy');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const { readImportField, resolveAdmissionMapping, normalizeFormStatus, readAdmissionRows } = require('./lib/admission-mapping');
const { queueTrichyCatalog, catalog: trichyCatalog } = require('./lib/trichy-catalog');
const unzipper = require('unzipper');
const PizzaZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const {summarizeMinutesAttendance,formatMinutesScore} = require('./lib/minutes-attendance');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const pdf = require('pdf-parse');

dotenv.config();

const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
const storageConfig = require('./lib/storage-persistence');
const { activeDbPath, tempUploadDir, docsUploadDir, syncToPersistentStorage } = storageConfig;

app.use('/regulations', express.static(path.join(__dirname, 'Regulations and SOP')));
app.use('/uploads', express.static(tempUploadDir));
app.use('/uploads', express.static(docsUploadDir));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Database Connection
const dbPath = activeDbPath;
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout',5000);
storageConfig.registerDatabaseInstance(db);

// Create supervisors table on startup if it doesn't exist and ensure candidates has percentage columns
db.serialize(() => {
    queueTrichyCatalog(db);
    // Keep Trichy faculty IDs and account relationships while adopting Meritto names.
    db.run("UPDATE institutions SET name = 'Faculty of Engineering and Technology' WHERE id = 5 AND campus_id = 2 AND name IN ('College of Engineering', 'College of Engineering and Technology')");
    db.run("UPDATE institutions SET name = 'Faculty of Science and Humanities' WHERE id = 6 AND campus_id = 2 AND name = 'College of Science and Humanities'");
    db.run(`CREATE TABLE IF NOT EXISTS supervisors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campus_id INTEGER,
        institution_id INTEGER,
        department_id INTEGER,
        name TEXT NOT NULL,
        faculty_id TEXT,
        designation TEXT,
        area_of_research TEXT,
        max_students INTEGER DEFAULT 8,
        current_guiding INTEGER DEFAULT 0,
        vacancy INTEGER DEFAULT 8,
        completed_students INTEGER DEFAULT 0,
        is_eligible TEXT DEFAULT 'Yes',
        allocated_count INTEGER DEFAULT 0,
        FOREIGN KEY (campus_id) REFERENCES campuses(id),
        FOREIGN KEY (institution_id) REFERENCES institutions(id),
        FOREIGN KEY (department_id) REFERENCES departments(id)
    )`);

    // Safely add pg_percentage and ug_percentage to candidates table if they don't exist
    db.run(`ALTER TABLE candidates ADD COLUMN pg_percentage REAL`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE candidates ADD COLUMN ug_percentage REAL`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE candidates ADD COLUMN is_interdisciplinary INTEGER DEFAULT 0`, (err) => {
        // Ignore error if column already exists
    });
    // Add ft_allowed to departments for Super Admin FT intake configuration
    db.run(`ALTER TABLE departments ADD COLUMN ft_allowed INTEGER DEFAULT NULL`, (err) => {
        // Ignore error if column already exists
    });
    // Add panel_id, interview_marks_4, interview_marks_5 to candidates table
    db.run(`ALTER TABLE candidates ADD COLUMN panel_id INTEGER DEFAULT NULL`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE candidates ADD COLUMN interview_marks_4 REAL DEFAULT NULL`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE candidates ADD COLUMN interview_marks_5 REAL DEFAULT NULL`, (err) => {
        // Ignore error if column already exists
    });

    // Create interview panels & panel members tables
    db.run(`CREATE TABLE IF NOT EXISTS interview_panels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campus_id INTEGER,
        institution_id INTEGER,
        department_id INTEGER,
        panel_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campus_id) REFERENCES campuses(id),
        FOREIGN KEY (institution_id) REFERENCES institutions(id),
        FOREIGN KEY (department_id) REFERENCES departments(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS panel_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        panel_id INTEGER,
        name TEXT,
        designation TEXT,
        FOREIGN KEY (panel_id) REFERENCES interview_panels(id) ON DELETE CASCADE
    )`);

    // Ensure we have a logs table with recipient_name
    db.run(`CREATE TABLE IF NOT EXISTS email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER,
        recipient_email TEXT,
        subject TEXT,
        body TEXT,
        status TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        recipient_name TEXT
    )`);
    db.run(`ALTER TABLE email_logs ADD COLUMN recipient_name TEXT`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`UPDATE candidates SET status = 'Eligible' WHERE status = 'Hall Ticket Sent'`, (err) => {
        // Ignore error
    });

    // ── NEW COLUMN MIGRATIONS ────────────────────────────────────────────────
    db.run(`ALTER TABLE candidates ADD COLUMN employment_position TEXT`, () => {});
    db.run(`ALTER TABLE candidates ADD COLUMN employment_organization TEXT`, () => {});
    db.run(`ALTER TABLE candidates ADD COLUMN return_remark TEXT`, () => {});
    db.run(`ALTER TABLE candidates ADD COLUMN allocation_remark TEXT`, () => {});
    db.run(`ALTER TABLE candidates ADD COLUMN ranks_released_at TEXT`, () => {});

    // ── STATUS / OWNER MIGRATIONS (old → new workflow) ───────────────────────
    // Old: "Under Coordinator Review" (Dean sent back to Coordinator) → now "Returned to RC"
    db.run(`UPDATE candidates SET status = 'Returned to RC', current_owner = 'RC'
            WHERE status = 'Under Coordinator Review'`, () => {});
    // Old: "Under Dean Initial Review" (Admin→Dean via generic forward) → "Under Dean Review"
    db.run(`UPDATE candidates SET status = 'Under Dean Review', current_owner = 'Dean'
            WHERE status = 'Under Dean Initial Review'`, () => {});
    // Old: "Verified Eligible"/"Verified Ineligible" owned by Coordinator → now "Under RC Review"
    db.run(`UPDATE candidates SET status = 'Under RC Review', current_owner = 'RC'
            WHERE status IN ('Verified Eligible', 'Verified Ineligible') AND current_owner = 'Coordinator'`, () => {});
    // Old: current_owner = 'Coordinator' → normalize to 'RC'
    db.run(`UPDATE candidates SET current_owner = 'RC' WHERE current_owner = 'Coordinator'`, () => {});
    // Incomplete applications must always be owned by Admin until Admin forwards to HOD
    db.run(`UPDATE candidates SET current_owner = 'Admin' WHERE status = 'Incomplete' AND NOT (campus_id = 2 AND institution_id = 101 AND department_id = 101)`, () => {});
    db.run(`UPDATE candidates SET current_owner = 'RC' WHERE campus_id = 2 AND institution_id = 101 AND department_id = 101 AND status IN ('Incomplete', 'Pending Verification')`, () => {});
    // HOD Verified Eligible/Ineligible not yet forwarded → keep with HOD, they need to forward to RC
    // (no change needed for those)

    // Create question papers and parsed questions tables
    db.run(`CREATE TABLE IF NOT EXISTS question_papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        department_id INTEGER NOT NULL,
        campus_id INTEGER NOT NULL,
        set_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        uploaded_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (department_id) REFERENCES departments(id),
        FOREIGN KEY (campus_id) REFERENCES campuses(id),
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
        UNIQUE(department_id, campus_id, set_name)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_paper_id INTEGER NOT NULL,
        section TEXT NOT NULL,
        q_no INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_answer TEXT,
        FOREIGN KEY (question_paper_id) REFERENCES question_papers(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
    )`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('qp_isolated_mode', 'true')`);

    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        description TEXT NOT NULL,
        target_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    for (const [column,type] of [['actor_name','TEXT'],['actor_username','TEXT'],['actor_role','TEXT'],['campus_id','INTEGER'],['request_method','TEXT'],['request_path','TEXT'],['response_status','INTEGER']]) {
        db.run('ALTER TABLE audit_logs ADD COLUMN '+column+' '+type, error => { if(error && !error.message.includes('duplicate column')) console.error('Audit migration:',error.message); });
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_campus_created ON audit_logs(campus_id,created_at DESC,id DESC)');
    db.run(`UPDATE audit_logs SET actor_name=(SELECT name FROM users WHERE id=audit_logs.user_id),actor_username=(SELECT username FROM users WHERE id=audit_logs.user_id),actor_role=(SELECT role FROM users WHERE id=audit_logs.user_id),campus_id=(SELECT campus_id FROM users WHERE id=audit_logs.user_id) WHERE actor_name IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=audit_logs.user_id)`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_id INTEGER NOT NULL,
        sender_id INTEGER,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipient_id) REFERENCES users(id),
        FOREIGN KEY (sender_id) REFERENCES users(id)
    )`);

    // Auto-create initial settings
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('supervisor_upload_enabled', 'true')`);

    // Auto-create Ramapuram Research Office institution, department and coordinator account for unmapped candidates
    db.run(`INSERT OR REPLACE INTO institutions (id, campus_id, name, coordinator, coord_username)
            VALUES (100, 1, 'Ramapuram Research Office', 'Ramapuram Research Office', 'rmp_research_office')`, (err) => {
        if (err) console.error('Research Office institution insert error:', err.message);
    });
    db.run(`INSERT OR REPLACE INTO departments (id, institution_id, name)
            VALUES (100, 100, 'Unclassified / Pending Mapping')`, (err) => {
        if (err) console.error('Research Office department insert error:', err.message);
    });
    db.run(`INSERT OR IGNORE INTO users (username, password, role, name, email, campus_id, institution_id, department_id)
            VALUES ('rmp_research_office', 'ResearchOffice@2026', 'coordinator', 'Ramapuram Research Office', 'research.office.rmp@srmist.edu.in', 1, 100, NULL)`, (err) => {
        if (err && !err.message.includes('UNIQUE')) console.error('Research Office user insert error:', err.message);
    });
});

// Upload directories are configured via storageConfig (supporting persistent GCS volume)

// Configure Multer for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempUploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}_${file.originalname}`);
    }
});
const upload = multer({ storage });

// Cookie Session Middleware (Simple Token Simulation)
const activeSessions = new Map(); // token -> user details

app.use((req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const user = activeSessions.get(token);
        if (user) {
            req.user = user;
        }
    }
    next();
});

// Flush one semantic audit entry before finishing a modifying request.
app.use((req,res,next) => {
    const context = {events:[],ended:false};
    req.auditContext = context;
    const originalEnd = res.end;
    res.end = function(...args) {
        if(context.ended) return originalEnd.apply(res,args);
        context.ended = true;
        if (!req.user || !req.path.startsWith('/api/') || !['POST','PUT','PATCH','DELETE'].includes(req.method)) {
            if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
                syncToPersistentStorage();
            }
            return originalEnd.apply(res,args);
        }
        const target = req.body?.candidateIds || req.body?.candidate_id || req.params.id || req.body?.id || null;
        const targetId = target == null ? null : Array.isArray(target) ? target.join(', ') : String(target);
        const success = res.statusCode >= 200 && res.statusCode < 300;
        const events = success && context.events.length ? context.events : [{userId:req.user.id,actionType:success?'API_'+req.method:'API_FAILED',description:(success?'Performed ':'Failed ')+req.method+' on '+req.path}];
        const seen = new Set(), writes = [];
        for(const event of events) {
            const signature=event.actionType+'|'+event.description;
            if(seen.has(signature))continue;
            seen.add(signature);
            const query = typeof req.body?.remark === 'string' ? req.body.remark.trim() : '';
            writes.push(writeAuditEntry(event.userId,event.actionType,event.description+(query?' Query: '+query:''),event.targetId || targetId,req.user,req.method,req.path,res.statusCode));
        }
        Promise.all(writes).then(()=>{
            syncToPersistentStorage();
            originalEnd.apply(res,args);
        }).catch(error=>{
            console.error('Failed to log audit:',error.message);
            syncToPersistentStorage();
            originalEnd.apply(res,args);
        });
        return res;
    };
    next();
});

function requireAuth(roles = []) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized. Please login.' });
        }
        if (roles.length > 0 && !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden. Access denied.' });
        }
        
        next();
    };
}

// Clean names for fuzzy match helper
function cleanName(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace('and', '');
}

// SMTP Transport Helper
function getMailTransporter() {
    // If we have real env settings, use them
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    // Otherwise fallback to mock (or log only)
    return null;
}

// --- Socket.io & Notifications ---
const connectedSockets = new Map(); // userId -> socket.id

io.on('connection', (socket) => {
    socket.on('register', (token) => {
        const user = activeSessions.get(token);
        if (user) {
            connectedSockets.set(user.id, socket.id);
        }
    });

    socket.on('disconnect', () => {
        for (const [userId, sockId] of connectedSockets.entries()) {
            if (sockId === socket.id) {
                connectedSockets.delete(userId);
                break;
            }
        }
    });
});

function logAudit(userId, actionType, description, targetId = null) {
    const request = userId && typeof userId === 'object' ? userId : null;
    const context = request?.auditContext;
    if (context) { context.events.push({userId:request.user.id,actionType,description,targetId}); return; }
    db.get('SELECT id,name,username,role,campus_id FROM users WHERE id=?',[userId],(error,user) => {
        if(error) return console.error('Failed to resolve audit actor:',error.message);
        writeAuditEntry(userId,actionType,description,targetId,user || {}).catch(error=>console.error('Failed to log audit:',error.message));
    });
}
function writeAuditEntry(userId,actionType,description,targetId,user,method=null,requestPath=null,responseStatus=null) {
    return new Promise((resolve,reject) => db.run('INSERT INTO audit_logs (user_id,action_type,description,target_id,actor_name,actor_username,actor_role,campus_id,request_method,request_path,response_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [userId,actionType,description || actionType,targetId,user.name || 'Deleted user',user.username || null,user.role || null,user.campus_id ?? null,method,requestPath,responseStatus],
        error => error ? reject(error) : resolve()));
}

function sendNotification(recipientId, senderId, message) {
    db.run(
        'INSERT INTO notifications (recipient_id, sender_id, message) VALUES (?, ?, ?)',
        [recipientId, senderId, message],
        function (err) {
            if (err) {
                console.error('Failed to save notification:', err);
                return;
            }
            // Emit via socket if user is online
            const sockId = connectedSockets.get(recipientId);
            if (sockId) {
                io.to(sockId).emit('new_notification', {
                    id: this.lastID,
                    message,
                    sender_id: senderId,
                    created_at: new Date().toISOString()
                });
            }
        }
    );
}

// Get official sender email based on campus ID (1 for Ramapuram, 2 for Trichy)
function getFromEmail(campus_id) {
    if (Number(campus_id) === 2) {
        return 'phd.info@srmtry.edu.in';
    }
    return 'phd.info@srmrmp.edu.in';
}

// Log Email to DB for Audit/Fallback
function logEmail(candidate_id, recipient_email, subject, body, status, recipient_name = null) {
    db.run(`INSERT INTO email_logs (candidate_id, recipient_email, subject, body, status, recipient_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [candidate_id, recipient_email, subject, body, status, recipient_name]);
}

// Helper to look up HOD strictly by department_id and campus_id
function getHodForDepartment(departmentId, campusId, callback) {
    db.get(
        "SELECT id, username, name, email, department_id, campus_id FROM users WHERE role = 'hod' AND department_id = ? AND campus_id = ?",
        [departmentId, campusId],
        callback
    );
}

// --- AUTH ROUTES ---
app.post('/api/auth/login', (req, res) => {
    let { username, password } = req.body;
    if (username) username = username.trim();
    if (password) password = password.trim();

    // Login strictly by username and password
    const sql = `
        SELECT u.*, c.name as campus_name, i.name as institution_name, d.name as department_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        LEFT JOIN institutions i ON u.institution_id = i.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE LOWER(u.username) = LOWER(?) AND u.password = ?
    `;

    db.get(sql, [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Invalid username or password' });

        const token = `token_${user.id}_${Date.now()}`;
        activeSessions.set(token, user);
        req.user = user;
        logAudit(req, 'LOGIN', 'Signed in successfully.');

        db.all('SELECT key, value FROM settings', [], (err, rows) => {
            const settings = {};
            if (!err) {
                rows.forEach(r => settings[r.key] = (r.value === 'true' ? true : (r.value === 'false' ? false : r.value)));
            }
            res.json({
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    name: user.name,
                    campus_id: user.campus_id,
                    campus_name: user.campus_name,
                    email: user.email,
                    institution_id: user.institution_id,
                    institution_name: user.institution_name,
                    department_id: user.department_id,
                    department_name: user.department_name
                },
                settings
            });
        });
    });
});

app.get('/api/auth/me', requireAuth(), (req, res) => {
    const sql = `
        SELECT u.*, c.name as campus_name, i.name as institution_name, d.name as department_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        LEFT JOIN institutions i ON u.institution_id = i.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.id = ?
    `;
    db.get(sql, [req.user.id], (uErr, fullUser) => {
        const userObj = fullUser || req.user;
        db.all('SELECT key, value FROM settings', [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const settings = {};
            rows.forEach(r => settings[r.key] = (r.value === 'true' ? true : (r.value === 'false' ? false : r.value)));
            res.json({ user: userObj, settings });
        });
    });
});

app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if(req.user) logAudit(req, 'LOGOUT', 'Signed out.');
        activeSessions.delete(token);
    }
    res.json({ success: true });
});

// --- SETTINGS ROUTES ---
app.get('/api/settings', requireAuth(), (req, res) => {
    db.all('SELECT key, value FROM settings', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(r => settings[r.key] = (r.value === 'true' ? true : (r.value === 'false' ? false : r.value)));
        res.json({ settings });
    });
});

app.post('/api/admin/settings', requireAuth(['admin', 'super_admin']), (req, res) => {
    console.log('[DEBUG] /api/admin/settings body:', req.body);
    let settingsToUpdate = [];
    if (req.body.settings && Array.isArray(req.body.settings)) {
        settingsToUpdate = req.body.settings;
    } else if (req.body.key && req.body.value !== undefined) {
        settingsToUpdate.push({ key: req.body.key, value: req.body.value });
    } else {
        return res.status(400).json({ error: 'Valid key/value or settings array required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        settingsToUpdate.forEach(s => {
            stmt.run([s.key, String(s.value)]);
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'UPDATE_SETTINGS', `Updated settings: ${settingsToUpdate.map(s => s.key).join(', ')}`);
            db.all('SELECT key, value FROM settings', [], (serr, rows) => {
                const settings = {};
                if (!serr && rows) {
                    rows.forEach(r => settings[r.key] = (r.value === 'true' ? true : (r.value === 'false' ? false : r.value)));
                }
                io.emit('settings_updated', settings);
                res.json({ success: true, settings });
            });
        });
    });
});


// --- PASSWORD CHANGE AND USER MANAGEMENT ROUTES ---
app.post('/api/auth/change-password', requireAuth(), (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
    }

    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.password !== currentPassword) {
            return res.status(400).json({ error: 'Incorrect current password' });
        }

        db.run('UPDATE users SET password = ? WHERE id = ?', [newPassword, req.user.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'CHANGE_PASSWORD', `User changed their password`);
            res.json({ success: true, message: 'Password updated successfully' });
        });
    });
});

// Get Logged-in User Profile (including department & campus names)
app.get('/api/user/profile', requireAuth(), (req, res) => {
    const query = `
        SELECT u.id, u.username, u.role, u.name, u.email, u.campus_id, u.institution_id, u.department_id,
               c.name as campus_name, 
               i.name as institution_name, 
               d.name as department_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        LEFT JOIN institutions i ON u.institution_id = i.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.id = ?
    `;
    db.get(query, [req.user.id], (err, profile) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!profile) return res.status(404).json({ error: 'User profile not found.' });
        res.json({ success: true, profile });
    });
});

// Update Logged-in User Email (HOD / User self-service)
app.put('/api/user/email', requireAuth(), (req, res) => {
    let { email } = req.body;
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }
    email = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address format (e.g. name@srmist.edu.in).' });
    }

    db.run('UPDATE users SET email = ? WHERE id = ?', [email, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found.' });

        // Update active in-memory session if active
        for (const [token, sessionUser] of activeSessions.entries()) {
            if (sessionUser && sessionUser.id === req.user.id) {
                sessionUser.email = email;
            }
        }
        if (req.user) req.user.email = email;

        logAudit(req, 'UPDATE_EMAIL', `User updated their registered email to ${email}`);
        res.json({ success: true, message: 'Email address updated successfully!', email });
    });
});

app.get('/api/admin/users', requireAuth(['admin', 'super_admin']), (req, res) => {
    const query = `
        SELECT u.id, u.username, u.password, u.role, u.name, u.email, u.campus_id, u.institution_id, u.department_id,
               c.name as campus_name, 
               i.name as institution_name, 
               d.name as department_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        LEFT JOIN institutions i ON u.institution_id = i.id
        LEFT JOIN departments d ON u.department_id = d.id
        ORDER BY u.role, u.username
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ users: rows });
    });
});

// Download Users Excel Template
app.get('/api/admin/users-template', requireAuth(['admin', 'super_admin']), (req, res) => {
    try {
        const sampleData = [
            {
                username: 'hod_mgt_studies_rmp',
                password: 'password',
                role: 'hod',
                name: 'Dr. John Doe',
                email: 'john.doe@srmist.edu.in',
                campus: 'Ramapuram',
                institution: 'Management',
                department: 'Management Studies'
            },
            {
                username: 'coord_mgt_rmp',
                password: 'password',
                role: 'coordinator',
                name: 'Dr. Priya S',
                email: 'priya.s@srmist.edu.in',
                campus: 'Ramapuram',
                institution: 'Management',
                department: ''
            },
            {
                username: 'admin_rmp',
                password: 'password',
                role: 'admin',
                name: 'Dr. Diana V',
                email: 'diana.v@srmist.edu.in',
                campus: 'Ramapuram',
                institution: '',
                department: ''
            }
        ];

        const ws = xlsx.utils.json_to_sheet(sampleData);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Users');

        // Autofit columns
        const colWidths = [
            { wch: 20 }, // username
            { wch: 12 }, // password
            { wch: 12 }, // role
            { wch: 20 }, // name
            { wch: 25 }, // email
            { wch: 15 }, // campus
            { wch: 20 }, // institution
            { wch: 25 }  // department
        ];
        ws['!cols'] = colWidths;

        const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Users_Collect_Template.xlsx');
        res.send(buf);
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate template: ' + err.message });
    }
});

// Bulk Upload Users via Excel
app.post('/api/admin/users-bulk-upload', requireAuth(['admin', 'super_admin']), upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;

    try {
        const workbook = xlsx.readFile(filePath);
        let rawRows = [];
        
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const sheetRows = xlsx.utils.sheet_to_json(sheet);
            rawRows = rawRows.concat(sheetRows);
        }

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        if (rawRows.length === 0) {
            return res.status(400).json({ error: 'The uploaded file is empty or has no user records.' });
        }

        // Fetch db metadata for mapping
        const campuses = await new Promise((resolve, reject) => {
            db.all("SELECT id, name FROM campuses", (err, rows) => err ? reject(err) : resolve(rows));
        });
        const institutions = await new Promise((resolve, reject) => {
            db.all("SELECT id, campus_id, name FROM institutions", (err, rows) => err ? reject(err) : resolve(rows));
        });
        const departments = await new Promise((resolve, reject) => {
            db.all("SELECT id, institution_id, name FROM departments", (err, rows) => err ? reject(err) : resolve(rows));
        });

        const getCampusId = (name) => {
            if (!name) return null;
            const clean = cleanName(name);
            const match = campuses.find(c => cleanName(c.name) === clean);
            return match ? match.id : null;
        };

        const getInstitutionId = (name, campusId) => {
            if (!name) return null;
            const clean = cleanName(name);
            const match = institutions.find(i => cleanName(i.name) === clean && (campusId ? i.campus_id === campusId : true));
            return match ? match.id : null;
        };

        const getDepartmentId = (name, instId) => {
            if (!name) return null;
            const clean = cleanName(name);
            const match = departments.find(d => cleanName(d.name) === clean && (instId ? d.institution_id === instId : true));
            return match ? match.id : null;
        };

        const results = [];

        // Sequential processing to avoid SQLite concurrency locking
        for (const row of rawRows) {
            // Normalize column keys to lowercase
            const normalizedRow = {};
            Object.keys(row).forEach(key => {
                const normKey = key.toLowerCase().replace(/\s+/g, '').trim();
                normalizedRow[normKey] = row[key];
            });

            const username = String(normalizedRow.username || '').trim();
            const password = String(normalizedRow.password || normalizedRow.pwd || 'password').trim();
            const role = String(normalizedRow.role || '').trim().toLowerCase();
            const name = String(normalizedRow.name || normalizedRow.fullname || '').trim();
            const email = normalizedRow.email ? String(normalizedRow.email).trim() : null;

            if (!username || !role || !name) {
                results.push({ success: false, username: username || 'Unknown', error: 'Username, Role, and Name are required fields.' });
                continue;
            }

            if (!['super_admin', 'admin', 'coordinator', 'hod'].includes(role)) {
                results.push({ success: false, username, error: `Invalid role "${role}". Allowed: super_admin, admin, coordinator, hod` });
                continue;
            }

            const campusVal = normalizedRow.campus || '';
            const instVal = normalizedRow.institution || normalizedRow.faculty || '';
            const deptVal = normalizedRow.department || '';

            const campusId = getCampusId(campusVal);
            const instId = getInstitutionId(instVal, campusId);
            const deptId = getDepartmentId(deptVal, instId);

            // Validation checks based on role
            if (role === 'admin' && !campusId) {
                results.push({ success: false, username, error: `Campus "${campusVal}" not found in database.` });
                continue;
            }
            if (role === 'coordinator' && (!campusId || !instId)) {
                results.push({ success: false, username, error: `Institution "${instVal}" under Campus "${campusVal}" not found.` });
                continue;
            }
            if (role === 'hod' && (!campusId || !instId || !deptId)) {
                results.push({ success: false, username, error: `Department "${deptVal}" under Institution "${instVal}" not found.` });
                continue;
            }

            try {
                const existing = await new Promise((resolve, reject) => {
                    db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => err ? reject(err) : resolve(row));
                });

                if (existing) {
                    await new Promise((resolve, reject) => {
                        db.run(
                            `UPDATE users SET password = ?, role = ?, name = ?, email = ?, campus_id = ?, institution_id = ?, department_id = ? WHERE id = ?`,
                            [password, role, name, email, campusId, instId, deptId, existing.id],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    results.push({ success: true, username, action: 'Updated existing user' });
                } else {
                    await new Promise((resolve, reject) => {
                        db.run(
                            `INSERT INTO users (username, password, role, name, email, campus_id, institution_id, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [username, password, role, name, email, campusId, instId, deptId],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    results.push({ success: true, username, action: 'Created new user' });
                }
            } catch (dbErr) {
                results.push({ success: false, username, error: 'Database error: ' + dbErr.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        res.json({
            success: true,
            message: `Processed ${rawRows.length} rows. Successful: ${successCount}, Failed: ${rawRows.length - successCount}`,
            details: results
        });

    } catch (ex) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: ex.message });
    }
});

app.get('/api/admin/metadata', requireAuth(['admin', 'super_admin', 'coordinator', 'dean', 'hod']), (req, res) => {
    const data = {};
    db.all('SELECT * FROM campuses ORDER BY name', [], (err, campuses) => {
        if (err) return res.status(500).json({ error: err.message });
        data.campuses = campuses;
        db.all('SELECT * FROM institutions ORDER BY name', [], (err, institutions) => {
            if (err) return res.status(500).json({ error: err.message });
            const officialTrichyIds = new Set(trichyCatalog.institutions.map(i => Number(i.id)));
            data.institutions = institutions
                .filter(i => Number(i.campus_id) !== 2 || officialTrichyIds.has(Number(i.id)) || Number(i.id) === 101)
                .map(i => ({...i, is_routing_office: Number(i.id) === 100 || Number(i.id) === 101}));
            db.all('SELECT * FROM departments ORDER BY name', [], (err, departments) => {
                if (err) return res.status(500).json({ error: err.message });
                const approvedEngineering = new Set(trichyCatalog.institutions.find(i => Number(i.id) === 5).departments.map(n => n.toUpperCase()));
                data.departments = departments.filter(d => !(Number(d.institution_id) === 6 && String(d.name).trim().toUpperCase() === 'ENGLISH') && (Number(d.institution_id) !== 5 || approvedEngineering.has(String(d.name).toUpperCase())));
                res.json(data);
            });
        });
    });
});

app.post('/api/admin/users', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { username, password, role, name, email, campus_id, institution_id, department_id } = req.body;
    if (!username || !password || !role || !name) {
        return res.status(400).json({ error: 'Username, password, role, and name are required' });
    }

    db.run(
        `INSERT INTO users (username, password, role, name, email, campus_id, institution_id, department_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, password, role, name, email || null, campus_id || null, institution_id || null, department_id || null],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed: users.username')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: 'User created successfully', userId: this.lastID });
        }
    );
});

app.post('/api/admin/users/:id/password', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) {
        return res.status(400).json({ error: 'New password is required' });
    }

    db.run('UPDATE users SET password = ? WHERE id = ?', [newPassword, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: 'User password updated successfully' });
    });
});

app.delete('/api/admin/users/:id', requireAuth(['admin', 'super_admin']), (req, res) => {
    // Prevent deleting oneself
    if (req.user.id === parseInt(req.params.id)) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    db.run('DELETE FROM users WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: 'User deleted successfully' });
    });
});

// --- ADMIN UPLOAD ROUTES ---
app.post('/api/admin/upload-excel', requireAuth(['admin']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const campusId = req.user.campus_id; // Suresh = 1 (RMP), Ruby = 2 (Trichy)

    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = readAdmissionRows(sheet, xlsx, campusId);

        // Fetch institutions and departments for fuzzy matching
        db.all(`SELECT d.id as dept_id, d.name as dept_name, i.id as inst_id, i.name as inst_name, i.campus_id 
                FROM departments d JOIN institutions i ON d.institution_id = i.id 
                WHERE i.campus_id = ?`, [campusId], (err, dbMetadata) => {
            if (err) return res.status(500).json({ error: err.message });

            // Fetch existing candidate application numbers, form_status and status to prevent overwrites & handle transitions
            db.all(`SELECT id, application_no, form_status, status, campus_id, institution_id, department_id, current_owner FROM candidates WHERE campus_id = ? OR id IN (SELECT tr.candidate_id FROM transfer_requests tr JOIN institutions origin ON origin.id = tr.from_institution_id WHERE origin.campus_id = ? AND tr.stage = 'COMPLETED')`, [campusId, campusId], (err, existingCandidates) => {
                if (err) return res.status(500).json({ error: err.message });

                const existingMap = new Map();
                existingCandidates.forEach(c => {
                    const appNo = (c.application_no || '').toString().trim();
                    existingMap.set(appNo, {...c, form_status: normalizeFormStatus(c.form_status)});
                });

                let imported = 0;
                let updated = 0;
                let importFailure = null;
                const captureImportError = error => { if (error && !importFailure) importFailure = error; };
                let transitioned = 0;
                let remapped = 0;
                let skipped = 0;
                let transferredSkipped = 0;
                let unmapped = 0;
                let unmappedDetails = [];
                let errors = [];

                const importWrites = [];
                const queueImportRun = (sql, params) => importWrites.push(() => new Promise((resolve,reject) => db.run(sql,params,function(error){ if(error) reject(error); else resolve(this.changes); })));
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    
                    const insertSql = `INSERT INTO candidates 
                        (application_no, form_name, registered_name, email, mobile, form_status, payment_status, payment_method, nationality, mode_of_study, name_on_cert, dob, gender, campus_id, institution_id, department_id, program, user_id, category, current_owner, status, employment_position, employment_organization) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                    rows.forEach((row, idx) => {
                        const originalAppNo = (row['Application No'] || row['Application Number'] || row['Application_No'] || '').toString().trim();
                        if (!originalAppNo) {
                            errors.push(`Row ${idx + 2}: Missing Application No`);
                            return;
                        }

                        let appNo = originalAppNo;
                        const nationalityInput = (row['Nationality'] || 'India').toString().trim();
                        if (!nationalityInput.toLowerCase().startsWith('india') && !appNo.startsWith('IR')) {
                            appNo = 'IR' + appNo;
                        }

                        const formName = row['Form Name'] || '';
                        const rawFormStatus = readImportField(row, ['Form Status', 'Form_Status']);
                        const formStatus = Number(campusId) === 2 ? rawFormStatus : normalizeFormStatus(rawFormStatus);
                        const workflowFormStatus = normalizeFormStatus(formStatus);
                        
                        const regName = row['Registered Name'] || row['Applicant Name (As Per Certificates)'] || row['Registered_Name'] || 'Unknown';
                        const email = row['Registered Email'] || row['Registered_Email'] || row['Email'] || '';
                        const mobile = (row['Registered Mobile'] || row['Registered_Mobile'] || '').toString().replace('`', '');
                        const payStatus = row['Payment Status'] || 'Payment Approved';
                        const payMethod = row['Payment Method'] || 'Online';
                        const modeOfStudy = row['Mode Of Study']; // Validated physical column CO, including blanks.
                        const dob = row['Date Of Birth'] || row['Date_Of_Birth'] || '';
                        const gender = row['Gender'] || '';
                        // Meritto CI is headed Institute and takes precedence over other institution fields.
                        const instNameInput = readImportField(row, ['Institute', 'Institution']);
                        const deptNameInput = readImportField(row, ['Department']);
                        const programName = row['Program'] || '';
                        const userId = row['User Id'] || row['User_Id'] || '';
                        const category = row['Community (As Per Govt Norms)'] || row['Category'] || 'General';
                        const employmentPosition = readImportField(row, ['Designation', 'Position', 'Current Designation', 'Employment Designation', 'Job Title']);
                        const employmentOrganization = readImportField(row, ['Organization Name', 'Organisation Name', 'Company Name', 'Employer Name', 'Name Of Organization', 'Name Of Organisation', 'Employment Organization', 'Institution Of Employment']);

                        const mapping = resolveAdmissionMapping(instNameInput, deptNameInput, campusId, dbMetadata);
                        let matchedInstId = mapping.match?.inst_id || null;
                        let matchedDeptId = mapping.match?.dept_id || null;

                        let isUnmapped = false;
                        if (!matchedInstId || !matchedDeptId) {
                            // Route to Campus Research Office instead of dropping
                            matchedInstId = Number(campusId) === 2 ? 101 : 100;
                            matchedDeptId = Number(campusId) === 2 ? 101 : 100;
                            isUnmapped = true;
                        }

                        let existing = existingMap.get(appNo);
                        let matchedAppNo = appNo;

                        if (!existing && appNo !== originalAppNo) {
                            if (existingMap.has(originalAppNo)) {
                                existing = existingMap.get(originalAppNo);
                                matchedAppNo = originalAppNo;
                                // Keep the existing identifier and its linked documents on repeat uploads.
                                appNo = matchedAppNo;
                            }
                        } else if (!existing && appNo === originalAppNo && !appNo.startsWith('IR')) {
                            const irNo = 'IR' + appNo;
                            if (existingMap.has(irNo)) {
                                existing = existingMap.get(irNo);
                                matchedAppNo = irNo;
                                appNo = irNo; // Use the IR one that is already stored
                            }
                        }

                        if (existing && Number(existing.campus_id) !== Number(campusId)) {
                            // A stale source-campus export cannot recreate or modify a completed transfer.
                            transferredSkipped++;
                            skipped++;
                            return;
                        }

                        if (existing) {
                            // Source uploads never reset workflow fields or downgrade completion.
                            const completed = existing.form_status === 'Complete' || (Boolean(rawFormStatus) && workflowFormStatus === 'Complete');
                            const storedFormStatus = completed ? (Number(campusId) === 2 ? 'COMPLETE' : 'Complete') : (rawFormStatus ? formStatus : existing.form_status);
                            const assignments = ['form_status = ?', 'mode_of_study = ?'];
                            const fields = [storedFormStatus, modeOfStudy];
                            if (employmentPosition) { assignments.push('employment_position = ?'); fields.push(employmentPosition); }
                            if (employmentOrganization) { assignments.push('employment_organization = ?'); fields.push(employmentOrganization); }
                            const officeId = Number(campusId) === 2 ? 101 : 100;
                            const early = ['Pending Verification','Incomplete'].includes(existing.status) && (existing.current_owner === 'Admin' || (existing.current_owner === 'RC' && Number(existing.institution_id) === officeId));
                            let next = {...existing, form_status: completed ? 'Complete' : 'Incomplete'};
                            if (early) {
                                for (const [column,value] of [['program',programName],['registered_name',regName === 'Unknown' ? '' : regName],['email',email],['mobile',mobile]]) {
                                    if (value) { assignments.push(column+' = ?'); fields.push(value); }
                                }
                                // An absent source mapping never removes an existing valid mapping.
                                const repair = !isUnmapped && (Number(existing.institution_id) === officeId || Number(existing.institution_id) === Number(matchedInstId) && Number(existing.department_id) === Number(matchedDeptId));
                                const instituteId = repair ? matchedInstId : existing.institution_id;
                                const departmentId = repair ? matchedDeptId : existing.department_id;
                                const owner = Number(campusId) === 2 && Number(instituteId) === officeId ? 'RC' : 'Admin';
                                const status = completed ? 'Pending Verification' : 'Incomplete';
                                assignments.push('institution_id = ?','department_id = ?','status = ?','current_owner = ?');
                                fields.push(instituteId,departmentId,status,owner);
                                if (repair && (Number(existing.institution_id) !== Number(instituteId) || Number(existing.department_id) !== Number(departmentId))) remapped++;
                                next = {...next,institution_id:instituteId,department_id:departmentId,status,current_owner:owner};
                            }
                            queueImportRun('UPDATE candidates SET '+assignments.join(', ')+' WHERE application_no = ? AND campus_id = ?', [...fields,matchedAppNo,campusId]);
                            existingMap.set(appNo,next);
                            if (existing.form_status !== 'Complete' && completed) transitioned++;
                            updated++;
                            return;
                        }

                        if (isUnmapped) {
                            unmapped++;
                            unmappedDetails.push(`Row ${idx + 2} (App: ${appNo}, Name: ${regName}): Institution="${instNameInput}" / Dept="${deptNameInput}" → routed to Research Office (${mapping.reason})`);
                        }

                        // Determine initial owner and status
                        // All candidates land with Admin first:
                        //   Complete   → "Pending Verification" (Admin forwards to Dean)
                        //   Incomplete (no dept) → "Incomplete" with Admin (Research Office re-routes)
                        //   Incomplete (has dept) → "Incomplete" with Admin (Admin directly forwards to HOD)
                        const initialOwner = Number(campusId) === 2 && isUnmapped ? 'RC' : 'Admin';
                        const initialStatus = (workflowFormStatus === 'Incomplete') ? 'Incomplete' : 'Pending Verification';

                        queueImportRun(insertSql, [
                            appNo, formName, regName, email, mobile, formStatus, payStatus, payMethod, nationalityInput, modeOfStudy, regName, dob, gender,
                            campusId, matchedInstId, matchedDeptId, programName, userId, category, initialOwner, initialStatus, employmentPosition, employmentOrganization
                        ]);
                        existingMap.set(appNo,{application_no:appNo,campus_id:campusId,form_status:workflowFormStatus,status:initialStatus,current_owner:initialOwner,institution_id:matchedInstId,department_id:matchedDeptId});
                        imported++;
                    });

                    (async () => {
                    try { for (const write of importWrites) await write(); } catch (error) { captureImportError(error); }
                    db.run(importFailure ? "ROLLBACK" : "COMMIT", (err) => {
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // Clean temp file
                        if (err) return res.status(500).json({ error: err.message });
                        
                        if (importFailure) return res.status(500).json({error: "Upload was rolled back: " + importFailure.message});
                        let msg = `Imported ${imported} new candidates successfully.`;
                        if (remapped > 0) msg += ` Corrected institute/department mapping for ${remapped} previously unclassified application(s).`;
                        if (transitioned > 0) msg += ` Transitioned ${transitioned} incomplete → complete application(s).`;
                        if (unmapped > 0) {
                            const researchOffice = Number(campusId) === 2 ? 'Trichy Research Office account (username: trichy_research_office)' : 'Ramapuram Research Office account (username: rmp_research_office)';
                            msg += ` ${unmapped} candidates with unrecognised institution/department were routed to the ${researchOffice}.`;
                        }
                        msg += ` Updated ${updated} existing applications without resetting workflow progress.`;
                        if (transferredSkipped) msg += ` Skipped ${transferredSkipped} applications already transferred to another campus.`;
                        logAudit(req, 'IMPORT_APPLICATIONS', msg);

                        if (imported > 0 || transitioned > 0) {
                            db.all("SELECT id FROM users WHERE role IN ('hod', 'coordinator') AND campus_id = ?", [campusId], (nErr, nRows) => {
                                if (!nErr && nRows) {
                                    const notifyMsg = `A new batch of PhD Candidates has been uploaded and routed for verification.`;
                                    nRows.forEach(r => {
                                        sendNotification(r.id, req.user.id, notifyMsg);
                                    });
                                }
                            });
                        }

                        res.json({
                            success: true,
                            message: msg,
                            imported_count: imported, updated_count: updated, transitioned_count: transitioned,
                            transferred_skipped_count: transferredSkipped,
                            remapped_count: remapped,
                            unmapped_count: unmapped,
                            unmapped_details: unmappedDetails.length > 0 ? unmappedDetails : null,
                            errors: errors.length > 0 ? errors : null
                        });
                    });
                    })();
                });
            });
        });
    } catch (ex) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(ex.status || 500).json({ error: ex.message });
    }
});

// Document type classification helper
function detectDocumentType(fileName, canonicalAppNo, rawAppNo) {
    if (!fileName) return 'Other';
    const ext = path.extname(fileName);
    const baseName = fileName.substring(0, fileName.length - ext.length);
    const baseNameUpper = baseName.toUpperCase();
    const strippedBase = baseNameUpper.replace(/^20\d\d/, ''); // Strip academic year prefix like 2025, 2026

    const tokens = Array.from(new Set([
        (canonicalAppNo || '').toString().trim().toUpperCase(),
        (rawAppNo || '').toString().trim().toUpperCase()
    ])).filter(t => t.length > 0);

    for (const token of tokens) {
        for (const name of [baseNameUpper, strippedBase]) {
            if (name === token) return 'Application';
            if (name === token + 'CG' || name === token + '_CG') return 'Competitive Exam Certificate';
            if (name === token + 'PG_CMS' || name === token + 'PGCMS' || name === token + '_PG_CMS') return 'PG Cumulative Mark Statement';
            if (name === token + 'PG' || name === token + '_PG' || name === token + 'PG_DEG' || name === token + '_PG_DEG') return 'PG Degree Certificate';
            if (name === token + 'UG_CMS' || name === token + 'UGCMS' || name === token + '_UG_CMS') return 'UG Cumulative Mark Statement';
            if (name === token + 'UG' || name === token + '_UG' || name === token + 'UG_DEG' || name === token + '_UG_DEG') return 'UG Degree Certificate';
            if (name === token + '10TH' || name === token + '_10TH' || name === token + '10' || name === token + '_10') return '10th Markstatement';
            if (name === token + '12TH' || name === token + '_12TH' || name === token + '12' || name === token + '_12') return '12th Markstatement';
            if (name === 'P' + token || name === 'PHOTO_' + token || name === 'PHOTO' + token) return 'Photo';
            if (name === 'S' + token || name === 'SIGN_' + token || name === 'SIG_' + token || name === 'SIGN' + token) return 'Signature';
        }
    }

    // Keyword-based fallback matching
    if (baseNameUpper.includes('APPLICATION') || baseNameUpper.includes('APP_FORM')) return 'Application';
    if (baseNameUpper.includes('PHOTO') || baseNameUpper.startsWith('P2')) return 'Photo';
    if (baseNameUpper.includes('SIGN') || baseNameUpper.includes('SIG') || baseNameUpper.startsWith('S2')) return 'Signature';
    if (baseNameUpper.includes('10TH') || baseNameUpper.includes('SSLC')) return '10th Markstatement';
    if (baseNameUpper.includes('12TH') || baseNameUpper.includes('HSC') || baseNameUpper.includes('PLUS2')) return '12th Markstatement';
    if (baseNameUpper.includes('PG_CMS') || baseNameUpper.includes('PGCMS') || baseNameUpper.includes('PG_CONSOLIDATED') || baseNameUpper.includes('PG_MARK')) return 'PG Cumulative Mark Statement';
    if (baseNameUpper.includes('PG') || baseNameUpper.includes('POST_GRAD')) return 'PG Degree Certificate';
    if (baseNameUpper.includes('UG_CMS') || baseNameUpper.includes('UGCMS') || baseNameUpper.includes('UG_CONSOLIDATED') || baseNameUpper.includes('UG_MARK')) return 'UG Cumulative Mark Statement';
    if (baseNameUpper.includes('UG') || baseNameUpper.includes('UNDER_GRAD')) return 'UG Degree Certificate';
    if (baseNameUpper.includes('MPHIL') || baseNameUpper.includes('M.PHIL')) return 'M.Phil / Equivalent';
    if (baseNameUpper.includes('GATE') || baseNameUpper.includes('NET') || baseNameUpper.includes('CSIR') || baseNameUpper.includes('EXAM')) return 'Competitive Exam Certificate';

    return 'Other';
}

// Bulk ZIP Candidates' documents upload and extraction API
app.post('/api/admin/upload-zip', requireAuth(['admin']), upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const zipPath = req.file.path;
    const campusId = req.user.campus_id;
    const extractTempDir = path.join(tempUploadDir, `zip_${Date.now()}`);

    try {
        fs.mkdirSync(extractTempDir);

        // Unzip candidates documents zip
        await fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: extractTempDir }))
            .promise();

        // Recursively read the extracted files
        const matchedFiles = [];
        let totalFilesScanned = 0;

        // Load all candidate application numbers from database to check
        db.all('SELECT id, application_no FROM candidates WHERE campus_id = ?', [campusId], async (err, candidates) => {
            if (err) {
                fs.rmSync(extractTempDir, { recursive: true, force: true });
                fs.unlinkSync(zipPath);
                return res.status(500).json({ error: err.message });
            }

            // Build structured candidate lookup supporting canonical and raw application numbers
            const candidateLookup = [];
            candidates.forEach(c => {
                const canonical = (c.application_no || '').toString().trim();
                const raw = canonical.replace(/^IR/i, '');
                const tokens = Array.from(new Set([canonical, raw])).filter(t => t && t.length >= 4);
                candidateLookup.push({
                    id: c.id,
                    canonicalAppNo: canonical,
                    rawAppNo: raw,
                    tokens: tokens
                });
            });

            // Sort lookup so longer numbers match first (avoids prefix collisions)
            candidateLookup.sort((a, b) => b.canonicalAppNo.length - a.canonicalAppNo.length);

            function scanDirectory(dir) {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        scanDirectory(fullPath);
                    } else {
                        totalFilesScanned++;
                        // Try to find if any application no is contained in the path or filename
                        let matchedCand = null;

                        for (const cand of candidateLookup) {
                            if (cand.tokens.some(token => fullPath.includes(token))) {
                                matchedCand = cand;
                                break;
                            }
                        }

                        if (matchedCand) {
                            const matchedCandId = matchedCand.id;
                            const matchedAppNo = matchedCand.canonicalAppNo;
                            const matchedRawAppNo = matchedCand.rawAppNo;

                            const docType = detectDocumentType(entry, matchedAppNo, matchedRawAppNo);

                            // Setup permanent directory for candidate under their canonical application number
                            const candDestDir = path.join(docsUploadDir, matchedAppNo);
                            if (!fs.existsSync(candDestDir)) fs.mkdirSync(candDestDir, { recursive: true });

                            const destFilePath = path.join(candDestDir, entry);
                            fs.copyFileSync(fullPath, destFilePath);

                            matchedFiles.push({
                                candidate_id: matchedCandId,
                                document_type: docType,
                                file_name: entry,
                                file_path: `/uploads/${matchedAppNo}/${entry}`
                            });
                        }
                    }
                }
            }

            scanDirectory(extractTempDir);

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                // Deduplicate before inserting to avoid duplicates on re-upload
                const deleteStmt = db.prepare('DELETE FROM candidate_documents WHERE candidate_id = ? AND file_name = ?');
                const insertStmt = db.prepare('INSERT INTO candidate_documents (candidate_id, document_type, file_name, file_path) VALUES (?, ?, ?, ?)');
                matchedFiles.forEach(f => {
                    deleteStmt.run(f.candidate_id, f.file_name);
                    insertStmt.run(f.candidate_id, f.document_type, f.file_name, f.file_path);
                });
                deleteStmt.finalize();
                insertStmt.finalize();
                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    // Clean up temp directories & files
                    fs.rmSync(extractTempDir, { recursive: true, force: true });
                    fs.unlinkSync(zipPath);

                    const distinctCandidates = new Set(matchedFiles.map(f => f.candidate_id)).size;
                    res.json({
                        success: true,
                        message: `ZIP processed. Scanned ${totalFilesScanned} files, successfully matched and associated ${matchedFiles.length} candidate documents across ${distinctCandidates} candidates.`
                    });
                });
            });
        });
    } catch (ex) {
        if (fs.existsSync(extractTempDir)) fs.rmSync(extractTempDir, { recursive: true, force: true });
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        res.status(500).json({ error: ex.message });
    }
});

// Direct Candidate Document(s) Upload API
app.post('/api/candidates/:id/upload-documents', requireAuth(['admin', 'super_admin', 'hod']), upload.array('files', 15), async (req, res) => {
    const candidateId = req.params.id;
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    db.get('SELECT id, application_no, campus_id FROM candidates WHERE id = ?', [candidateId], (err, candidate) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

        if (req.user.role === 'hod' && req.user.campus_id && req.user.campus_id !== candidate.campus_id) {
            return res.status(403).json({ error: 'Forbidden. Candidate belongs to another campus.' });
        }

        const canonicalAppNo = (candidate.application_no || '').toString().trim();
        const rawAppNo = canonicalAppNo.replace(/^IR/i, '');
        const candDestDir = path.join(docsUploadDir, canonicalAppNo);
        if (!fs.existsSync(candDestDir)) fs.mkdirSync(candDestDir, { recursive: true });

        const savedDocs = [];
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const deleteStmt = db.prepare('DELETE FROM candidate_documents WHERE candidate_id = ? AND file_name = ?');
            const insertStmt = db.prepare('INSERT INTO candidate_documents (candidate_id, document_type, file_name, file_path) VALUES (?, ?, ?, ?)');

            for (const file of files) {
                const originalName = file.originalname;
                const destFilePath = path.join(candDestDir, originalName);
                fs.copyFileSync(file.path, destFilePath);
                try { fs.unlinkSync(file.path); } catch (e) {}

                const docType = detectDocumentType(originalName, canonicalAppNo, rawAppNo);
                const relPath = `/uploads/${canonicalAppNo}/${originalName}`;

                deleteStmt.run(candidate.id, originalName);
                insertStmt.run(candidate.id, docType, originalName, relPath);

                savedDocs.push({
                    candidate_id: candidate.id,
                    document_type: docType,
                    file_name: originalName,
                    file_path: relPath
                });
            }

            deleteStmt.finalize();
            insertStmt.finalize();

            db.run("COMMIT", (commitErr) => {
                if (commitErr) return res.status(500).json({ error: commitErr.message });

                res.json({
                    success: true,
                    message: `Successfully uploaded ${savedDocs.length} document(s) for candidate ${canonicalAppNo}.`,
                    documents: savedDocs
                });
            });
        });
    });
});

// Clear candidate records and physical files to start fresh
app.post('/api/admin/clear-data', requireAuth(['admin', 'super_admin']), (req, res) => {
    const campusId = req.user.role === 'super_admin' ? (req.body.campus_id || 1) : req.user.campus_id;

    db.all('SELECT id, application_no FROM candidates WHERE campus_id = ?', [campusId], (err, candidates) => {
        if (err) return res.status(500).json({ error: err.message });

        if (!candidates || candidates.length === 0) {
            return res.json({ success: true, message: 'No candidate data found to delete for this campus.' });
        }

        const candidateIds = candidates.map(c => c.id);
        const appNos = candidates.map(c => c.application_no.toString().trim());
        const placeholders = candidateIds.map(() => '?').join(',');

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Delete transfer requests
            db.run(`DELETE FROM transfer_requests WHERE candidate_id IN (${placeholders})`, candidateIds, function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
            });

            // Delete candidate documents
            db.run(`DELETE FROM candidate_documents WHERE candidate_id IN (${placeholders})`, candidateIds, function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
            });

            // Delete candidates
            db.run(`DELETE FROM candidates WHERE id IN (${placeholders})`, candidateIds, function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
            });

            // Reset supervisor allocated count for this campus
            db.run('UPDATE supervisors SET allocated_count = 0 WHERE campus_id = ?', [campusId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
            });

            db.run('COMMIT', (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                // Delete physical files
                appNos.forEach(appNo => {
                    const candDir = path.join(docsUploadDir, appNo);
                    if (fs.existsSync(candDir)) {
                        try {
                            fs.rmSync(candDir, { recursive: true, force: true });
                        } catch (e) {
                            console.error(`Error deleting physical directory: ${candDir}`, e);
                        }
                    }
                });

                res.json({ success: true, message: 'Successfully deleted all candidates and uploaded files for this campus.' });
            });
        });
    });
});

// --- WORKFLOW CANDIDATE API ---
app.get('/api/candidates', requireAuth(), (req, res) => {
    const user = req.user;
    let query = `
        SELECT c.*, i.name as institution_name, d.name as department_name, camp.name as campus_name,
               (SELECT file_path FROM candidate_documents WHERE candidate_id = c.id AND document_type = 'Photo' LIMIT 1) as photo_path,
               (SELECT file_path FROM candidate_documents WHERE candidate_id = c.id AND document_type = 'Signature' LIMIT 1) as signature_path
        FROM candidates c
        JOIN institutions i ON c.institution_id = i.id
        JOIN departments d ON c.department_id = d.id
        JOIN campuses camp ON c.campus_id = camp.id
    `;
    let params = [];

    if (user.role === 'admin') {
        query += ' WHERE c.campus_id = ?';
        params.push(user.campus_id);
    } else if (user.role === 'coordinator') {
        // Coordinator manages their specific institution(s) mapped dynamically
        query += ' WHERE c.campus_id = ? AND c.institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)';
        params.push(user.campus_id, user.username);
    } else if (user.role === 'dean') {
        query += ' WHERE c.campus_id = ? AND c.institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)';
        params.push(user.campus_id, user.username);
    } else if (user.role === 'hod') {
        // HOD manages their specific department
        query += ' WHERE c.campus_id = ? AND c.institution_id = ? AND c.department_id = ?';
        params.push(user.campus_id, user.institution_id, user.department_id);
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ candidates: rows.map(c => selectionWorkflow.visibleCandidate(req.user,c)) });
    });
});

function isInterdisciplinaryProgram(appliedDept, pgDegree, pgSpecialization) {
    if (!appliedDept) return false;
    const cleanDept = appliedDept.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanDegree = (pgDegree || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanSpec = (pgSpecialization || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // If both degree and spec are completely empty, we assume not interdisciplinary
    if (!cleanDegree && !cleanSpec) return false;

    // Define mapping of department keywords to allowed specialization keywords
    const deptMappings = [
        {
            deptKeys: ['mechanical', 'mech'],
            specKeys: ['mechanic', 'manufactur', 'thermal', 'cad', 'cam', 'design', 'robot', 'automob', 'aerospace', 'product', 'industr', 'mechatronic', 'energy', 'metallurg', 'fluid', 'machine', 'materials']
        },
        {
            deptKeys: ['civil'],
            specKeys: ['civil', 'structur', 'geotech', 'environ', 'water', 'transport', 'construct', 'highway', 'infrastructure', 'soil', 'concrete']
        },
        {
            deptKeys: ['computer', 'cse', 'it', 'informationtechnology'],
            specKeys: ['comput', 'cse', 'it', 'software', 'information', 'data', 'ai', 'artificial', 'machine', 'ml', 'cyber', 'network', 'mca', 'msc', 'science', 'tech', 'system']
        },
        {
            deptKeys: ['electronics', 'ece', 'telecom', 'communication'],
            specKeys: ['electron', 'ece', 'communic', 'telecom', 'vlsi', 'embed', 'signal', 'microelectron', 'wireless', 'microwave', 'instrument', 'control']
        },
        {
            deptKeys: ['electrical', 'eee'],
            specKeys: ['electr', 'eee', 'power', 'control', 'energy', 'drive', 'machine', 'instrument', 'grid']
        },
        {
            deptKeys: ['biotech', 'biomed', 'biochem', 'microbiol', 'bio'],
            specKeys: ['bio', 'med', 'pharm', 'life', 'genet', 'molecular', 'clinical', 'health', 'microbiol']
        },
        {
            deptKeys: ['dent', 'oral', 'prosthodont', 'maxillo', 'periodont', 'endodont', 'pedodont'],
            specKeys: ['dent', 'mds', 'bds', 'prosthodont', 'orthodont', 'periodont', 'endodont', 'oral', 'maxillofacial', 'pathology', 'pedodont']
        },
        {
            deptKeys: ['management', 'admin', 'business', 'mgt'],
            specKeys: ['manag', 'mba', 'mgt', 'admin', 'business', 'hr', 'human', 'market', 'financ', 'system', 'operat', 'commerce']
        },
        {
            deptKeys: ['commerce', 'mcom'],
            specKeys: ['commerc', 'mcom', 'bcom', 'account', 'tax', 'financ', 'audit', 'banking', 'business', 'manag']
        },
        {
            deptKeys: ['math'],
            specKeys: ['math', 'stat', 'actuar']
        },
        {
            deptKeys: ['physic'],
            specKeys: ['physic', 'astron', 'astrophys', 'material']
        },
        {
            deptKeys: ['chemist'],
            specKeys: ['chemist', 'polymer', 'organic', 'inorganic']
        },
        {
            deptKeys: ['english'],
            specKeys: ['english', 'lit', 'lang']
        },
        {
            deptKeys: ['tamil'],
            specKeys: ['tamil', 'lit', 'lang']
        },
        {
            deptKeys: ['hindi'],
            specKeys: ['hindi', 'lit', 'lang']
        },
        {
            deptKeys: ['visual', 'viscom'],
            specKeys: ['visual', 'communic', 'media', 'film', 'journal', 'design', 'art', 'viscom']
        },
        {
            deptKeys: ['fashion', 'textil'],
            specKeys: ['fashion', 'textil', 'apparel', 'design', 'garment']
        },
        {
            deptKeys: ['occupational', 'therapy'],
            specKeys: ['occupational', 'therapy', 'ot', 'rehab', 'bot']
        },
        {
            deptKeys: ['psycholog'],
            specKeys: ['psycholog', 'clinical', 'counsel', 'mental']
        }
    ];

    // Find if applied department matches any of our known departments
    let matchedMapping = null;
    for (const mapping of deptMappings) {
        for (const key of mapping.deptKeys) {
            if (cleanDept.includes(key)) {
                matchedMapping = mapping;
                break;
            }
        }
        if (matchedMapping) break;
    }

    if (matchedMapping) {
        // Check if either PG degree or PG specialization contains any of the allowed keys
        const pgText = cleanDegree + ' ' + cleanSpec;
        for (const key of matchedMapping.specKeys) {
            if (pgText.includes(key)) {
                return false; // Found a match, therefore same discipline (not interdisciplinary)
            }
        }
        // If it's a known department, but PG details didn't match any allowed keys, it is interdisciplinary
        return true;
    }

    // Default fallback: if department has direct word overlap with degree or specialization, assume same discipline
    const deptWords = cleanDept.match(/[a-z]{4,}/g) || [];
    const pgCombined = cleanDegree + cleanSpec;
    for (const word of deptWords) {
        if (pgCombined.includes(word)) {
            return false; // Word overlap found
        }
    }

    // Otherwise, different discipline
    return true;
}

async function autoExtractCandidateMarks(candidateId) {
    return new Promise((resolve) => {
        // Find Application Form document and candidate's department name
        db.get(
            `SELECT doc.file_path, d.name as department_name 
             FROM candidate_documents doc
             JOIN candidates c ON doc.candidate_id = c.id
             JOIN departments d ON c.department_id = d.id
             WHERE doc.candidate_id = ? AND (doc.document_type = 'Application Form' OR doc.document_type = 'Application' OR doc.file_name LIKE 'Application Form_%') 
             LIMIT 1`,
            [candidateId],
            async (err, doc) => {
                if (err || !doc) return resolve(null);

                const fullPath = path.join(__dirname, 'public', doc.file_path);
                if (!fs.existsSync(fullPath)) return resolve(null);

                try {
                    const dataBuffer = fs.readFileSync(fullPath);
                    const uint8Array = new Uint8Array(dataBuffer);
                    const parser = new pdf.PDFParse(uint8Array);
                    const data = await parser.getText();
                    const text = data.text;

                    // Extract PG Details
                    let pgPercent = null;
                    let pgDegree = '';
                    let pgSpecialization = '';
                    const pgSectionMatch = text.match(/Post Graduate \(PG\) Details([\s\S]+?)(?:Additional PG Degree|Entrance Exam Details|Upload Files)/i);
                    if (pgSectionMatch) {
                        const pgSection = pgSectionMatch[1];
                        const pgPercentMatch = pgSection.match(/Total Percentage\s+([\d\.]+)/i);
                        if (pgPercentMatch) pgPercent = parseFloat(pgPercentMatch[1]);

                        const specMatch = pgSection.match(/Specialization\s+([A-Z\s&/,]+?)(?:Result|Total)/i);
                        if (specMatch) pgSpecialization = specMatch[1].trim();

                        const degreeMatch = pgSection.match(/Degree\s+([A-Z\s&/.\-+]+?)(?:Specialization)/i);
                        if (degreeMatch) pgDegree = degreeMatch[1].trim();
                    }

                    // Extract UG Details
                    let ugPercent = null;
                    const ugSectionMatch = text.match(/Under Graduate \(UG\) Details([\s\S]+?)(?:Post Graduate \(PG\) Details|Entrance Exam Details)/i);
                    if (ugSectionMatch) {
                        const ugSection = ugSectionMatch[1];
                        const ugPercentMatch = ugSection.match(/Total Percentage\s+([\d\.]+)/i);
                        if (ugPercentMatch) {
                            ugPercent = parseFloat(ugPercentMatch[1]);
                        } else {
                            const ugCgpaMatch = ugSection.match(/Obtained CGPA\s+([\d\.]+)/i);
                            if (ugCgpaMatch) {
                                // Convert CGPA out of 10 to percentage
                                ugPercent = parseFloat(ugCgpaMatch[1]) * 10;
                            }
                        }
                    }

                    const isInter = isInterdisciplinaryProgram(doc.department_name, pgDegree, pgSpecialization) ? 1 : 0;

                    db.run(
                        'UPDATE candidates SET pg_percentage = ?, ug_percentage = ?, is_interdisciplinary = ? WHERE id = ?',
                        [pgPercent, ugPercent, isInter, candidateId],
                        (err) => {
                            if (err) console.error("Failed to save auto-extracted marks:", err);
                            resolve({ pg_percentage: pgPercent, ug_percentage: ugPercent, is_interdisciplinary: isInter });
                        }
                    );
                } catch (parseErr) {
                    console.error("Error auto-extracting PDF marks:", parseErr);
                    resolve(null);
                }
            }
        );
    });
}

// Global Candidate Search API
app.get('/api/candidates/search', requireAuth(), (req, res) => {
    const q = req.query.q || '';
    if (!q || q.length < 2) return res.json([]);
    
    const user = req.user;
    
    let query = `
        SELECT c.id, c.application_no, c.registered_name, c.email, c.mobile, d.name as department_name, c.status 
        FROM candidates c
        LEFT JOIN departments d ON c.department_id = d.id
        WHERE (
            c.application_no LIKE ? OR 
            c.registered_name LIKE ? OR 
            c.email LIKE ? OR 
            c.mobile LIKE ? OR 
            d.name LIKE ?
        )
    `;
    let params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];

    // Role-based restrictions
    if (user.role !== 'super_admin') {
        query += ' AND c.campus_id = ?';
        params.push(user.campus_id);
    }
    
    if (user.role === 'coordinator') {
        query += ' AND c.institution_id = ?';
        params.push(user.institution_id);
    } else if (user.role === 'hod') {
        query += ' AND c.department_id = ?';
        params.push(user.department_id);
    }
    
    query += ' LIMIT 10';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/candidates/:id', requireAuth(), (req,res,next)=>transferWorkflow.authorizeCandidate(req,res,next), (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM candidates WHERE id = ?', [id], async (err, candidate) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

        candidate = selectionWorkflow.visibleCandidate(req.user,candidate);

        // Auto extract if marks are null in db OR if is_interdisciplinary is null
        if ((candidate.pg_percentage === null && candidate.ug_percentage === null) || candidate.is_interdisciplinary === null) {
            const extracted = await autoExtractCandidateMarks(candidate.id);
            if (extracted) {
                candidate.pg_percentage = extracted.pg_percentage;
                candidate.ug_percentage = extracted.ug_percentage;
                candidate.is_interdisciplinary = extracted.is_interdisciplinary;
            }
        }

        // Retrieve candidate certificates
        db.all('SELECT * FROM candidate_documents WHERE candidate_id = ?', [id], (err, docs) => {
            if (err) return res.status(500).json({ error: err.message });

            if (candidate.panel_id) {
                db.get('SELECT * FROM interview_panels WHERE id = ?', [candidate.panel_id], (err, panel) => {
                    if (err || !panel) {
                        return res.json({ candidate, documents: docs, panel: null });
                    }
                    db.all('SELECT * FROM panel_members WHERE panel_id = ?', [candidate.panel_id], (err, members) => {
                        if (err) {
                            return res.json({ candidate, documents: docs, panel: { panel_name: panel.panel_name, members: [] } });
                        }
                        res.json({
                            candidate,
                            documents: docs,
                            panel: {
                                id: panel.id,
                                panel_name: panel.panel_name,
                                members: members
                            }
                        });
                    });
                });
            } else {
                res.json({ candidate, documents: docs, panel: null });
            }
        });
    });
});

app.post('/api/candidates/download-documents-zip', requireAuth(), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: 'No candidate IDs provided' });
    }

    const user = req.user;
    const ids = candidateIds.slice(0, 1000);
    const placeholders = ids.map(() => '?').join(',');

    let query = `
        SELECT c.id, c.application_no, c.registered_name,
               i.name as institution_name, d.name as department_name, camp.name as campus_name
        FROM candidates c
        JOIN institutions i ON c.institution_id = i.id
        JOIN departments d ON c.department_id = d.id
        JOIN campuses camp ON c.campus_id = camp.id
        WHERE c.id IN (${placeholders})
    `;
    let params = [...ids];

    if (user.role === 'admin') {
        query += ' AND c.campus_id = ?';
        params.push(user.campus_id);
    } else if (user.role === 'coordinator') {
        query += ' AND c.campus_id = ? AND c.institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)';
        params.push(user.campus_id, user.username);
    } else if (user.role === 'hod') {
        query += ' AND c.campus_id = ? AND c.institution_id = ? AND c.department_id = ?';
        params.push(user.campus_id, user.institution_id, user.department_id);
    }

    db.all(query, params, (err, candidates) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!candidates || candidates.length === 0) {
            return res.status(404).json({ error: 'No matching candidates found' });
        }

        const candidateMap = {};
        candidates.forEach(c => {
            candidateMap[c.id] = c;
        });

        const targetIds = candidates.map(c => c.id);
        const docPlaceholders = targetIds.map(() => '?').join(',');

        db.all(`SELECT * FROM candidate_documents WHERE candidate_id IN (${docPlaceholders})`, targetIds, (err, docs) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!docs || docs.length === 0) {
                return res.status(404).json({ error: 'No documents found for matching candidates' });
            }

            const zip = new PizzaZip();
            let addedFilesCount = 0;

            docs.forEach(doc => {
                const cand = candidateMap[doc.candidate_id];
                if (!cand) return;

                const cleanName = (str) => (str || '').replace(/[\\/:*?"<>|]/g, '_').trim();
                
                const deptFolder = cleanName(cand.department_name);
                const instFolder = cleanName(cand.institution_name);
                const candFolder = cleanName(`${cand.application_no}_${cand.registered_name}`);
                
                const physicalPath = path.join(__dirname, 'public', doc.file_path);
                
                if (fs.existsSync(physicalPath)) {
                    try {
                        const fileContent = fs.readFileSync(physicalPath);
                        const zipPath = `${deptFolder}/${instFolder}/${candFolder}/${cleanName(doc.document_type)}_${cleanName(doc.file_name)}`;
                        zip.file(zipPath, fileContent, { binary: true });
                        addedFilesCount++;
                    } catch (readErr) {
                        console.error(`Error reading document file ${physicalPath}:`, readErr);
                    }
                }
            });

            if (addedFilesCount === 0) {
                return res.status(404).json({ error: 'No files physically found on server for the selected candidates' });
            }

            try {
                const zipBuffer = zip.generate({ type: 'nodebuffer' });
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename=PhD_Candidate_Documents.zip');
                res.send(zipBuffer);
            } catch (zipErr) {
                console.error('Error generating zip:', zipErr);
                res.status(500).json({ error: 'Failed to generate ZIP archive' });
            }
        });
    });
});

// Delete candidates (Admin and Super Admin only)
app.delete('/api/admin/candidates', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    }

    const placeholders = candidateIds.map(() => '?').join(',');
    
    // First, fetch the associated documents to delete the physical files
    db.all(`SELECT file_path FROM candidate_documents WHERE candidate_id IN (${placeholders})`, candidateIds, (err, rows) => {
        if (!err && rows) {
            rows.forEach(row => {
                try {
                    const fullPath = path.join(__dirname, row.file_path);
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                    }
                } catch (e) {
                    console.error("Failed to delete physical file:", e);
                }
            });
        }

        // Delete from documents table
        db.run(`DELETE FROM candidate_documents WHERE candidate_id IN (${placeholders})`, candidateIds, function(err1) {
            if (err1) {
                return res.status(500).json({ error: 'Failed to delete associated documents' });
            }

            // Delete from candidates table
            db.run(`DELETE FROM candidates WHERE id IN (${placeholders})`, candidateIds, function(err2) {
                if (err2) {
                    return res.status(500).json({ error: 'Failed to delete candidates' });
                }
                
                logAudit(req, 'DELETE_CANDIDATES', `Deleted ${this.changes} candidates with IDs: ${candidateIds.join(', ')}`, candidateIds.join(', '));
                res.json({ success: true, message: `Successfully deleted ${this.changes} candidates.` });
            });
        });
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — ELIGIBILITY CHAIN
// Flow (down): Admin → Dean → RC → HOD
// Flow (up):   HOD → RC → Dean → Admin
// Every return requires a mandatory remark/query statement.
// ══════════════════════════════════════════════════════════════════════════════

// Helper: require remark for return actions
function requireRemark(remark, res) {
    if (!remark || !remark.trim()) {
        res.status(400).json({ error: 'A query / remark is required when returning a candidate.' });
        return false;
    }
    return true;
}

// ── ADMIN ACTIONS ────────────────────────────────────────────────────────────

// Admin forwards Complete candidates to Dean (Pending Verification → Under Dean Review)
app.post('/api/admin/forward-to-dean', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Dean', status = 'Under Dean Review', return_remark = NULL
         WHERE id IN (${placeholders}) AND campus_id = ? AND current_owner = 'Admin'
         AND (status = 'Pending Verification' OR (campus_id=2 AND status='Complete'))
         AND institution_id NOT IN (100,101) AND department_id NOT IN (100,101)`,
        [...candidateIds, req.user.campus_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'ADMIN_FORWARD_DEAN', `Forwarded ${this.changes} candidates to Dean. IDs: ${candidateIds.join(', ')}`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate(s) to Dean for review.` });
        }
    );
});

// Admin forwards Incomplete (mapped) candidates directly to HOD
app.post('/api/admin/forward-incomplete-to-hod', requireAuth(['admin', 'super_admin']), (req,res) => {
    const {candidateIds}=req.body;
    if (!Array.isArray(candidateIds) || !candidateIds.length) return res.status(400).json({error:'Invalid candidate IDs'});
    const owner='HOD';
    const status='Under HOD Verification';
    db.run(`UPDATE candidates SET current_owner=?,status=? WHERE id IN (${candidateIds.map(()=>'?').join(',')}) AND campus_id=? AND status='Incomplete' AND current_owner='Admin' AND institution_id NOT IN (100,101) AND department_id NOT IN (100,101)`, [owner,status,...candidateIds,req.user.campus_id],function(error){
        if(error)return res.status(500).json({error:error.message});
        logAudit(req,'ADMIN_FORWARD_HOD_INCOMPLETE',`Forwarded ${this.changes} incomplete applications to ${owner}.`);
        res.json({success:true,forwarded_count:this.changes,message:`Forwarded ${this.changes} incomplete application(s) to ${owner}.`});
    });
});

// Admin returns candidate to Dean with a query (after seeing Eligible/Not Eligible result)
app.post('/api/admin/return-to-dean', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    if (!requireRemark(remark, res)) return;
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Dean', status = 'Returned to Dean', return_remark = ?
         WHERE id IN (${placeholders}) AND campus_id = ? AND status IN ('Eligible', 'Not Eligible')`,
        [remark.trim(), ...candidateIds, req.user.campus_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'ADMIN_RETURN_DEAN', `Returned ${this.changes} candidates to Dean with query. IDs: ${candidateIds.join(', ')}`);
            res.json({ success: true, message: `Returned ${this.changes} candidate(s) to Dean with your query.` });
        }
    );
});

// Admin returns guide selections to Dean with a query
app.post('/api/admin/return-selections-to-dean', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    if (!requireRemark(remark, res)) return;
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Dean', status = 'Returned to Dean (Final)', return_remark = ?
         WHERE id IN (${placeholders}) AND campus_id = ? AND current_owner='Admin' AND status = 'Approved Guides'`,
        [remark.trim(), ...candidateIds, req.user.campus_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'ADMIN_RETURN_DEAN_FINAL', `Returned ${this.changes} guide selections to Dean with query.`);
            res.json({ success: true, message: `Returned ${this.changes} guide selection(s) to Dean with your query.` });
        }
    );
});

const selectionWorkflow = require('./lib/selection-workflow')({app,db,dbPath,sqlite3,requireAuth,logAudit,io});

// Rank publication is shared by both campuses.

// ── DEAN ACTIONS ─────────────────────────────────────────────────────────────

// Dean forwards eligibility candidates to RC (Under Dean Review → Under RC Review)
app.post('/api/dean/forward-to-rc', requireAuth(['dean']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'RC', status = 'Under RC Review', return_remark = NULL
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)
         AND status IN ('Under Dean Review', 'Returned to Dean')`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'DEAN_FORWARD_RC', `Forwarded ${this.changes} candidates to RC.`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate(s) to Research Coordinator.` });
        }
    );
});

// Dean returns to RC with query
app.post('/api/dean/return-to-rc', requireAuth(['dean']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    if (!requireRemark(remark, res)) return;
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'RC', status = 'Returned to RC', return_remark = ?
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)
         AND (status IN ('Under Dean Review', 'Returned to Dean', 'Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible') OR current_owner = 'Dean')`,
        [remark.trim(), ...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'DEAN_RETURN_RC', `Returned ${this.changes} candidates to RC with query.`);
            res.json({ success: true, message: `Returned ${this.changes} candidate(s) to RC with your query.` });
        }
    );
});

// Dean finalises eligibility and forwards to Admin (Eligible / Not Eligible)
app.post('/api/dean/forward-eligibility-to-admin', requireAuth(['dean']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    // Status is derived from the HOD's original verdict stored in status_reason flag or current status:
    // HOD Verified Eligible / Eligible → Eligible, HOD Verified Ineligible / Not Eligible → Not Eligible
    db.run(
        `UPDATE candidates
         SET current_owner = 'Admin',
             status = CASE
               WHEN status_reason = 'Not Eligible' OR status IN ('Verified Ineligible', 'HOD Verified Ineligible') THEN 'Not Eligible'
               ELSE 'Eligible'
             END,
             return_remark = NULL
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)
         AND (status IN ('Under Dean Review', 'Returned to Dean', 'Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible') OR current_owner = 'Dean')`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'DEAN_FORWARD_ADMIN_ELIGIBLE', `Forwarded ${this.changes} eligibility verdicts to Admin.`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate(s) eligibility to Admin.` });
        }
    );
});

// Dean forwards ranked list to RC (Phase 2)

// Dean returns guide selections to RC with query (Phase 2)
app.post('/api/dean/return-selections-to-rc', requireAuth(['dean']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    if (!requireRemark(remark, res)) return;
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'RC', status = 'Returned to RC (Guides)', return_remark = ?
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)
         AND current_owner='Dean' AND status IN ('Under Dean Final Review', 'Returned to Dean (Final)')`,
        [remark.trim(), ...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'DEAN_RETURN_RC_GUIDES', `Returned ${this.changes} guide selections to RC with query.`);
            res.json({ success: true, message: `Returned ${this.changes} guide selection(s) to RC with your query.` });
        }
    );
});

// Dean approves guide selections and forwards to Admin (Phase 2)
app.post('/api/dean/forward-selections-to-admin', requireAuth(['dean']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Admin', status = 'Approved Guides', return_remark = NULL
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)
         AND current_owner='Dean' AND status IN ('Under Dean Final Review', 'Returned to Dean (Final)')`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'DEAN_FORWARD_SELECTIONS_ADMIN', `Approved ${this.changes} guide selections and forwarded to Admin.`);
            res.json({ success: true, message: `Approved and forwarded ${this.changes} guide selection(s) to Admin.` });
        }
    );
});

// ── RC (COORDINATOR) ACTIONS ─────────────────────────────────────────────────

// RC forwards eligibility candidates to HOD
function requireTrichyHodRecipients(req,res,next) {
    if (Number(req.user.campus_id)!==2 || !Array.isArray(req.body.candidateIds) || !req.body.candidateIds.length) return next();
    const ids=req.body.candidateIds;
    db.all(`SELECT DISTINCT d.name department_name,i.name institution_name FROM candidates c JOIN departments d ON c.department_id=d.id JOIN institutions i ON c.institution_id=i.id WHERE c.id IN (${ids.map(()=>'?').join(',')}) AND c.campus_id=2 AND i.coord_username=? AND c.status IN ('Under RC Review','Returned to RC') AND NOT EXISTS(SELECT 1 FROM users u WHERE u.role='hod' AND u.campus_id=c.campus_id AND u.institution_id=c.institution_id AND u.department_id=c.department_id)`,[...ids,req.user.username],(error,missing)=>{
        if(error)return res.status(500).json({error:error.message});
        if(missing.length)return res.status(400).json({error:'No HoD account is assigned for: '+missing.map(d=>d.department_name+' ('+d.institution_name+')').join(', ')+'. Assign a HoD before forwarding.'});
        next();
    });
}
app.post('/api/rc/forward-to-hod', requireAuth(['coordinator']), requireTrichyHodRecipients, (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'HOD', status = 'Under HOD Verification', return_remark = NULL
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)
         AND status IN ('Under RC Review', 'Returned to RC')`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_FORWARD_HOD', `Forwarded ${this.changes} candidates to HOD.`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate(s) to HOD for eligibility verification.` });
        }
    );
});

// RC returns candidate to HOD with a query
app.post('/api/rc/return-to-hod', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    if (!requireRemark(remark, res)) return;
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'HOD', status = 'Returned to HOD', return_remark = ?
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)
         AND (status IN ('Under RC Review', 'Under HOD Verification', 'HOD Verified Eligible', 'HOD Verified Ineligible', 'Verified Eligible', 'Verified Ineligible', 'Under Coordinator Review', 'Returned to RC') OR current_owner IN ('RC', 'Coordinator'))`,
        [remark.trim(), ...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_RETURN_HOD', `Returned ${this.changes} candidates to HOD with query.`);
            res.json({ success: true, message: `Returned ${this.changes} candidate(s) to HOD with your query.` });
        }
    );
});

// RC forwards to Dean after HOD eligibility check
app.post('/api/rc/forward-to-dean', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates 
         SET current_owner = 'Dean', 
             status = 'Under Dean Review', 
             return_remark = NULL,
             status_reason = COALESCE(status_reason, CASE WHEN status IN ('Verified Ineligible', 'HOD Verified Ineligible') THEN 'Not Eligible' ELSE 'Eligible' END)
         WHERE id IN (${placeholders}) 
           AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)
           AND (status IN ('Under RC Review', 'Returned to RC', 'Under Coordinator Review', 'Verified Eligible', 'Verified Ineligible', 'HOD Verified Eligible', 'HOD Verified Ineligible') OR current_owner IN ('RC', 'Coordinator'))`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_FORWARD_DEAN', `Forwarded ${this.changes} candidates to Dean.`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate(s) to Dean for review.` });
        }
    );
});

// RC forwards ranked list to HOD for guide allocation (Phase 2)

// RC returns guide selections to HOD with query (Phase 2)
app.post('/api/rc/return-selections-to-hod', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    if (!requireRemark(remark, res)) return;
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'HOD', status = 'Returned to HOD (Guides)', return_remark = ?
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)
         AND current_owner IN ('RC','Coordinator') AND status IN ('Selection Finalized', 'Returned to RC (Guides)')`,
        [remark.trim(), ...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_RETURN_HOD_GUIDES', `Returned ${this.changes} guide selections to HOD with query.`);
            res.json({ success: true, message: `Returned ${this.changes} guide selection(s) to HOD with your query.` });
        }
    );
});

// RC forwards guide selections to Dean (Phase 2)
app.post('/api/rc/forward-selections-to-dean', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Dean', status = 'Under Dean Final Review', return_remark = NULL
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)
         AND current_owner IN ('RC','Coordinator') AND status IN ('Selection Finalized', 'Returned to RC (Guides)')`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_FORWARD_SELECTIONS_DEAN', `Forwarded ${this.changes} guide selections to Dean.`);
            res.json({ success: true, message: `Forwarded ${this.changes} guide selection(s) to Dean for review.` });
        }
    );
});

// ── HOD ACTIONS ──────────────────────────────────────────────────────────────

// HOD forwards verified candidates up to RC
app.post('/api/hod/forward-to-rc', requireAuth(['hod']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates
         SET current_owner = 'RC',
             status = 'Under RC Review',
             return_remark = NULL,
             status_reason = CASE WHEN status = 'HOD Verified Eligible' THEN 'Eligible' ELSE 'Not Eligible' END
         WHERE id IN (${placeholders}) AND department_id = ?
         AND status IN ('HOD Verified Eligible', 'HOD Verified Ineligible', 'Returned to HOD', 'Under HOD Verification')`,
        [...candidateIds, req.user.department_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'HOD_FORWARD_RC', `Forwarded ${this.changes} candidates to RC.`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate(s) to Research Coordinator.` });
        }
    );
});

// HOD forwards guide selections to RC (Phase 2)
app.post('/api/hod/forward-selections-to-rc', requireAuth(['hod']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0)
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'RC', status = 'Selection Finalized', return_remark = NULL
         WHERE id IN (${placeholders}) AND department_id = ? AND current_owner='HOD'
         AND status IN ('Guide Allocated', 'Guide Allocation Open', 'Returned to HOD (Guides)')`,
        [...candidateIds, req.user.department_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'HOD_FORWARD_SELECTIONS_RC', `Forwarded ${this.changes} guide selections to RC.`);
            res.json({ success: true, message: `Forwarded ${this.changes} guide selection(s) to Research Coordinator.` });
        }
    );
});



// HOD eligibility verify
app.post('/api/candidates/:id/verify', requireAuth(['hod']), (req, res) => {
    const { id } = req.params;
    const { eligibility, reason, pg_percentage, ug_percentage } = req.body; // Eligible or Not Eligible

    if (!['Eligible', 'Not Eligible'].includes(eligibility)) {
        return res.status(400).json({ error: 'Invalid eligibility status' });
    }

    db.get("SELECT value FROM settings WHERE key = 'deadline_eligibility'", [], (err, row) => {
        if (err) return res.status(500).json({ error: 'Failed to check deadlines' });
        if (row && row.value) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(row.value);
            deadlineDate.setHours(0, 0, 0, 0);
            if (today > deadlineDate) {
                return res.status(403).json({ error: 'The deadline for eligibility verification has passed.' });
            }
        }

        // Only allow verification if candidate is still pending HOD verification
    db.get(
        'SELECT id, status FROM candidates WHERE id = ? AND department_id = ?',
        [id, req.user.department_id],
        (err, candidate) => {
            if (err) return res.status(500).json({ error: err.message });
            const allowedStatuses = ['Under HOD Verification', 'HOD Verified Eligible', 'HOD Verified Ineligible', 'Returned to HOD', 'Pending Verification', 'Complete'];
            if (!allowedStatuses.includes(candidate.status)) {
                return res.status(400).json({ error: `Eligibility cannot be changed. Candidate status is already '${candidate.status}'.` });
            }

            const newStatus = eligibility === 'Eligible' ? 'HOD Verified Eligible' : 'HOD Verified Ineligible';
            db.run(
                'UPDATE candidates SET status = ?, status_reason = ?, pg_percentage = ?, ug_percentage = ? WHERE id = ? AND department_id = ?',
                [newStatus, reason || null, pg_percentage ? parseFloat(pg_percentage) : null, ug_percentage ? parseFloat(ug_percentage) : null, id, req.user.department_id],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Candidate not found in your department' });
                    logAudit(req, 'VERIFY_CANDIDATE', `Verified candidate ${id} as ${eligibility}`);
                    res.json({ success: true, message: `Verification status updated to ${eligibility}` });
                }
            );
        }
    );
    });
});

// HOD forward verified candidates back up: HOD -> RC
app.post('/api/hod/forward-verified', requireAuth(['hod']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    }

    db.get("SELECT value FROM settings WHERE key = 'deadline_eligibility'", [], (err, row) => {
        if (err) return res.status(500).json({ error: 'Failed to check deadlines' });
        if (row && row.value) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(row.value);
            deadlineDate.setHours(0, 0, 0, 0);
            if (today > deadlineDate) {
                return res.status(403).json({ error: 'The deadline for eligibility verification has passed.' });
            }
        }

        const placeholders = candidateIds.map(() => '?').join(',');
        db.run(
            `UPDATE candidates 
             SET current_owner = 'RC', 
                 status = 'Under RC Review',
                 return_remark = NULL,
                 status_reason = CASE WHEN status = 'HOD Verified Eligible' THEN 'Eligible' ELSE 'Not Eligible' END 
             WHERE id IN (${placeholders}) AND department_id = ?`,
            [...candidateIds, req.user.department_id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                logAudit(req, 'HOD_FORWARD', `Forwarded ${this.changes} verified candidates. IDs: ${candidateIds.join(', ')}`);
                res.json({ success: true, message: `Forwarded ${this.changes} candidate verification statuses to Research Coordinator.` });
            }
        );
    });
});

// Coordinator forward to Dean (alias)
app.post('/api/coordinator/forward-to-dean', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    }

    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates 
         SET current_owner = 'Dean',
             status = 'Under Dean Review',
             return_remark = NULL,
             status_reason = COALESCE(status_reason, CASE WHEN status IN ('Verified Ineligible', 'HOD Verified Ineligible') THEN 'Not Eligible' ELSE 'Eligible' END)
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_FORWARD_DEAN', `Forwarded ${this.changes} verified candidates to Dean. IDs: ${candidateIds.join(', ')}`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidate verified statuses to Dean.` });
        }
    );
});

// Coordinator return to HOD for correction (alias)
app.post('/api/coordinator/return-to-hod', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds, remark } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    }

    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates 
         SET current_owner = 'HOD', 
             status = 'Returned to HOD',
             return_remark = ?
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)`,
        [remark ? remark.trim() : 'Returned for query', ...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'RC_RETURN_HOD', `Returned ${this.changes} candidates to HOD. IDs: ${candidateIds.join(', ')}`);
            res.json({ success: true, message: `Returned ${this.changes} candidate(s) to HOD for correction.` });
        }
    );
});

// --- DEAN APIS ---
app.post('/api/dean/forward-to-admin', requireAuth(['dean']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) return res.status(400).json({ error: 'Invalid IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates 
         SET current_owner = 'Admin', 
             status = CASE
               WHEN status_reason = 'Not Eligible' OR status IN ('Verified Ineligible', 'HOD Verified Ineligible') THEN 'Not Eligible'
               ELSE 'Eligible'
             END,
             return_remark = NULL
         WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'DEAN_FORWARD_ADMIN', `Forwarded ${this.changes} candidates to Admin. IDs: ${candidateIds.join(', ')}`);
            res.json({ success: true, message: `Forwarded ${this.changes} candidates to Admin.` });
        }
    );
});

app.post('/api/dean/forward-selections-to-admin', requireAuth(['dean']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) return res.status(400).json({ error: 'Invalid IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Admin', status = 'Approved Guides' WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: `Forwarded ${this.changes} selections to Admin.` });
        }
    );
});

app.post('/api/dean/return-selections-to-rc', requireAuth(['dean']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) return res.status(400).json({ error: 'Invalid IDs' });
    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates SET current_owner = 'Coordinator', status = 'Selection Finalized' WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE dean_username = ?)`,
        [...candidateIds, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: `Returned ${this.changes} selections to Coordinator.` });
        }
    );
});

// --- TRANSFER REQUESTS API ---
const transferWorkflow = require('./lib/transfer-workflow')({app,db,dbPath,sqlite3,requireAuth,logAudit,resolveAdmissionMapping});

// --- MARKS ENTRY & RANKS API ---
app.post('/api/admin/candidates/:id/attendance', requireAuth(['admin']), (req, res) => {
    const { id } = req.params;
    const { attendance } = req.body; // Present, Absent, Exempted

    if (!['Present', 'Absent', 'Exempted'].includes(attendance)) {
        return res.status(400).json({ error: 'Invalid attendance value' });
    }

    db.get('SELECT * FROM candidates WHERE id = ? AND campus_id = ?', [id, req.user.campus_id], (err, candidate) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

        if (attendance === 'Absent') {
            db.run(
                `UPDATE candidates 
                 SET exam_attendance = 'Absent', 
                     status = 'Entrance Exam Absent', 
                     selection_status = 'Not Selected', 
                     rank = NULL 
                 WHERE id = ? AND campus_id = ?`,
                [id, req.user.campus_id],
                function(updateErr) {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    
                    // If candidate was ranked, automatically re-align the remaining ranks in their department
                    if (candidate.rank || candidate.status === 'Ranked') {
                        recalculateDepartmentRanks(candidate.department_id, req.user.campus_id, () => {
                            res.json({ success: true, message: 'Exam attendance marked as Absent. Candidate moved to Not Selected.' });
                        });
                    } else {
                        res.json({ success: true, message: 'Exam attendance marked as Absent. Candidate moved to Not Selected.' });
                    }
                }
            );
        } else {
            const nextStatus = candidate.status === 'Ranked' ? 'Ranked' : (candidate.total_marks !== null && candidate.total_marks !== undefined ? 'Marks Entered' : 'Entrance Exam Attended');
            db.run(
                `UPDATE candidates 
                 SET exam_attendance = ?, 
                     status = ?,
                     selection_status = 'Pending Selection'
                 WHERE id = ? AND campus_id = ?`,
                [attendance, nextStatus, id, req.user.campus_id],
                function(updateErr) {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    res.json({ success: true, message: `Exam attendance marked as ${attendance}` });
                }
            );
        }
    });
});

app.get('/api/admin/supervisors/department/:deptId', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { deptId } = req.params;
    db.all('SELECT * FROM supervisors WHERE department_id = ? ORDER BY name ASC', [deptId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ supervisors: rows || [] });
    });
});

// Shared ranking function for a list of candidates
function rankCandidatesList(candidates, callback) {
    if (!candidates || candidates.length === 0) {
        if (callback) callback(null, 0);
        return;
    }

    // Group candidates by Department ID
    const groups = {};
    candidates.forEach(c => {
        const grpKey = c.department_id;
        if (!groups[grpKey]) groups[grpKey] = [];
        groups[grpKey].push(c);
    });

    const updates = [];

    Object.keys(groups).forEach(deptId => {
        const list = groups[deptId];
        
        // Separate lists
        const fullTimeWF = [];
        const fullTimeSS = [];
        const fullTimeUnspecified = [];
        const otherMode = [];
        const partTime = [];

        list.forEach(c => {
            // Keep every finalized score; column CO alone determines its rank pool.
            const category = studyModePolicy.classifyStudyMode(c);
            if (category === 'full_time_with_fellowship') fullTimeWF.push(c);
            else if (category === 'full_time_without_fellowship') fullTimeSS.push(c);
            else if (category === 'full_time_unspecified') fullTimeUnspecified.push(c);
            else if (category === 'part_time') partTime.push(c);
            else otherMode.push(c);
        });

        // Helper to sort and rank
        const rankGroup = (group) => {
            group.sort((a, b) => b.total_marks - a.total_marks);
            group.forEach((c, idx) => {
                const newStatus = (c.status === 'Marks Entered' || c.status === 'Eligible' || c.status === 'Entrance Exam Attended' || c.status === 'Evaluated (Failed Cutoff)') ? 'Ranked' : c.status;
                const newSelectionStatus = (c.status === 'Marks Entered' || c.status === 'Eligible' || c.status === 'Entrance Exam Attended' || c.status === 'Evaluated (Failed Cutoff)' || !c.selection_status || c.selection_status === 'Pending Selection') ? 'Eligible for Selection' : c.selection_status;
                updates.push({ id: c.id, rank: idx + 1, selection_status: newSelectionStatus, status: newStatus });
            });
        };

        // Rank each pool independently
        rankGroup(fullTimeWF);
        rankGroup(fullTimeSS);
        rankGroup(fullTimeUnspecified);
        rankGroup(partTime);
        rankGroup(otherMode);
    });

    if (updates.length === 0) {
        if (callback) callback(null, 0);
        return;
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare('UPDATE candidates SET rank = ?, selection_status = ?, status = ? WHERE id = ?');
        updates.forEach(u => {
            stmt.run(u.rank, u.selection_status, u.status, u.id);
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (callback) callback(err, updates.length);
        });
    });
}

// Helper to recalculate ranks for an already-ranked department
function recalculateDepartmentRanks(departmentId, campusId, callback) {
    if (!departmentId || !campusId) {
        if (callback) callback(null);
        return;
    }

    db.all(`
        SELECT c.*, d.name as dept_name 
        FROM candidates c
        JOIN departments d ON c.department_id = d.id
        WHERE c.campus_id = ? AND c.department_id = ?
          AND c.total_marks IS NOT NULL
          AND c.status IN ('Ranked', 'Ranks Released', 'Under Dean Review (Ranks)', 'Under RC Review (Ranks)', 'Guide Allocation Open', 'Guide Allocated', 'Selection Finalized', 'Under Dean Final Review', 'Returned to HOD (Guides)', 'Returned to RC (Guides)', 'Returned to Dean (Final)', 'Approved Guides', 'Evaluated (Failed Cutoff)')
          AND (c.exam_attendance IS NULL OR c.exam_attendance != 'Absent')
          AND (c.selection_status IS NULL OR c.selection_status != 'Not Selected' OR c.rank IS NOT NULL OR c.status = 'Evaluated (Failed Cutoff)')
    `, [campusId, departmentId], (err, candidates) => {
        if (err || !candidates || candidates.length === 0) {
            if (callback) callback(err);
            return;
        }
        rankCandidatesList(candidates, callback);
    });
}

app.post('/api/admin/candidates/:id/marks', requireAuth(['admin']), (req, res) => {
    const { id } = req.params;
    const { written_marks, interview_marks_1, interview_marks_2, interview_marks_3, interview_marks_4, interview_marks_5, preference_1, preference_2 } = req.body;

    db.get('SELECT * FROM candidates WHERE id = ? AND campus_id = ?', [id, req.user.campus_id], (err, candidate) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

        let written = parseFloat(written_marks) || 0;
        let int1 = parseFloat(interview_marks_1) || 0;
        let int2 = parseFloat(interview_marks_2) || 0;
        let int3 = parseFloat(interview_marks_3) || 0;
        let int4 = parseFloat(interview_marks_4) || 0;
        let int5 = parseFloat(interview_marks_5) || 0;
        let pref1 = preference_1 || null;
        let pref2 = preference_2 || null;

        let scaledWritten = candidate.exam_attendance === 'Exempted' ? 70.0 : (written * 1.4); // 50 marks -> 70 marks scaling

        if (candidate.panel_id) {
            db.all('SELECT * FROM panel_members WHERE panel_id = ?', [candidate.panel_id], (err, members) => {
                if (err) return res.status(500).json({ error: err.message });
                const N = members.length;
                let avgInterview = 0;
                if (N > 0) {
                    const marks = [int1, int2, int3, int4, int5];
                    let sum = 0;
                    for (let i = 0; i < N; i++) {
                        sum += marks[i];
                    }
                    avgInterview = sum / N;
                } else {
                    avgInterview = (int1 + int2 + int3) / 3;
                }
                saveMarks(avgInterview);
            });
        } else {
            let avgInterview = (int1 + int2 + int3) / 3;
            saveMarks(avgInterview);
        }

        function saveMarks(avgInterview) {
            let total = scaledWritten + avgInterview;
            const isRankedCandidate = ['Ranked', 'Ranks Released', 'Under Dean Review (Ranks)', 'Under RC Review (Ranks)', 'Guide Allocation Open', 'Guide Allocated', 'Selection Finalized', 'Under Dean Final Review', 'Returned to HOD (Guides)', 'Returned to RC (Guides)', 'Returned to Dean (Final)', 'Approved Guides'].includes(candidate.status) || (candidate.rank !== null && candidate.rank !== undefined);
            const targetStatus = isRankedCandidate ? candidate.status : 'Marks Entered';

            db.run(
                `UPDATE candidates SET 
                    written_marks = ?, 
                    interview_marks_1 = ?, 
                    interview_marks_2 = ?, 
                    interview_marks_3 = ?, 
                    interview_marks_4 = ?,
                    interview_marks_5 = ?,
                    scaled_written_marks = ?, 
                    avg_interview_marks = ?, 
                    total_marks = ?,
                    preference_1 = ?,
                    preference_2 = ?,
                    selection_status = CASE WHEN status = 'Evaluated (Failed Cutoff)' THEN 'Pending Selection' ELSE selection_status END,
                    status = ?
                 WHERE id = ?`,
                [written, int1, int2, int3, int4, int5, scaledWritten, avgInterview, total, pref1, pref2, targetStatus, id],
                function(updateErr) {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    
                    if (isRankedCandidate) {
                        recalculateDepartmentRanks(candidate.department_id, req.user.campus_id, (recalcErr) => {
                            if (recalcErr) console.error("Error recalculating department ranks:", recalcErr);
                            res.json({ 
                                success: true, 
                                message: 'Marks updated and ranks re-aligned successfully.',
                                data: { scaledWritten, avgInterview, total }
                            });
                        });
                    } else {
                        res.json({ 
                            success: true, 
                            message: 'Marks entered and scaled successfully.',
                            data: { scaledWritten, avgInterview, total }
                        });
                    }
                }
            );
        }
    });
});

app.post('/api/admin/return-to-coordinator', requireAuth(['admin']), (req, res) => {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: 'Invalid candidate IDs' });
    }

    const placeholders = candidateIds.map(() => '?').join(',');
    db.run(
        `UPDATE candidates 
         SET current_owner = 'Coordinator', 
             status = 'Under Coordinator Review'
         WHERE id IN (${placeholders}) AND campus_id = ?`,
        [...candidateIds, req.user.campus_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req, 'ADMIN_RETURN_RC', `Returned ${this.changes} candidates to RC. IDs: ${candidateIds.join(', ')}`);
            res.json({ success: true, message: `Returned ${this.changes} candidate(s) to Coordinator for correction.` });
        }
    );
});

app.post('/api/admin/generate-ranks', requireAuth(['admin','super_admin']), (req, res) => {
    const campusId = req.user.role === 'super_admin' ? Number(req.body?.campus_id) : req.user.campus_id;
    if (!Number.isInteger(Number(campusId)) || Number(campusId)<1) return res.status(400).json({error:'Choose a campus for rank generation.'});
    const { department_name, department_id } = req.body || {};
    
    let whereClause = `WHERE c.campus_id = ? AND c.total_marks IS NOT NULL AND c.status IN ('Eligible', 'Marks Entered', 'Ranked', 'Ranks Released', 'Under Dean Review (Ranks)', 'Under RC Review (Ranks)', 'Guide Allocation Open', 'Guide Allocated', 'Selection Finalized', 'Under Dean Final Review', 'Returned to HOD (Guides)', 'Returned to RC (Guides)', 'Returned to Dean (Final)', 'Approved Guides', 'Evaluated (Failed Cutoff)') AND (c.exam_attendance IS NULL OR c.exam_attendance != 'Absent') AND (c.selection_status IS NULL OR c.selection_status != 'Not Selected' OR c.rank IS NOT NULL OR c.status = 'Evaluated (Failed Cutoff)')`;
    const params = [campusId];

    if (department_id) {
        whereClause += ` AND c.department_id = ?`;
        params.push(department_id);
    } else if (department_name) {
        whereClause += ` AND d.name = ?`;
        params.push(department_name);
    }

    db.all(`
        SELECT c.*, d.name as dept_name 
        FROM candidates c
        JOIN departments d ON c.department_id = d.id
        ${whereClause}
    `, params, (err, candidates) => {
        if (err) return res.status(500).json({ error: err.message });

        if (!candidates || candidates.length === 0) {
            return res.status(400).json({ error: department_name ? `No candidates with finalized marks found to rank in Department of ${department_name}.` : 'No candidates with finalized marks available to rank.' });
        }

        rankCandidatesList(candidates, (rankErr) => {
            if (rankErr) return res.status(500).json({ error: rankErr.message });
            const successMsg = department_name ? `Ranked and evaluated candidates for Department of ${department_name}. Ranks are ready to release to all relevant users.` : `Ranked and evaluated candidates.`;
            res.json({ success: true, message: successMsg });
        });
    });
});



// Department-wise vacancy count
app.get('/api/vacancies', requireAuth(), (req, res) => {
    const user = req.user;
    let query = `
        SELECT 
            c.id as campus_id,
            d.id as department_id,
            d.name as department_name,
            d.ft_allowed as ft_allowed,
            i.name as institution_name,
            c.name as campus_name,
            COALESCE(SUM(s.max_students), 0) as total_max_students,
            COALESCE(SUM(s.current_guiding), 0) as total_current_guiding,
            COALESCE(SUM(MAX(0, s.max_students - COALESCE(s.current_guiding, 0))), 0) as total_vacancy,
            COALESCE(SUM(MIN(2, MAX(0, s.max_students - COALESCE(s.current_guiding, 0)))), 0) as session_vacancy,
            0 as ft_wf_allocated,
            0 as ft_ss_allocated,
            0 as full_time_allocated,
            0 as part_time_allocated,
            0 as total_allocated
        FROM departments d
        JOIN institutions i ON d.institution_id = i.id
        JOIN campuses c ON i.campus_id = c.id
        LEFT JOIN supervisors s ON s.department_id = d.id AND s.is_eligible = 'Yes' AND s.campus_id = c.id

    `;
    let params = [];

    if (user.role === 'hod') {
        query += ' WHERE c.id = ? AND d.id = ?';
        params.push(user.campus_id, user.department_id);
    } else if (user.role === 'coordinator') {
        query += ' WHERE c.id = ? AND i.id IN (SELECT id FROM institutions WHERE coord_username = ?)';
        params.push(user.campus_id, user.username);
    } else if (user.role === 'dean' || user.role === 'admin') {
        query += ' WHERE c.id = ?';
        params.push(user.campus_id);
    } else if (user.role === 'super_admin') {
        if (req.query.campus_id) {
            query += ' WHERE c.id = ?';
            params.push(req.query.campus_id);
        }
    } else if (user.campus_id) {
        query += ' WHERE c.id = ?';
        params.push(user.campus_id);
    }

    query += (query.includes(' WHERE c.id') ? ' AND ' : ' WHERE ') + "(i.campus_id != 2 OR i.id IN (5,6,7,9)) AND NOT (i.id=6 AND UPPER(TRIM(d.name))='ENGLISH')";
    const engineeringNames = trichyCatalog.institutions.find(i => Number(i.id) === 5).departments.map(n => n.toUpperCase());
    query += ' AND (i.id != 5 OR UPPER(d.name) IN (' + engineeringNames.map(() => '?').join(',') + '))';
    params.push(...engineeringNames);
    query += ' GROUP BY d.id ORDER BY campus_name, institution_name, department_name';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Use the same funding classification as the selection guard and browser.
        db.all("SELECT campus_id,department_id,mode_of_study,program FROM candidates WHERE selection_status='Selected'", [], (allocationError,selected) => {
            if(allocationError)return res.status(500).json({error:allocationError.message});
            const totals=new Map();
            for(const candidate of selected){
                const key=candidate.campus_id+':'+candidate.department_id;
                if(!totals.has(key))totals.set(key,{wf:0,ss:0,ft:0,pt:0,total:0});
                const counts=totals.get(key);counts.total++;
                if(studyModePolicy.isFullTimeWithFellowship(candidate))counts.wf++;
                if(studyModePolicy.isFullTimeWithoutFellowship(candidate))counts.ss++;
                if(studyModePolicy.isFullTimeApplicant(candidate))counts.ft++;
                if(studyModePolicy.classifyStudyMode(candidate)==='part_time')counts.pt++;
            }
            for(const row of rows){
                const counts=totals.get(row.campus_id+':'+row.department_id)||{wf:0,ss:0,ft:0,pt:0,total:0};
                Object.assign(row,{ft_wf_allocated:counts.wf,ft_ss_allocated:counts.ss,full_time_allocated:counts.ft,part_time_allocated:counts.pt,total_allocated:counts.total,ft_unspecified_allocated:counts.ft-counts.wf-counts.ss,ft_allowed_scope:'full_time_with_fellowship',remaining_vacancy:row.total_vacancy-counts.ft,remaining_session_vacancy:row.session_vacancy-counts.ft});
            }
            res.json({vacancies:rows});
        });
    });
});

// Super Admin: Update FT Allowed count for a department
app.put('/api/vacancies/ft-allowed', requireAuth(['super_admin']), (req, res) => {
    const { department_id, ft_allowed } = req.body;
    if (!department_id) return res.status(400).json({ error: 'department_id is required.' });
    const val = (ft_allowed === null || ft_allowed === '' || ft_allowed === undefined) ? null : Number(ft_allowed);
    if (val !== null && (!Number.isSafeInteger(val) || val < 0)) {
        return res.status(400).json({ error: 'ft_allowed must be a non-negative integer or null.' });
    }
    db.run('UPDATE departments SET ft_allowed = ? WHERE id = ?', [val, department_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Department not found.' });
        selectionWorkflow.updated('vacancies',{department_id:Number(department_id)});
        res.json({ success: true, department_id, ft_allowed: val });
    });
});

// HOD supervisor list
app.get('/api/hod/supervisors', requireAuth(['hod']), (req, res) => {
    const deptId = req.user.department_id;
    db.all('SELECT * FROM supervisors WHERE department_id = ?', [deptId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ supervisors: rows });
    });
});

// GET HOD interview panels & members
app.get('/api/hod/panels', requireAuth(['hod']), (req, res) => {
    const { campus_id, institution_id, department_id } = req.user;
    const query = `
        SELECT p.id as panel_id, p.panel_name, m.id as member_id, m.name as member_name, m.designation as member_designation
        FROM interview_panels p
        LEFT JOIN panel_members m ON p.id = m.panel_id
        WHERE p.campus_id = ? AND p.institution_id = ? AND p.department_id = ?
        ORDER BY p.id, m.id
    `;
    db.all(query, [campus_id, institution_id, department_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const panelsMap = {};
        rows.forEach(r => {
            if (!panelsMap[r.panel_id]) {
                panelsMap[r.panel_id] = {
                    id: r.panel_id,
                    panel_name: r.panel_name,
                    members: []
                };
            }
            if (r.member_id) {
                panelsMap[r.panel_id].members.push({
                    id: r.member_id,
                    name: r.member_name,
                    designation: r.member_designation
                });
            }
        });
        
        res.json({ panels: Object.values(panelsMap) });
    });
});

// GET unified interview panels & members for admin, coordinator, hod
app.get('/api/panels', requireAuth(['admin', 'coordinator', 'hod']), (req, res) => {
    const campusId = req.query.campus_id || req.user.campus_id;
    const institutionId = req.query.institution_id || req.user.institution_id;
    const departmentId = req.query.department_id || req.user.department_id;

    if (!campusId || !institutionId) {
        return res.status(400).json({ error: 'Missing campus_id or institution_id' });
    }

    let query = `
        SELECT p.id as panel_id, p.panel_name, p.department_id, d.name as department_name,
               m.id as member_id, m.name as member_name, m.designation as member_designation
        FROM interview_panels p
        LEFT JOIN panel_members m ON p.id = m.panel_id
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.campus_id = ? AND p.institution_id = ?
    `;
    const params = [campusId, institutionId];

    if (departmentId) {
        query += ' AND p.department_id = ?';
        params.push(departmentId);
    }

    query += ' ORDER BY p.department_id, p.id, m.id';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const panelsMap = {};
        rows.forEach(r => {
            if (!panelsMap[r.panel_id]) {
                panelsMap[r.panel_id] = {
                    id: r.panel_id,
                    panel_name: r.panel_name,
                    department_id: r.department_id,
                    department_name: r.department_name,
                    members: []
                };
            }
            if (r.member_id) {
                panelsMap[r.panel_id].members.push({
                    id: r.member_id,
                    name: r.member_name,
                    designation: r.member_designation
                });
            }
        });
        
        res.json({ success: true, panels: Object.values(panelsMap) });
    });
});


// POST HOD save panels & members
app.post('/api/hod/panels', requireAuth(['hod']), (req, res) => {
    const { campus_id, institution_id, department_id } = req.user;
    const { panels } = req.body;

    if (!Array.isArray(panels)) {
        return res.status(400).json({ error: 'Invalid panels format' });
    }

    db.get("SELECT value FROM settings WHERE key = 'deadline_create_panels'", [], (err, row) => {
        if (err) return res.status(500).json({ error: 'Failed to check deadlines' });
        if (row && row.value) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(row.value);
            deadlineDate.setHours(0, 0, 0, 0);
            if (today > deadlineDate) {
                return res.status(403).json({ error: 'The deadline for creating interview panels has passed.' });
            }
        }

    db.run(`
        DELETE FROM panel_members 
        WHERE panel_id IN (
            SELECT id FROM interview_panels 
            WHERE campus_id = ? AND institution_id = ? AND department_id = ?
        )
    `, [campus_id, institution_id, department_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(`
            DELETE FROM interview_panels 
            WHERE campus_id = ? AND institution_id = ? AND department_id = ?
        `, [campus_id, institution_id, department_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            if (panels.length === 0) {
                return res.json({ success: true, message: 'All interview panels cleared.' });
            }

            let insertedCount = 0;
            let totalPanels = panels.length;
            let hasError = false;

            panels.forEach(p => {
                db.run(
                    `INSERT INTO interview_panels (campus_id, institution_id, department_id, panel_name) VALUES (?, ?, ?, ?)`,
                    [campus_id, institution_id, department_id, p.panel_name],
                    function(err) {
                        if (err && !hasError) {
                            hasError = true;
                            return res.status(500).json({ error: err.message });
                        }
                        const panelId = this.lastID;
                        if (p.members && Array.isArray(p.members) && p.members.length > 0) {
                            let memberInsertCount = 0;
                            p.members.forEach(m => {
                                db.run(
                                    `INSERT INTO panel_members (panel_id, name, designation) VALUES (?, ?, ?)`,
                                    [panelId, m.name, m.designation],
                                    (err) => {
                                        if (err && !hasError) {
                                            hasError = true;
                                            return res.status(500).json({ error: err.message });
                                        }
                                        memberInsertCount++;
                                        if (memberInsertCount === p.members.length) {
                                            insertedCount++;
                                            if (insertedCount === totalPanels && !hasError) {
                                                res.json({ success: true, message: 'Interview panels and members saved successfully.' });
                                            }
                                        }
                                    }
                                );
                            });
                        } else {
                            insertedCount++;
                            if (insertedCount === totalPanels && !hasError) {
                                res.json({ success: true, message: 'Interview panels and members saved successfully.' });
                            }
                        }
                    }
                );
            });
        });
    });
    });
});

// POST HOD assign panel to candidate

// POST HOD update candidate selection status (only before guide is assigned)

// GET coordinator interview panels across departments
app.get('/api/coordinator/panels', requireAuth(['coordinator']), (req, res) => {
    const { campus_id, institution_id } = req.user;
    const query = `
        SELECT p.id as panel_id, p.panel_name, p.department_id, d.name as department_name,
               m.id as member_id, m.name as member_name, m.designation as member_designation,
               (SELECT COUNT(*) FROM candidates WHERE panel_id = p.id) as candidate_count
        FROM interview_panels p
        LEFT JOIN panel_members m ON p.id = m.panel_id
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.campus_id = ? AND p.institution_id = ?
        ORDER BY d.name, p.id, m.id
    `;
    db.all(query, [campus_id, institution_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const departmentsMap = {};
        rows.forEach(r => {
            if (!r.department_name) return; // Ignore orphan panels
            if (!departmentsMap[r.department_id]) {
                departmentsMap[r.department_id] = {
                    department_id: r.department_id,
                    department_name: r.department_name,
                    panels: {}
                };
            }
            const dept = departmentsMap[r.department_id];
            if (!dept.panels[r.panel_id]) {
                dept.panels[r.panel_id] = {
                    id: r.panel_id,
                    panel_name: r.panel_name,
                    candidate_count: r.candidate_count || 0,
                    members: []
                };
            }
            if (r.member_id) {
                dept.panels[r.panel_id].members.push({
                    id: r.member_id,
                    name: r.member_name,
                    designation: r.member_designation
                });
            }
        });

        const result = Object.values(departmentsMap).map(d => ({
            department_id: d.department_id,
            department_name: d.department_name,
            panels: Object.values(d.panels)
        }));

        res.json({ departments: result });
    });
});

// POST query HOD regarding panels
app.post('/api/coordinator/panels/query', requireAuth(['coordinator']), (req, res) => {
    const { campus_id, institution_id } = req.user;
    const { department_id, query_text } = req.body;

    if (!department_id || !query_text || !query_text.trim()) {
        return res.status(400).json({ error: 'Department ID and query text are required.' });
    }

    db.get(
        `SELECT email, name FROM users 
         WHERE role = 'hod' AND campus_id = ? AND institution_id = ? AND department_id = ?`,
        [campus_id, institution_id, department_id],
        (err, hod) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!hod || !hod.email) {
                return res.status(404).json({ error: 'HOD for this department not found, or HOD email is missing.' });
            }

            const subject = `Query regarding Interview Panels - Directorate of Research`;
            const body = `Dear ${hod.name},\n\nThe Research Coordinator has sent you a query regarding your department's interview panels:\n\n"${query_text}"\n\nPlease review and make the necessary updates in the PhD Portal.\n\nRegards,\nDirectorate of Research`;

            const transporter = getMailTransporter();
            if (transporter && process.env.SMTP_USER) {
                transporter.sendMail({
                    from: getFromEmail(campus_id),
                    to: hod.email,
                    subject: subject,
                    text: body
                }, (mailErr) => {
                    if (mailErr) {
                        console.error('Failed to send query email:', mailErr);
                        logEmail(null, hod.email, subject, body, 'Failed to Send (Error)', hod.name);
                        return res.status(500).json({ error: 'Failed to send email: ' + mailErr.message });
                    }
                    logEmail(null, hod.email, subject, body, 'Sent', hod.name);
                    res.json({ success: true, message: `Query successfully emailed to ${hod.name} (${hod.email}).` });
                });
            } else {
                logEmail(null, hod.email, subject, body, 'Logged (Offline Mode)', hod.name);
                res.json({ success: true, message: `Mail server is offline. Query logged in system logs for HOD: ${hod.name} (${hod.email}).` });
            }
        }
    );
});

// Coordinator supervisor list
app.get('/api/coordinator/supervisors', requireAuth(['coordinator']), (req, res) => {
    const username = req.user.username;
    const campusId = req.user.campus_id;
    db.all(`
        SELECT s.*, d.name as department_name, i.name as institution_name 
        FROM supervisors s
        JOIN departments d ON s.department_id = d.id
        JOIN institutions i ON s.institution_id = i.id
        WHERE s.campus_id = ? AND s.institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)
    `, [campusId, username], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ supervisors: rows });
    });
});

// Coordinator delete single supervisor
app.delete('/api/coordinator/supervisors/:id', requireAuth(['coordinator']), (req, res) => {
    const { id } = req.params;
    const campusId = req.user.campus_id;
    const username = req.user.username;

    db.get(`
        SELECT s.id 
        FROM supervisors s
        JOIN institutions i ON s.institution_id = i.id
        WHERE s.id = ? AND s.campus_id = ? AND i.coord_username = ?
    `, [id, campusId, username], (err, supervisor) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!supervisor) return res.status(404).json({ error: 'Supervisor not found or access denied.' });

        db.run('DELETE FROM supervisors WHERE id = ?', [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Supervisor deleted successfully.' });
        });
    });
});

// Coordinator clear all supervisors
app.post('/api/coordinator/clear-supervisors', requireAuth(['coordinator']), (req, res) => {
    const campusId = req.user.campus_id;
    const username = req.user.username;

    db.run(
        `DELETE FROM supervisors 
         WHERE campus_id = ? AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)`,
        [campusId, username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: `Successfully deleted all supervisor details (${this.changes} records deleted).` });
        }
    );
});

function findMatchingDepartment(dbDepts, excelDeptName, sheetName) {
    const abbrevs = {
        'ece': 'electronics and communication engineering',
        'eee': 'electrical and electronics engineering',
        'cse': 'computer science and engineering',
        'csecore': 'computer science and engineering',
        'csespecialisation': 'computer science and engineering',
        'it': 'computer science and engineering',
        'mba': 'management studies',
        'mgt': 'management studies',
        'oralpathologydentistry': 'dentistry',
        'dentistry': 'dentistry',
        'computerscience': 'computer science',
        'management': 'management studies',
        'physiology': 'bms/physiology',
        'physiology/medicine': 'bms/physiology',
        'physiologymedicine': 'bms/physiology'
    };

    function matchDept(targetName) {
        if (!targetName) return null;
        const cleanedTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        if (!cleanedTarget) return null;

        // 1. Exact Match on cleaned names
        let match = dbDepts.find(d => {
            const cleanedDb = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanedDb === cleanedTarget;
        });
        if (match) return match.id;

        // 2. Abbreviation map
        const targetMappedName = abbrevs[cleanedTarget];
        if (targetMappedName) {
            match = dbDepts.find(d => d.name.toLowerCase() === targetMappedName);
            if (match) return match.id;
        }

        // 3. Substring match (either contains the other)
        match = dbDepts.find(d => {
            const cleanedDb = d.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace('departmentof', '').replace('facultyof', '');
            return cleanedTarget.includes(cleanedDb) || cleanedDb.includes(cleanedTarget);
        });
        if (match) return match.id;

        // 4. Word-based or fuzzy check
        match = dbDepts.find(d => {
            const dbName = d.name.toLowerCase();
            const targetLower = targetName.toLowerCase();
            return dbName.includes('computer') && targetLower.includes('computer') ||
                   dbName.includes('management') && targetLower.includes('management') ||
                   dbName.includes('dental') && targetLower.includes('dental') ||
                   dbName.includes('physiology') && targetLower.includes('physiology') ||
                   dbName.includes('prosthodontics') && targetLower.includes('prosthodontics') ||
                   dbName.includes('conservative') && targetLower.includes('conservative') ||
                   dbName.includes('maxillofacial') && targetLower.includes('maxillofacial') ||
                   dbName.includes('pediatric') && targetLower.includes('pediatric') ||
                   dbName.includes('orthodontics') && targetLower.includes('orthodontics') ||
                   dbName.includes('periodontics') && targetLower.includes('periodontics');
        });
        if (match) return match.id;

        return null;
    }

    // Try to match the excel department name first
    let matchedId = matchDept(excelDeptName);
    if (matchedId) return matchedId;

    // If that fails, try matching the sheet name
    matchedId = matchDept(sheetName);
    if (matchedId) return matchedId;

    // Fallback if there are any departments at all
    if (dbDepts.length > 0) return dbDepts[0].id;
    return null;
}

// Coordinator supervisor upload
app.post('/api/coordinator/upload-supervisors', requireAuth(['coordinator']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    db.all("SELECT key, value FROM settings", [], (err, rows) => {
        if (err) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: 'Failed to check upload status' });
        }
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        
        const isLocked = settings.supervisor_upload_enabled === 'false';
        const deadline = settings.deadline_supervisor_upload;
        
        let isPastDeadline = false;
        if (deadline) {
            // Check if current date (in local time) has passed the deadline
            // Using setHours(0,0,0,0) to compare only dates
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(deadline);
            deadlineDate.setHours(0, 0, 0, 0);
            if (today > deadlineDate) {
                isPastDeadline = true;
            }
        }

        if (isLocked || isPastDeadline) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: isPastDeadline ? 'The deadline for supervisor uploads has passed.' : 'Supervisor uploads are currently closed by the Administrator.' });
        }

        const filePath = req.file.path;
        const campusId = req.user.campus_id;
        const username = req.user.username;

        db.all(
            `SELECT d.id, d.name, d.institution_id 
             FROM departments d
             JOIN institutions i ON d.institution_id = i.id
             WHERE i.campus_id = ? AND i.coord_username = ?`,
        [campusId, username],
        (err, dbDepts) => {
            if (err) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                return res.status(500).json({ error: err.message });
            }

            try {
                const workbook = xlsx.readFile(filePath);
                const supervisorsToInsert = [];

                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = xlsx.utils.sheet_to_json(sheet);

                    rows.forEach(r => {
                        let name = '';
                        let facultyId = '';
                        let designation = '';
                        let areaOfResearch = '';
                        let maxStudents = 8;
                        let currentGuiding = 0;
                        let vacancy = 8;
                        let completedStudents = 0;
                        let isEligible = 'Yes';
                        let rowDeptName = '';

                        Object.keys(r).forEach(key => {
                            const normKey = key.toLowerCase().replace(/\s+/g, ' ').trim();
                            const val = r[key];

                            if (normKey.includes('name of') && normKey.includes('supervisor')) {
                                name = String(val).trim();
                            } else if (normKey.includes('faculty id')) {
                                facultyId = String(val).trim().replace(/^\s+/, '');
                            } else if (normKey === 'designation') {
                                designation = String(val).trim();
                            } else if (normKey.includes('area of research')) {
                                areaOfResearch = String(val).trim();
                            } else if (normKey.includes('maximum number') || normKey.includes('max students') || normKey.includes('students allowed')) {
                                maxStudents = parseInt(val) || 0;
                            } else if (normKey.includes('guiding') || normKey.includes('currently guiding')) {
                                currentGuiding = parseInt(val) || 0;
                            } else if ((normKey.includes('vacancy') || normKey.includes('available vacancy')) && !normKey.includes('eligible')) {
                                vacancy = parseInt(val) || 0;
                            } else if (normKey.includes('completed') || normKey.includes('degree awarded')) {
                                completedStudents = parseInt(val) || 0;
                            } else if (normKey.includes('is eligible') && !normKey.includes('reason') && !normKey.includes('if not')) {
                                const rawVal = String(val).trim().toLowerCase();
                                isEligible = (rawVal === 'yes') ? 'Yes' : 'No';
                            } else if (normKey === 'department') {
                                rowDeptName = String(val).trim();
                            }
                        });

                        if (!name) return;

                        const deptId = findMatchingDepartment(dbDepts, rowDeptName, sheetName);
                        if (!deptId) return;

                        const deptMeta = dbDepts.find(d => d.id === deptId);
                        const instId = deptMeta ? deptMeta.institution_id : null;

                        supervisorsToInsert.push({
                            campus_id: campusId,
                            institution_id: instId,
                            department_id: deptId,
                            name,
                            faculty_id: facultyId,
                            designation,
                            area_of_research: areaOfResearch,
                            max_students: maxStudents,
                            current_guiding: currentGuiding,
                            vacancy: vacancy,
                            completed_students: completedStudents,
                            is_eligible: isEligible
                        });
                    });
                });

                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

                if (supervisorsToInsert.length === 0) {
                    return res.status(400).json({ error: 'No supervisor records found matching your institutions departments.' });
                }

                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    
                    db.run(
                        `DELETE FROM supervisors 
                         WHERE campus_id = ? AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?)`,
                        [campusId, username]
                    );

                    const stmt = db.prepare(`
                        INSERT INTO supervisors (
                            campus_id, institution_id, department_id, name, faculty_id, 
                            designation, area_of_research, max_students, current_guiding, 
                            vacancy, completed_students, is_eligible
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    supervisorsToInsert.forEach(s => {
                        stmt.run(
                            s.campus_id, s.institution_id, s.department_id, s.name, s.faculty_id,
                            s.designation, s.area_of_research, s.max_students, s.current_guiding,
                            s.vacancy, s.completed_students, s.is_eligible
                        );
                    });

                    stmt.finalize();
                    db.run("COMMIT", (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ success: true, message: `Successfully uploaded and parsed ${supervisorsToInsert.length} supervisor records.` });
                    });
                });
            } catch (ex) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                res.status(500).json({ error: ex.message });
            }
        });
    });
});

// HOD supervisor assign

// HOD forward selections back up the chain
app.post('/api/hod/forward-selections', requireAuth(['hod']), (req, res) => {
    const { candidateIds } = req.body;
    if (candidateIds && Array.isArray(candidateIds) && candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => '?').join(',');
        db.run(
            `UPDATE candidates SET current_owner = 'Coordinator', status = 'Selection Finalized' 
             WHERE id IN (${placeholders}) AND department_id = ? AND status IN ('Guide Allocation Open', 'Guide Allocated') AND selection_status IN ('Selected', 'Not Selected')`,
            [...candidateIds, req.user.department_id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: `Forwarded ${this.changes} selection(s) to Coordinator.` });
            }
        );
    } else {
        db.run(
            "UPDATE candidates SET current_owner = 'Coordinator', status = 'Selection Finalized' WHERE department_id = ? AND status IN ('Guide Allocation Open', 'Guide Allocated') AND selection_status IN ('Selected', 'Not Selected')",
            [req.user.department_id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: 'Forwarded selections to Coordinator.' });
            }
        );
    }
});

// -------------------------------------------------------------------------
//  RESEARCH OFFICE API
// -------------------------------------------------------------------------
app.post('/api/research-office/reassign-candidate', requireAuth(['coordinator', 'super_admin']), (req, res) => {
    const { candidateId, institutionId, departmentId } = req.body;
    if (!candidateId || !institutionId || !departmentId) return res.status(400).json({error:'Missing parameters'});
    const isOffice = ['rmp_research_office', 'trichy_research_office'].includes(req.user.username) || req.user.role === 'super_admin';
    if (!isOffice) return res.status(403).json({error:'Only Research Office can re-route candidates.'});
    db.get('SELECT * FROM candidates WHERE id = ?', [candidateId], (error, candidate) => {
        if (error) return res.status(500).json({error:error.message});
        if (!candidate) return res.status(404).json({error:'Candidate not found'});
        if (req.user.role !== 'super_admin' && Number(candidate.campus_id) !== Number(req.user.campus_id)) return res.status(403).json({error:'Candidate is outside your campus.'});
        if (Number(candidate.campus_id) === 2 && (Number(candidate.institution_id) !== 101 || Number(candidate.department_id) !== 101)) return res.status(400).json({error:'Candidate is no longer awaiting Research Office mapping.'});
        db.get('SELECT d.id dept_id,d.name dept_name,i.id inst_id,i.name inst_name,i.campus_id FROM departments d JOIN institutions i ON d.institution_id=i.id WHERE d.id=? AND i.id=? AND i.campus_id=?', [departmentId,institutionId,candidate.campus_id], (error, target) => {
            if (error) return res.status(500).json({error:error.message});
            if (!target || !resolveAdmissionMapping(target.inst_name,target.dept_name,candidate.campus_id,[target]).match) return res.status(400).json({error:'Choose a configured department under an active institute in this campus.'});
            const status = normalizeFormStatus(candidate.form_status) === 'Incomplete' ? 'Incomplete' : 'Pending Verification';
            db.run("UPDATE candidates SET institution_id=?,department_id=?,current_owner='Admin',status=? WHERE id=? AND campus_id=? AND institution_id=? AND department_id=?", [institutionId,departmentId,status,candidateId,candidate.campus_id,candidate.institution_id,candidate.department_id], function(error) {
                if (error) return res.status(500).json({error:error.message});
                if (this.changes !== 1) return res.status(409).json({error:'Candidate mapping changed. Refresh and try again.'});
                res.json({success:true,message:'Candidate mapped and returned to campus Admin for review.'});
            });
        });
    });
});

app.post('/api/coordinator/forward-selections-to-dean', requireAuth(['coordinator']), (req, res) => {
    const { candidateIds } = req.body;
    if (candidateIds && Array.isArray(candidateIds) && candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => '?').join(',');
        db.run(
            `UPDATE candidates SET current_owner = 'Dean', status = 'Under Dean Final Review' 
             WHERE id IN (${placeholders}) AND institution_id IN (SELECT id FROM institutions WHERE coord_username = ?) AND status = 'Selection Finalized'`,
            [...candidateIds, req.user.username],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: 'Forwarded selected candidate selections to Dean.' });
            }
        );
    } else {
        db.run(
            "UPDATE candidates SET current_owner = 'Dean', status = 'Under Dean Final Review' WHERE institution_id IN (SELECT id FROM institutions WHERE coord_username = ?) AND status = 'Selection Finalized'",
            [req.user.username],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: 'Forwarded all selections and supervisor details to Dean.' });
            }
        );
    }
});

// --- DOCUMENT GENERATION & DOWNLOADING API ---
app.get('/api/hod/drcc-defaults', requireAuth(['hod']), (req, res) => {
    const deptId = req.user.department_id;
    const campusId = req.user.campus_id;
    const hodName = req.user.name;

    db.get(`
        SELECT i.coord_username 
        FROM departments d JOIN institutions i ON d.institution_id = i.id 
        WHERE d.id = ?`, [deptId], (err, deptMeta) => {
        if (err || !deptMeta) {
            return res.json({
                drcc_members: [
                    { s_no: 1, name: hodName, designation: 'HOD & Chairperson', affiliation: 'SRMIST' },
                    { s_no: 2, name: 'Dr. Coordinator', designation: 'Co-Opted Member', affiliation: 'SRMIST' }
                ]
            });
        }

        db.get('SELECT name FROM users WHERE username = ? AND role = \'coordinator\'', [deptMeta.coord_username], (err, coordUser) => {
            const coordinatorName = (!err && coordUser && coordUser.name) ? coordUser.name : 'Dr. Coordinator';
            res.json({
                drcc_members: [
                    { s_no: 1, name: hodName, designation: 'HOD & Chairperson', affiliation: 'SRMIST' },
                    { s_no: 2, name: coordinatorName, designation: 'Co-Opted Member', affiliation: 'SRMIST' }
                ]
            });
        });
    });
});

app.post('/api/hod/download-minutes', requireAuth(['hod']), (req, res) => {
    const deptId = req.user.department_id;
    const campusId = req.user.campus_id;

    // Fetch campus name
    db.get('SELECT name FROM campuses WHERE id = ?', [campusId], (err, campus) => {
        if (err) return res.status(500).json({ error: err.message });

        // Fetch department metadata
        db.get(`
            SELECT d.name as dept_name, i.name as inst_name, i.coord_username 
            FROM departments d JOIN institutions i ON d.institution_id = i.id 
            WHERE d.id = ? AND i.id = ? AND i.campus_id = ?`, [deptId,req.user.institution_id,campusId], (err, deptMeta) => {
            
            if (err) return res.status(500).json({ error: err.message });

            if (!deptMeta || !campus) return res.status(404).json({error:'Department not configured for this HoD.'});

            // Fetch Coordinator's real name
            db.get('SELECT name FROM users WHERE username = ? AND role = \'coordinator\'', [deptMeta.coord_username], (err, coordUser) => {
                const coordinatorName = (!err && coordUser && coordUser.name) ? coordUser.name : 'Dr. Coordinator';

                // Fetch Panel Members for this department
                db.all(`
                    SELECT DISTINCT m.name, m.designation 
                    FROM panel_members m 
                    JOIN interview_panels p ON m.panel_id = p.id
                    WHERE p.department_id = ? AND p.institution_id = ? AND p.campus_id = ?
                    ORDER BY m.id
                `, [deptId,req.user.institution_id,campusId], (err, dbMembers) => {
                    let panelMembers = [];
                    if (!err && dbMembers && dbMembers.length > 0) {
                        panelMembers = dbMembers.map((m, idx) => ({
                            s_no: idx + 1,
                            name: m.name,
                            designation: m.designation,
                            affiliation: 'SRMIST'
                        }));
                    } else {
                        // Fallback to defaults
                        panelMembers = [
                            { s_no: 1, name: 'Internal Panel Member 1', designation: 'Professor', affiliation: 'SRMIST' },
                            { s_no: 2, name: 'Internal Panel Member 2', designation: 'Associate Professor', affiliation: 'SRMIST' },
                            { s_no: 3, name: 'External Nominee', designation: 'Professor', affiliation: 'External University' }
                        ];
                    }

                    // Fetch candidates for this department
                    db.all(`
                        SELECT application_no, registered_name, mode_of_study, status, exam_attendance, 
                               written_marks, scaled_written_marks, avg_interview_marks, interview_marks_1, interview_marks_2, interview_marks_3, interview_marks_4, interview_marks_5, total_marks, selection_status, 
                               supervisor_name, supervisor_designation, supervisor_affiliation, category
                        FROM candidates 
                        WHERE department_id = ? AND institution_id = ? AND campus_id = ?
                    `, [deptId,req.user.institution_id,campusId], (err, candidates) => {
                        if (err) return res.status(500).json({ error: err.message });

                        // Construct placeholder data
                        const totalApplied = candidates.length;
                        const attendanceSummary = summarizeMinutesAttendance(candidates);
                        const totalSelected = candidates.filter(c => c.selection_status === 'Selected').length;

                        // Numbers to Words converter (Simple implementation)
                        const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
                        const totalSelectedWords = numberWords[totalSelected] || totalSelected.toString();

                        // Sort candidates to list selected candidates first, ranked by score
                        candidates.sort((a, b) => {
                            if (a.selection_status === 'Selected' && b.selection_status !== 'Selected') return -1;
                            if (a.selection_status !== 'Selected' && b.selection_status === 'Selected') return 1;
                            return (b.total_marks || 0) - (a.total_marks || 0);
                        });

                        const getNormalizedMode = (modeStr) => {
                            if (!modeStr) return 'FT';
                            const norm = modeStr.toLowerCase().replace(/[^a-z]/g, '');
                            if (norm.includes('fulltime') || norm === 'ft') {
                                return 'FT';
                            } else if (norm.includes('internal') || norm === 'pti') {
                                return 'PTI';
                            } else if (norm.includes('academic') || norm.includes('externalacademic') || norm === 'pteacd') {
                                return 'PTE-Acd';
                            } else if (norm.includes('industry') || norm.includes('externalindustry') || norm === 'pteind') {
                                return 'PTE-Ind';
                            } else if (norm.includes('parttime') || norm === 'pt') {
                                return 'PTI'; // fallback unspecified Part Time to Part-Time Internal
                            }
                            return 'FT'; // default fallback
                        };

                        const candidateRows = candidates.map((c, idx) => {
                            const mode = getNormalizedMode(c.mode_of_study);
                            const cleanStatus = c.status === 'Not Eligible' ? 'Not Eligible' : 'Eligible';
                            const scoreTotal = formatMinutesScore(c.total_marks);
                            const scoreWritten = formatMinutesScore(c.scaled_written_marks);
                            const scoreInt = formatMinutesScore(c.avg_interview_marks);
                            
                            const isSelected = c.selection_status === 'Selected' ? 'Selected' : 'Not Selected';
                            let guideStr = '-';
                            if (c.supervisor_name) {
                                guideStr = `${c.supervisor_name}, ${c.supervisor_designation || ''} & ${c.supervisor_affiliation || ''}`;
                            }

                            return {
                                s_no: idx + 1,
                                name: c.registered_name,
                                app_no: c.application_no,
                                mode: mode,
                                eligibility: cleanStatus,
                                attendance: c.exam_attendance || 'Not recorded',
                                written_marks: scoreWritten,
                                interview_marks: scoreInt,
                                total_marks: scoreTotal,
                                status: isSelected,
                                supervisor: guideStr
                            };
                        });

                        // Set up program counts for Table 2 using the unified helper
                        const ft_applied = candidates.filter(c => getNormalizedMode(c.mode_of_study) === 'FT').length;
                        const pti_applied = candidates.filter(c => getNormalizedMode(c.mode_of_study) === 'PTI').length;
                        const ptea_applied = candidates.filter(c => getNormalizedMode(c.mode_of_study) === 'PTE-Acd').length;
                        const ptei_applied = candidates.filter(c => getNormalizedMode(c.mode_of_study) === 'PTE-Ind').length;

                        const docData = {
                            department: deptMeta.dept_name.toUpperCase(),
                            DEPARTMENT: deptMeta.dept_name.toUpperCase(),
                            campus_name: campus.name === 'Trichy' ? 'Tiruchirappalli' : 'Ramapuram',
                            session: 'July-2026', // Can make dynamic
                            exam_date: '16.05.2026', // Can make dynamic
                            exam_date_long: 'May 16, 2026',
                            start_date: 'April 1, 2026',
                            end_date: 'May 04, 2026',
                            total_applied: totalApplied,
                            total_present: attendanceSummary.written_present, // Compatibility with older templates.
                            ...attendanceSummary,
                            total_selected: totalSelected,
                            total_selected_words: totalSelectedWords,
                            ft_applied: ft_applied,
                            pti_applied: pti_applied,
                            ptea_applied: ptea_applied,
                            ptei_applied: ptei_applied,
                            drcc_members: (req.body.drcc_members && Array.isArray(req.body.drcc_members)) ? req.body.drcc_members.map((m, i) => ({
                                s_no: i + 1,
                                name: m.name || '',
                                designation: m.designation || '',
                                affiliation: m.affiliation || ''
                            })) : [
                                { s_no: 1, name: `HOD, ${deptMeta.dept_name}`, designation: 'HOD & Chairperson', affiliation: 'SRMIST' },
                                { s_no: 2, name: coordinatorName, designation: 'Co-Opted Member', affiliation: 'SRMIST' }
                            ],
                            panel_members: panelMembers,
                            candidates: candidateRows
                        };

                        try {
                            const templatePath = path.join(__dirname, 'minutes_template.docx');
                            const content = fs.readFileSync(templatePath, 'binary');
                            const zip = new PizzaZip(content);

                            // Swap logo based on campus ID (1 for Ramapuram, 2 for Trichy)
                            let logoPath = path.join(__dirname, 'trichy_logo.png');
                            if (campusId === 1) {
                                logoPath = path.join(__dirname, 'ramapuram_logo.png');
                            }
                            if (fs.existsSync(logoPath)) {
                                const logoContent = fs.readFileSync(logoPath);
                                zip.file('word/media/image1.png', logoContent, { binary: true });
                            }

                            const docx = new Docxtemplater(zip, {
                                paragraphLoop: true,
                                linebreaks: true
                            });
                            docx.render(docData);
                            const buf = docx.getZip().generate({
                                type: 'nodebuffer',
                                compression: 'DEFLATE'
                            });

                            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                            res.setHeader('Content-Disposition', `attachment; filename=Minutes_${deptMeta.dept_name.replace(/\s+/g, '_')}_July2026.docx`);
                            res.send(buf);
                        } catch (err) {
                            res.status(500).json({ error: 'Failed to compile Minutes template: ' + err.message });
                        }
                    });
                });
            });
        });
    });
});



// --- ENTRANCE EXAM QUESTION PAPER MANAGEMENT ENDPOINTS ---

const qpUploadDir = path.join(__dirname, 'uploads', 'question_papers');
if (!fs.existsSync(qpUploadDir)) {
    fs.mkdirSync(qpUploadDir, { recursive: true });
}

// Helpers for standardized file and folder naming (e.g. RMP_A_CSE_Jan27.docx)
function getDepartmentCode(deptName) {
    if (!deptName) return 'DEPT';
    const name = deptName.trim();
    const map = {
        'Mechanical Engineering': 'MECH',
        'Computer Science and Engineering': 'CSE',
        'Computer Science': 'CS',
        'Electronics and Communication Engineering': 'ECE',
        'Electrical and Electronics Engineering': 'EEE',
        'Civil Engineering': 'CIVIL',
        'Biotechnology': 'BIOTECH',
        'Biomedical Engineering': 'BIOMEDI',
        'Mathematics': 'MATHS',
        'Physics': 'PHY',
        'Chemistry': 'CHY',
        'English': 'ENG',
        'Commerce': 'COM',
        'Fashion Designing': 'FD',
        'Visual Communication': 'VISCOM',
        'Tamil': 'TAMIL',
        'Hindi': 'HINDI',
        'Dentistry': 'DENTAL',
        'Management Studies': 'MGT',
        'MANAGEMENT STUDIES': 'MGT',
        'Biochemistry': 'BIOCHY',
        'Microbiology': 'MICROBIO',
        'Occupational Therapy': 'OT',
        'Medical Imaging Technology': 'MIT',
        'Clinical Psychology': 'CP',
        'CLINICAL PSYCOLOGY': 'CP',
        'Renal Dialysis Technology': 'RDT',
        'Anaesthesia Technology': 'AT',
        'Physical Education': 'PE'
    };
    if (map[name]) return map[name];
    const words = name.split(/\s+/).filter(w => !['and', '&', 'of'].includes(w.toLowerCase()));
    if (words.length > 1) {
        return words.map(w => w[0]).join('').toUpperCase();
    }
    return name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
}

function getCampusCode(campusName, campusId) {
    if (campusName) {
        const c = String(campusName).toLowerCase();
        if (c.includes('trichy') || c.includes('try')) return 'TRY';
        if (c.includes('ramapuram') || c.includes('rmp')) return 'RMP';
    }
    if (campusId === 2) return 'TRY';
    return 'RMP';
}

// Helper function to parse a DOCX question paper and extract questions and correct answers
function parseQuestionPaperDocx(filePath) {
    const content = fs.readFileSync(filePath);
    const zip = new PizzaZip(content);
    if (!zip.files['word/document.xml']) {
        throw new Error("Invalid DOCX file structure. missing word/document.xml");
    }

    // 1. Parse numbering formats from word/numbering.xml
    const numIdToFmt = {};
    if (zip.files['word/numbering.xml']) {
        const numXml = zip.files['word/numbering.xml'].asText();
        const abstractNums = {};
        const absMatches = numXml.matchAll(/<w:abstractNum\b[^>]*\w:abstractNumId="(\d+)"([\s\S]*?)<\/w:abstractNum>/g);
        for (const match of absMatches) {
            const absId = match[1];
            const inner = match[2];
            const lvls = {};
            const lvlMatches = inner.matchAll(/<w:lvl\b[^>]*\w:ilvl="(\d+)"([\s\S]*?)<\/w:lvl>/g);
            for (const lvlMatch of lvlMatches) {
                const ilvl = lvlMatch[1];
                const lvlInner = lvlMatch[2];
                const fmtMatch = lvlInner.match(/<w:numFmt\b[^>]*\w:val="([^"]+)"/);
                lvls[ilvl] = fmtMatch ? fmtMatch[1] : 'unknown';
            }
            abstractNums[absId] = lvls;
        }
        const numMatches = numXml.matchAll(/<w:num\b[^>]*\w:numId="(\d+)"([\s\S]*?)<\/w:num>/g);
        for (const match of numMatches) {
            const numId = match[1];
            const inner = match[2];
            const absMatch = inner.match(/<w:abstractNumId\b[^>]*\w:val="(\d+)"/);
            if (absMatch) {
                numIdToFmt[numId] = abstractNums[absMatch[1]];
            }
        }
    }

    // 2. Extract only main body paragraphs, ignoring paragraphs inside tables
    const docXml = zip.files['word/document.xml'].asText();
    const pXmls = [];
    let tableDepth = 0;
    const tagRegex = /<\/?w:(tbl|p)\b/g;
    let tagMatch;
    let currentPStart = -1;
    
    while ((tagMatch = tagRegex.exec(docXml)) !== null) {
        const tag = tagMatch[0];
        if (tag === '<w:tbl') {
            tableDepth++;
        } else if (tag === '</w:tbl') {
            tableDepth--;
        } else if (tag === '<w:p') {
            if (tableDepth === 0) {
                currentPStart = tagMatch.index;
            }
        } else if (tag === '</w:p') {
            if (tableDepth === 0 && currentPStart !== -1) {
                const closeIndex = docXml.indexOf('>', tagMatch.index);
                if (closeIndex !== -1) {
                    pXmls.push(docXml.substring(currentPStart, closeIndex + 1));
                }
                currentPStart = -1;
            }
        }
    }

    // 3. Process each body paragraph to build list structure
    const paragraphs = [];
    pXmls.forEach(pXml => {
        let text = pXml.replace(/<\/w:t>/g, ' </w:t>').replace(/<[^>]+>/g, '')
                       .replace(/&amp;/g, '&')
                       .replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"')
                       .replace(/&apos;/g, "'")
                       .replace(/&nbsp;/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();
        if (text.length === 0) return;

        const numIdMatch = pXml.match(/<w:numId\b[^>]*\w:val="(\d+)"/);
        const numId = numIdMatch ? numIdMatch[1] : null;

        const ilvlMatch = pXml.match(/<w:ilvl\b[^>]*\w:val="(\d+)"/);
        const ilvl = ilvlMatch ? ilvlMatch[1] : '0';

        const fmt = numId ? (numIdToFmt[numId] ? numIdToFmt[numId][ilvl] : null) : null;

        // Extract bold runs
        const boldRuns = [];
        const rMatches = pXml.matchAll(/<w:r\b[^>]*>(.*?)<\/w:r>/g);
        for (const rMatch of rMatches) {
            const rXml = rMatch[0];
            const isBold = rXml.includes('<w:b/>') || rXml.includes('<w:bCs/>') || rXml.includes('w:val="12"');
            if (isBold) {
                let rText = rXml.replace(/<[^>]+>/g, '')
                                 .replace(/&amp;/g, '&')
                                 .replace(/&lt;/g, '<')
                                 .replace(/&gt;/g, '>')
                                 .replace(/&quot;/g, '"')
                                 .replace(/&apos;/g, "'")
                                 .replace(/&nbsp;/g, ' ')
                                 .replace(/\s+/g, ' ').trim();
                if (rText.length > 2) { 
                    boldRuns.push(rText);
                }
            }
        }

        paragraphs.push({
            text: text,
            numId: numId,
            fmt: fmt,
            boldRuns: boldRuns
        });
    });

    // 4. Parse questions and options
    const questions = [];
    let currentSection = 'A';

    for (let i = 0; i < paragraphs.length; i++) {
        const pObj = paragraphs[i];
        let p = pObj.text;

        if (p.includes('Section A') || p.includes('Research Methodology')) {
            currentSection = 'A';
            continue;
        }
        if (p.includes('Section B') || p.includes('Subject-Specific') || p.includes('Subject Specific')) {
            currentSection = 'B';
            continue;
        }

        const manualMatch = p.match(/^\s*(\d+)[\.\s\)]+(.*)/);
        const isDecimalList = pObj.fmt === 'decimal';
        const isQuestion = manualMatch || isDecimalList;

        if (isQuestion) {
            let qNo = null;
            let qText = p;

            if (manualMatch) {
                qNo = parseInt(manualMatch[1], 10);
                qText = manualMatch[2].trim();
            }

            // Skip instructions
            if (questions.length === 0 && qNo === 1 && qText.includes("compulsory")) continue;
            if (questions.length < 5 && (qText.includes("carry") || qText.includes("marking") || qText.includes("calculator"))) continue;

            let options = null;
            let boldRunsCombined = [...pObj.boldRuns];

            // A. Check if options are inline in the same paragraph
            const inlineOptMatch = qText.match(/(.*?)\bA[\.\s\)]+(.*)\bB[\.\s\)]+(.*)\bC[\.\s\)]+(.*)\bD[\.\s\)]+(.*)/i);
            if (inlineOptMatch) {
                options = {
                    A: inlineOptMatch[2].trim(),
                    B: inlineOptMatch[3].trim(),
                    C: inlineOptMatch[4].trim(),
                    D: inlineOptMatch[5].trim()
                };
                qText = inlineOptMatch[1].trim();
            } else {
                // B. Lookahead for options in subsequent paragraphs
                let tempOptions = {};
                let foundOptionsCount = 0;
                let lookAheadIndex = i + 1;

                while (lookAheadIndex < paragraphs.length && foundOptionsCount < 4) {
                    const nextPObj = paragraphs[lookAheadIndex];
                    const nextP = nextPObj.text;

                    const nextManualMatch = nextP.match(/^\s*(\d+)[\.\s\)]+/);
                    const nextIsDecimalList = nextPObj.fmt === 'decimal';
                    if (nextManualMatch || nextIsDecimalList) {
                        break;
                    }

                    boldRunsCombined = boldRunsCombined.concat(nextPObj.boldRuns);

                    const optInlineMatch = nextP.match(/^\s*A[\.\s\)]+(.*)\bB[\.\s\)]+(.*)\bC[\.\s\)]+(.*)\bD[\.\s\)]+(.*)/i);
                    if (optInlineMatch) {
                        tempOptions.A = optInlineMatch[1].trim();
                        tempOptions.B = optInlineMatch[2].trim();
                        tempOptions.C = optInlineMatch[3].trim();
                        tempOptions.D = optInlineMatch[4].trim();
                        foundOptionsCount = 4;
                    } else {
                        const optMatch = nextP.match(/^\s*([A-D])[\.\s\)]+(.*)/i);
                        if (optMatch) {
                            const optLetter = optMatch[1].toUpperCase();
                            tempOptions[optLetter] = optMatch[2].trim();
                            foundOptionsCount++;
                        } else if (nextPObj.fmt === 'upperLetter' || nextPObj.fmt === 'lowerLetter') {
                            const letters = ['A', 'B', 'C', 'D'];
                            const letter = letters[foundOptionsCount];
                            tempOptions[letter] = nextP;
                            foundOptionsCount++;
                        }
                    }
                    lookAheadIndex++;
                }

                if (foundOptionsCount === 4) {
                    options = tempOptions;
                    i = lookAheadIndex - 1;
                }
            }

            if (options) {
                let correctOption = null;
                for (const letter of ['A', 'B', 'C', 'D']) {
                    if (!options[letter]) continue;
                    const optText = options[letter].toLowerCase().replace(/[^a-z0-9]/g, '');
                    const hasMatch = boldRunsCombined.some(br => {
                        const brClean = br.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return brClean.includes(optText) || optText.includes(brClean);
                    });
                    if (hasMatch) {
                        correctOption = letter;
                        break;
                    }
                }

                if (!qNo) {
                    const sectionQs = questions.filter(q => q.section === currentSection);
                    qNo = (currentSection === 'A' ? 1 : 26) + sectionQs.length;
                }

                questions.push({
                    section: currentSection,
                    qNo: qNo,
                    question: qText,
                    options: options,
                    answer: correctOption
                });
            }
        }
    }
    return questions;
}

// Helper function to escape XML text
function escapeXml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
}

// Helper to render a question in docx XML format
function renderXmlQuestion(qNo, q) {
    const qText = escapeXml(q.question_text);
    const optA = escapeXml(q.option_a);
    const optB = escapeXml(q.option_b);
    const optC = escapeXml(q.option_c);
    const optD = escapeXml(q.option_d);

    return `
        <w:p>
            <w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>${qNo}. </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${qText}</w:t></w:r>
        </w:p>
        <w:p>
            <w:pPr><w:spacing w:before="40" w:after="100"/><w:ind w:left="360"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>A. </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${optA}    </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>B. </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${optB}    </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>C. </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${optC}    </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>D. </w:t></w:r>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${optD}</w:t></w:r>
        </w:p>
    `;
}

// Generate the final combined question paper DOCX
function generateQuestionPaperDocx(departmentName, institutionName, campusName, questions) {
    const templatePath = path.join(__dirname, 'public', 'question_paper_template.docx');
    const content = fs.readFileSync(templatePath);
    const zip = new PizzaZip(content);
    const originalDocXml = zip.files['word/document.xml'].asText();
    
    const sectPrMatch = originalDocXml.match(/<w:sectPr\b[^>]*>.*?<\/w:sectPr>/);
    const sectPr = sectPrMatch ? sectPrMatch[0] : '';
    
    let bodyXml = `
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
                <w:t>SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
                <w:t>FACULTY OF ${institutionName.toUpperCase()} - ${campusName.toUpperCase()}</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
                <w:t>DEPARTMENT OF ${departmentName.toUpperCase()}</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:u w:val="single"/></w:rPr>
                <w:t>Ph.D. Entrance Examination (July 2026)</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:spacing w:before="100" w:after="100"/></w:pPr></w:p>
    `;
    
    bodyXml += `
        <w:p>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>Name: _______________________________    Application No.: ___________________</w:t></w:r>
        </w:p>
        <w:p>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/></w:rPr><w:t>Date: _________________                  Duration: 2 Hours       Max Marks: 50</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:spacing w:after="100"/></w:pPr></w:p>
    `;

    bodyXml += `
        <w:p><w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:u w:val="single"/></w:rPr><w:t>Instructions to Candidates:</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>1. All questions are compulsory and carry equal marks (1 mark each).</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>2. For each question, choose the most appropriate option A, B, C, or D and darken the corresponding bubble in the OMR sheet.</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>3. There is no negative marking for incorrect answers.</w:t></w:r></w:p>
        <w:p><w:pPr><w:spacing w:after="200"/></w:pPr></w:p>
    `;

    bodyXml += `
        <w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="200" w:after="100"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:u w:val="single"/></w:rPr>
                <w:t>Section A: Research Methodology (25 Questions)</w:t>
            </w:r>
        </w:p>
    `;

    const secA = questions.filter(q => q.section === 'A');
    secA.forEach((q, idx) => {
        bodyXml += renderXmlQuestion(idx + 1, q);
    });

    bodyXml += `
        <w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="200" w:after="100"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:u w:val="single"/></w:rPr>
                <w:t>Section B: Subject-Specific Core Topics (25 Questions)</w:t>
            </w:r>
        </w:p>
    `;

    const secB = questions.filter(q => q.section === 'B');
    secB.forEach((q, idx) => {
        bodyXml += renderXmlQuestion(idx + 26, q);
    });

    bodyXml += sectPr;

    const finalDocXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 w15 wp14"><w:body>${bodyXml}</w:body></w:document>`;

    zip.file('word/document.xml', finalDocXml);
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Generate the corresponding Answer Key DOCX with a 4-column compact table
function generateAnswerKeyDocx(departmentName, institutionName, campusName, questions) {
    const templatePath = path.join(__dirname, 'public', 'question_paper_template.docx');
    const content = fs.readFileSync(templatePath);
    const zip = new PizzaZip(content);
    const originalDocXml = zip.files['word/document.xml'].asText();
    
    const sectPrMatch = originalDocXml.match(/<w:sectPr\b[^>]*>.*?<\/w:sectPr>/);
    const sectPr = sectPrMatch ? sectPrMatch[0] : '';
    
    let bodyXml = `
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
                <w:t>SRM INSTITUTE OF SCIENCE AND TECHNOLOGY</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
                <w:t>FACULTY OF ${institutionName.toUpperCase()} - ${campusName.toUpperCase()}</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
                <w:t>DEPARTMENT OF ${departmentName.toUpperCase()}</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:u w:val="single"/></w:rPr>
                <w:t>Ph.D. Entrance Examination (July 2026) - ANSWER KEY</w:t>
            </w:r>
        </w:p>
        <w:p><w:pPr><w:spacing w:before="200" w:after="200"/></w:pPr></w:p>
    `;

    let tableRows = '';
    
    // Add Table Header Row
    tableRows += `
        <w:tr>
            <w:tc>
                <w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:fill="F2F2F2"/></w:tcPr>
                <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Question No.</w:t></w:r></w:p>
            </w:tc>
            <w:tc>
                <w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:fill="F2F2F2"/></w:tcPr>
                <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Correct Answer</w:t></w:r></w:p>
            </w:tc>
            <w:tc>
                <w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:fill="F2F2F2"/></w:tcPr>
                <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Question No.</w:t></w:r></w:p>
            </w:tc>
            <w:tc>
                <w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:fill="F2F2F2"/></w:tcPr>
                <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Correct Answer</w:t></w:r></w:p>
            </w:tc>
        </w:tr>
    `;

    const secA = questions.filter(q => q.section === 'A');
    const secB = questions.filter(q => q.section === 'B');

    for (let r = 0; r < 25; r++) {
        const qLeft = secA[r] || { answer: 'N/A' };
        const qRight = secB[r] || { answer: 'N/A' };
        
        tableRows += `
            <w:tr>
                <w:tc>
                    <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
                    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${r + 1}</w:t></w:r></w:p>
                </w:tc>
                <w:tc>
                    <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
                    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${qLeft.answer || '—'}</w:t></w:r></w:p>
                </w:tc>
                <w:tc>
                    <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
                    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${r + 26}</w:t></w:r></w:p>
                </w:tc>
                <w:tc>
                    <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
                    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${qRight.answer || '—'}</w:t></w:r></w:p>
                </w:tc>
            </w:tr>
        `;
    }

    bodyXml += `
        <w:tbl>
            <w:tblPr>
                <w:tblStyle w:val="TableGrid"/>
                <w:tblW w:w="8000" w:type="dxa"/>
                <w:jc w:val="center"/>
                <w:tblBorders>
                    <w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>
                    <w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>
                    <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
                    <w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>
                    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                </w:tblBorders>
            </w:tblPr>
            ${tableRows}
        </w:tbl>
    `;

    bodyXml += sectPr;

    const finalDocXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 w15 wp14"><w:body>${bodyXml}</w:body></w:document>`;

    zip.file('word/document.xml', finalDocXml);
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Admin Upload Past Session (Reference) Question Paper Route
app.post('/api/admin/upload-past-question-paper', requireAuth(['admin', 'super_admin']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { department_id, campus_id, session, set } = req.body;
    
    if (!department_id || !campus_id || !session || !set) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Missing required fields: department_id, campus_id, session, set' });
    }
    
    if (!['A', 'B'].includes(set.toUpperCase())) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid set. Must be 'A' or 'B'." });
    }
    
    if (!['July-2025', 'January-2026', 'July-2026'].includes(session)) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid session. Must be 'July-2025', 'January-2026', or 'July-2026'." });
    }

    let sessionPrefix = '';
    if (session === 'July-2025') sessionPrefix = 'JUL25';
    else if (session === 'January-2026') sessionPrefix = 'JAN';
    else if (session === 'July-2026') sessionPrefix = 'JUL';
    const setName = `${sessionPrefix}_${set.toUpperCase()}`;
    const user = req.user;
    const campusId = parseInt(campus_id);
    const deptId = parseInt(department_id);

    const permanentFilename = `past_${deptId}_${campusId}_${setName}.docx`;
    const permanentPath = path.join(qpUploadDir, permanentFilename);

    try {
        const parsedQuestions = parseQuestionPaperDocx(req.file.path);
        
        if (!parsedQuestions || parsedQuestions.length === 0) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Could not parse any MCQs from the question paper. Please verify the template formatting." });
        }

        fs.copyFileSync(req.file.path, permanentPath);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run(`INSERT OR REPLACE INTO question_papers 
                (department_id, campus_id, set_name, file_name, file_path, uploaded_by) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [deptId, campusId, setName, req.file.originalname, `/uploads/question_papers/${permanentFilename}`, user.id],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }

                    const qpId = this.changes === 0 ? null : this.lastID;
                    
                    const insertQuestions = (paperId) => {
                        db.run(`DELETE FROM questions WHERE question_paper_id = ?`, [paperId], (delErr) => {
                            if (delErr) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: delErr.message });
                            }

                            const stmt = db.prepare(`INSERT INTO questions 
                                (question_paper_id, section, q_no, question_text, option_a, option_b, option_c, option_d, correct_answer) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                            parsedQuestions.forEach(q => {
                                stmt.run(paperId, q.section, q.qNo, q.question, q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || '', q.answer || null);
                            });

                            stmt.finalize((finErr) => {
                                if (finErr) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: finErr.message });
                                }

                                db.run('COMMIT', (commitErr) => {
                                    if (commitErr) {
                                        return res.status(500).json({ error: commitErr.message });
                                    }
                                    res.json({
                                        success: true,
                                        message: `Successfully uploaded and parsed past ${session} Set ${set.toUpperCase()} question paper.`,
                                        questionsParsedCount: parsedQuestions.length
                                    });
                                });
                            });
                        });
                    };

                    if (qpId) {
                        insertQuestions(qpId);
                    } else {
                        db.get(`SELECT id FROM question_papers WHERE department_id = ? AND campus_id = ? AND set_name = ?`,
                            [deptId, campusId, setName], (selectErr, row) => {
                                if (selectErr || !row) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: selectErr ? selectErr.message : "Error identifying replaced paper record" });
                                }
                                insertQuestions(row.id);
                            });
                    }
                }
            );
        });
    } catch (e) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: e.message });
    }
});

// 1. HOD Upload Route
app.post('/api/hod/upload-question-paper', requireAuth(['hod']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { set } = req.body;
    if (!set || !['A', 'B'].includes(set.toUpperCase())) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid set option. Must be 'A' or 'B'." });
    }

    db.get("SELECT value FROM settings WHERE key = 'deadline_question_paper'", [], (err, row) => {
        if (err) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: 'Failed to check deadlines' });
        }
        if (row && row.value) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(row.value);
            deadlineDate.setHours(0, 0, 0, 0);
            if (today > deadlineDate) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(403).json({ error: 'The deadline for uploading question papers has passed.' });
            }
        }

        const setName = set.toUpperCase();
        const user = req.user;
        const campusId = user.campus_id;
        const deptId = user.department_id;

        // Fetch department and campus names
        db.get(`SELECT d.name as dept_name, c.name as campus_name 
                FROM departments d
                LEFT JOIN campuses c ON c.id = ?
                WHERE d.id = ?`, [campusId, deptId], (dcErr, dcRow) => {
            if (dcErr || !dcRow) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(500).json({ error: dcErr ? dcErr.message : "Department / Campus not found" });
            }

            const deptName = dcRow.dept_name;
            const campusName = dcRow.campus_name;
            const campusCode = getCampusCode(campusName, campusId);
            const deptCode = getDepartmentCode(deptName);
            const session = 'Jan27';

            // Standard naming: RMP_A_CSE_Jan27.docx / TRY_B_MECH_Jan27.docx
            const standardFilename = `${campusCode}_${setName}_${deptCode}_${session}.docx`;
            const organizedDir = path.join(qpUploadDir, session, campusCode, deptCode);
            if (!fs.existsSync(organizedDir)) {
                fs.mkdirSync(organizedDir, { recursive: true });
            }
            const organizedFilePath = path.join(organizedDir, standardFilename);
            const legacyFilename = `${deptId}_${campusId}_${setName}.docx`;
            const legacyPath = path.join(qpUploadDir, legacyFilename);

            try {
                // Parse the DOCX to verify questions format and answers detection
                const parsedQuestions = parseQuestionPaperDocx(req.file.path);
                
                if (!parsedQuestions || parsedQuestions.length === 0) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    return res.status(400).json({ error: "Could not parse any MCQs from the question paper. Please verify the template formatting." });
                }

                // Fetch past questions for this department name with detailed metadata
                db.all(`SELECT q.q_no, q.section, q.question_text, qp.set_name, qp.file_name 
                        FROM questions q 
                        JOIN question_papers qp ON q.question_paper_id = qp.id 
                        JOIN departments d ON qp.department_id = d.id 
                        WHERE d.name = ? AND qp.set_name NOT IN ('A', 'B')`,
                    [deptName], (pqErr, pastQuestions) => {
                        if (pqErr) {
                            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                            return res.status(500).json({ error: pqErr.message });
                        }

                        // Check duplicate count and collect exact match details
                        const cleanText = (txt) => (txt || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                        const matchedDuplicates = [];

                        parsedQuestions.forEach(q => {
                            const qClean = cleanText(q.question);
                            if (!qClean || qClean.length < 5) return;

                            const match = (pastQuestions || []).find(pq => {
                                const pqClean = cleanText(pq.question_text);
                                return pqClean === qClean || 
                                       (qClean.length > 25 && pqClean.includes(qClean)) || 
                                       (pqClean.length > 25 && qClean.includes(pqClean));
                            });

                            if (match) {
                                let sessionName = 'Past Session';
                                let setNameFormatted = match.set_name;
                                if (match.set_name.startsWith('JAN')) {
                                    sessionName = 'January 2026';
                                    setNameFormatted = match.set_name.replace('JAN_', 'Set ');
                                } else if (match.set_name.startsWith('JUL')) {
                                    sessionName = 'July 2026';
                                    setNameFormatted = match.set_name.replace('JUL_', 'Set ');
                                }

                                matchedDuplicates.push({
                                    uploaded_set: setName,
                                    uploaded_q_no: q.qNo,
                                    uploaded_section: q.section,
                                    matched_session: sessionName,
                                    matched_set: setNameFormatted,
                                    matched_q_no: match.q_no,
                                    matched_section: match.section,
                                    question_text: q.question
                                });
                            }
                        });

                        const duplicateCount = matchedDuplicates.length;
                        if (duplicateCount > 10) {
                            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                            return res.status(400).json({ 
                                error: `Upload rejected: Too many repeated questions. You have used ${duplicateCount} questions from past sessions (January/July 2026). A maximum of 10 repeated questions is allowed.`,
                                duplicateCount: duplicateCount,
                                maxAllowed: 10,
                                duplicates: matchedDuplicates
                            });
                        }

                        // Copy to organized permanent location and legacy location
                        fs.copyFileSync(req.file.path, organizedFilePath);
                        fs.copyFileSync(req.file.path, legacyPath);
                        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

                        db.serialize(() => {
                            db.run('BEGIN TRANSACTION');

                            // Insert or replace in question_papers
                            db.run(`INSERT OR REPLACE INTO question_papers 
                                (department_id, campus_id, set_name, file_name, file_path, uploaded_by) 
                                VALUES (?, ?, ?, ?, ?, ?)`,
                                [deptId, campusId, setName, standardFilename, `/uploads/question_papers/${session}/${campusCode}/${deptCode}/${standardFilename}`, user.id],
                                function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: err.message });
                                    }

                                    const qpId = this.changes === 0 ? null : this.lastID;
                                    
                                    const insertQuestions = (paperId) => {
                                        db.run(`DELETE FROM questions WHERE question_paper_id = ?`, [paperId], (delErr) => {
                                            if (delErr) {
                                                db.run('ROLLBACK');
                                                return res.status(500).json({ error: delErr.message });
                                            }

                                            const stmt = db.prepare(`INSERT INTO questions 
                                                (question_paper_id, section, q_no, question_text, option_a, option_b, option_c, option_d, correct_answer) 
                                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                                            parsedQuestions.forEach(q => {
                                                stmt.run(paperId, q.section, q.qNo, q.question, q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || '', q.answer || null);
                                            });

                                            stmt.finalize((finErr) => {
                                                if (finErr) {
                                                    db.run('ROLLBACK');
                                                    return res.status(500).json({ error: finErr.message });
                                                }

                                                db.run('COMMIT', (commitErr) => {
                                                    if (commitErr) {
                                                        return res.status(500).json({ error: commitErr.message });
                                                    }
                                                    res.json({
                                                        success: true,
                                                        message: `Successfully uploaded Set ${setName} (${standardFilename}) with ${parsedQuestions.length} parsed MCQs. (${duplicateCount} repeated questions detected, allowed: ≤ 10).`,
                                                        fileName: standardFilename,
                                                        duplicateCount: duplicateCount,
                                                        duplicates: matchedDuplicates,
                                                        questionsParsedCount: parsedQuestions.length
                                                    });
                                                });
                                            });
                                        });
                                    };

                                    if (qpId) {
                                        insertQuestions(qpId);
                                    } else {
                                        db.get(`SELECT id FROM question_papers WHERE department_id = ? AND campus_id = ? AND set_name = ?`,
                                            [deptId, campusId, setName], (selectErr, row) => {
                                                if (selectErr || !row) {
                                                    db.run('ROLLBACK');
                                                    return res.status(500).json({ error: selectErr ? selectErr.message : "Error identifying replaced paper record" });
                                                }
                                                insertQuestions(row.id);
                                            });
                                    }
                                }
                            );
                        });
                    });
            } catch (parseErr) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: `Parsing error: ${parseErr.message}` });
            }
        });
    });
});

// 2. HOD status Check
app.get('/api/hod/question-papers', requireAuth(['hod']), (req, res) => {
    const user = req.user;
    db.all(`SELECT id, set_name, file_name, file_path, created_at 
            FROM question_papers 
            WHERE department_id = ? AND campus_id = ?`,
        [user.department_id, user.campus_id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ questionPapers: rows });
        }
    );
});

// DELETE Question Paper Route (accessible by HOD for their department, or Admin/Super Admin)
app.delete('/api/question-papers/:id', requireAuth(['hod', 'admin', 'super_admin']), (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Question paper ID is required' });
    
    const user = req.user;
    
    db.get('SELECT * FROM question_papers WHERE id = ?', [id], (err, paper) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!paper) return res.status(404).json({ error: 'Question paper not found' });
        
        // HOD role authorization check
        if (user.role === 'hod') {
            if (paper.department_id !== user.department_id || paper.campus_id !== user.campus_id) {
                return res.status(403).json({ error: 'Access denied: You can only delete papers for your own department.' });
            }
        }
        
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Delete questions from questions table
            db.run('DELETE FROM questions WHERE question_paper_id = ?', [id], (delQErr) => {
                if (delQErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: delQErr.message });
                }
                
                db.run('DELETE FROM question_papers WHERE id = ?', [id], function(delQPErr) {
                    if (delQPErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: delQPErr.message });
                    }
                    
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            return res.status(500).json({ error: commitErr.message });
                        }
                        
                        // Delete file on disk if it exists
                        if (paper.file_path) {
                            const diskPath = path.join(__dirname, 'uploads', 'question_papers', path.basename(paper.file_path));
                            if (fs.existsSync(diskPath)) {
                                try {
                                    fs.unlinkSync(diskPath);
                                } catch (fileErr) {
                                    console.error(`Failed to delete file on disk: ${diskPath}`, fileErr);
                                }
                            }
                        }
                        
                        res.json({ success: true, message: 'Question paper deleted successfully.' });
                    });
                });
            });
        });
    });
});

// 2.5 HOD Past Question Paper Download
app.get('/api/hod/past-question-papers/download', requireAuth(['hod']), (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Question paper ID is required' });

    db.get(`SELECT * FROM question_papers WHERE id = ?`, [id], (err, paper) => {
        if (err || !paper) {
            return res.status(404).json({ error: 'Question paper not found' });
        }

        const user = req.user;
        // Verify ownership (department & campus match)
        if (paper.department_id !== user.department_id || paper.campus_id !== user.campus_id) {
            return res.status(403).json({ error: 'Access denied: You can only download papers for your department and campus.' });
        }

        // Verify it is a past paper
        if (!['JAN_A', 'JAN_B', 'JUL_A', 'JUL_B'].includes(paper.set_name)) {
            return res.status(400).json({ error: 'Only past session question papers can be downloaded.' });
        }

        const filePath = path.join(__dirname, 'uploads', 'question_papers', path.basename(paper.file_path));
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Physical file not found' });
        }

        res.download(filePath, paper.file_name);
    });
});


// 3. Admin status Check
app.get('/api/admin/question-papers', requireAuth(['admin', 'super_admin']), (req, res) => {
    const campusId = req.user.role === 'super_admin' ? null : req.user.campus_id;
    
    const query = `
        SELECT 
            d.id as dept_id, 
            d.name as dept_name, 
            i.campus_id, 
            c.name as campus_name,
            qp.id as paper_id,
            qp.set_name,
            qp.file_name,
            qp.created_at
        FROM departments d
        JOIN institutions i ON d.institution_id = i.id
        JOIN campuses c ON i.campus_id = c.id
        LEFT JOIN question_papers qp ON qp.department_id = d.id AND qp.campus_id = c.id
        ${campusId ? 'WHERE c.id = ?' : ''}
        ORDER BY d.name, c.name
    `;

    const params = campusId ? [campusId] : [];

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const deptsMap = {};
        rows.forEach(r => {
            const key = r.dept_id;
            if (!deptsMap[key]) {
                deptsMap[key] = {
                    id: r.dept_id,
                    name: r.dept_name,
                    campuses: {}
                };
            }
            if (!deptsMap[key].campuses[r.campus_name]) {
                deptsMap[key].campuses[r.campus_name] = {
                    campus_id: r.campus_id,
                    setA: null,
                    setB: null
                };
            }
            if (r.set_name === 'A') {
                deptsMap[key].campuses[r.campus_name].setA = {
                    id: r.paper_id,
                    file_name: r.file_name,
                    uploaded_at: r.created_at
                };
            } else if (r.set_name === 'B') {
                deptsMap[key].campuses[r.campus_name].setB = {
                    id: r.paper_id,
                    file_name: r.file_name,
                    uploaded_at: r.created_at
                };
            }
        });

        res.json({ departments: Object.values(deptsMap) });
    });
});

// 4. Admin Generate Combination ZIP
app.post('/api/admin/generate-common-question-paper', requireAuth(['admin', 'super_admin']), (req, res) => {
    const { department_id } = req.body;
    if (!department_id) return res.status(400).json({ error: 'Department ID is required' });

    db.get(`SELECT d.name as dept_name, i.name as inst_name, c.name as campus_name 
            FROM departments d
            JOIN institutions i ON d.institution_id = i.id
            JOIN campuses c ON i.campus_id = c.id
            WHERE d.id = ?`, [department_id], (deptErr, deptInfo) => {
        if (deptErr || !deptInfo) {
            return res.status(404).json({ error: deptErr ? deptErr.message : 'Department not found' });
        }

        db.all(`SELECT id FROM departments WHERE name = ?`, [deptInfo.dept_name], (deptsErr, depts) => {
            if (deptsErr || !depts || depts.length === 0) {
                return res.status(500).json({ error: deptsErr ? deptsErr.message : 'Error finding related departments' });
            }
            const deptIds = depts.map(d => d.id);
            const deptPlaceholders = deptIds.map(() => '?').join(',');

            db.all(`SELECT qp.id as paper_id, qp.campus_id, qp.set_name, c.name as campus_name
                    FROM question_papers qp
                    JOIN campuses c ON qp.campus_id = c.id
                    WHERE qp.department_id IN (${deptPlaceholders})`, deptIds, (qpErr, papers) => {
                if (qpErr) return res.status(500).json({ error: qpErr.message });
                if (!papers || papers.length === 0) {
                    return res.status(400).json({ error: 'No question papers have been uploaded for this department yet.' });
                }

                const paperIds = papers.map(p => p.paper_id);
                const placeholders = paperIds.map(() => '?').join(',');

                db.all(`SELECT * FROM questions WHERE question_paper_id IN (${placeholders})`, paperIds, (qErr, allQuestions) => {
                    if (qErr) return res.status(500).json({ error: qErr.message });

                    const papersQuestions = {};
                    paperIds.forEach(id => {
                        papersQuestions[id] = { A: [], B: [] };
                    });

                    allQuestions.forEach(q => {
                        if (papersQuestions[q.question_paper_id]) {
                            papersQuestions[q.question_paper_id][q.section].push(q);
                        }
                    });

                    function shuffleArray(array) {
                        for (let i = array.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [array[i], array[j]] = [array[j], array[i]];
                        }
                    }

                    function selectQuestions(section, totalNeeded) {
                        const N = paperIds.length;
                        const baseQty = Math.floor(totalNeeded / N);
                        let selected = [];
                        const pool = [];

                        paperIds.forEach(id => {
                            const qs = papersQuestions[id][section];
                            shuffleArray(qs);
                            
                            const qty = Math.min(baseQty, qs.length);
                            selected = selected.concat(qs.slice(0, qty));
                            
                            for (let k = qty; k < qs.length; k++) {
                                pool.push(qs[k]);
                            }
                        });

                        const remainingCount = totalNeeded - selected.length;
                        if (remainingCount > 0 && pool.length > 0) {
                            shuffleArray(pool);
                            selected = selected.concat(pool.slice(0, Math.min(remainingCount, pool.length)));
                        }

                        return selected;
                    }

                    const selectedA = selectQuestions('A', 25);
                    const selectedB = selectQuestions('B', 25);

                    if (selectedA.length < 25 || selectedB.length < 25) {
                        return res.status(400).json({ 
                            error: `Insufficient questions in uploaded sets. Need at least 25 per section. Selected A: ${selectedA.length}, Selected B: ${selectedB.length}.` 
                        });
                    }

                    shuffleArray(selectedA);
                    shuffleArray(selectedB);

                    const finalQuestions = selectedA.concat(selectedB);

                    try {
                        const qpBuffer = generateQuestionPaperDocx(deptInfo.dept_name, deptInfo.inst_name, deptInfo.campus_name, finalQuestions);
                        const keyBuffer = generateAnswerKeyDocx(deptInfo.dept_name, deptInfo.inst_name, deptInfo.campus_name, finalQuestions);

                        const zip = new PizzaZip();
                        const cleanDeptName = deptInfo.dept_name.replace(/\s+/g, '_');
                        zip.file(`Common_Question_Paper_${cleanDeptName}.docx`, qpBuffer);
                        zip.file(`Common_Answer_Key_${cleanDeptName}.docx`, keyBuffer);

                        const zipBuffer = zip.generate({ type: 'nodebuffer' });

                        res.setHeader('Content-Type', 'application/zip');
                        res.setHeader('Content-Disposition', `attachment; filename=Question_Paper_${cleanDeptName}_July2026.zip`);
                        res.send(zipBuffer);

                    } catch (genErr) {
                        res.status(500).json({ error: 'Failed to generate DOCX or ZIP: ' + genErr.message });
                    }
                });
            });
        });
    });
});

// Admin 1-Click ZIP Export structured for Google Drive
app.get('/api/admin/question-papers/export-drive-zip', requireAuth(['admin', 'super_admin']), (req, res) => {
    const session = 'Jan27';
    db.all(`
        SELECT qp.*, d.name as dept_name, c.name as campus_name
        FROM question_papers qp
        JOIN departments d ON qp.department_id = d.id
        JOIN campuses c ON qp.campus_id = c.id
        WHERE qp.set_name IN ('A', 'B')
        ORDER BY c.name, d.name, qp.set_name
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.status(400).json({ error: 'No Set A or Set B question papers uploaded yet.' });
        }

        try {
            const zip = new PizzaZip();
            let addedCount = 0;

            rows.forEach(paper => {
                const campusCode = getCampusCode(paper.campus_name, paper.campus_id);
                const deptCode = getDepartmentCode(paper.dept_name);
                const standardFilename = `${campusCode}_${paper.set_name}_${deptCode}_${session}.docx`;

                // Try structured path first, then legacy path, then direct DB path
                const structuredPath = path.join(qpUploadDir, session, campusCode, deptCode, standardFilename);
                const legacyPath = path.join(qpUploadDir, `${paper.department_id}_${paper.campus_id}_${paper.set_name}.docx`);
                const directPath = paper.file_path ? path.join(__dirname, paper.file_path.replace(/^\//, '')) : null;

                let fileBuffer = null;
                if (fs.existsSync(structuredPath)) {
                    fileBuffer = fs.readFileSync(structuredPath);
                } else if (directPath && fs.existsSync(directPath)) {
                    fileBuffer = fs.readFileSync(directPath);
                } else if (fs.existsSync(legacyPath)) {
                    fileBuffer = fs.readFileSync(legacyPath);
                }

                if (fileBuffer) {
                    const zipPath = `${session}/${campusCode}/${deptCode}/${standardFilename}`;
                    zip.file(zipPath, fileBuffer);
                    addedCount++;
                }
            });

            if (addedCount === 0) {
                return res.status(404).json({ error: 'Could not find physical question paper files on disk to package.' });
            }

            const zipBuffer = zip.generate({ type: 'nodebuffer' });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename=PhD_Question_Papers_${session}_GoogleDrive.zip`);
            res.send(zipBuffer);
        } catch (zipErr) {
            console.error('Error generating Google Drive ZIP:', zipErr);
            res.status(500).json({ error: 'Failed to generate ZIP: ' + zipErr.message });
        }
    });
});

app.get('/api/admin/entrance-exam-docs/download', requireAuth(['admin', 'super_admin']), (req, res) => {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });
    
    const safeFilename = path.basename(filename);
    const filePath = path.join(__dirname, 'Ramapuram', 'S&H-Printout', 'S&H', 'entranceexam', safeFilename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath, safeFilename);
});

app.get('/api/admin/email-log', requireAuth(['admin', 'super_admin']), (req, res) => {
    db.all(`
        SELECT el.*, COALESCE(el.recipient_name, c.registered_name) AS registered_name, c.application_no 
        FROM email_logs el 
        LEFT JOIN candidates c ON el.candidate_id = c.id
        ORDER BY el.sent_at DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: rows });
    });
});

app.get('/api/admin/audit-logs', requireAuth(['admin','super_admin']), (req,res) => {
    const page = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return res.status(400).json({error:'Invalid page or page size.'});
    const clauses = [], params = [];
    const campus = req.user.role === 'super_admin' ? req.query.campus_id : req.user.campus_id;
    if(campus != null && campus !== '') {
        if(!Number.isInteger(Number(campus)) || Number(campus) < 1) return res.status(400).json({error:'Invalid campus.'});
        clauses.push('COALESCE(a.campus_id,u.campus_id)=?'); params.push(Number(campus));
    } else if(req.user.role !== 'super_admin') return res.status(403).json({error:'No campus assigned.'});
    const scope = clauses.length ? ' WHERE '+clauses.join(' AND ') : '';
    const scopeParams = [...params];
    const q = String(req.query.q || '').trim().slice(0,200);
    if(q) { clauses.push('(a.description LIKE ? OR a.action_type LIKE ? OR a.target_id LIKE ? OR COALESCE(a.actor_name,u.name) LIKE ? OR COALESCE(a.actor_username,u.username) LIKE ?)'); params.push(...Array(5).fill('%'+q+'%')); }
    if(req.query.action) {clauses.push('a.action_type=?');params.push(String(req.query.action));}
    for(const [key,operator] of [['from','>='],['to','<=']]) {
        if(!req.query[key]) continue;
        const date=String(req.query[key]);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) return res.status(400).json({error:'Invalid date filter.'});
        clauses.push("date(a.created_at,'+330 minutes') "+operator+' ?');params.push(date);
    }
    if(req.query.from && req.query.to && req.query.from > req.query.to) return res.status(400).json({error:'Start date must not be after end date.'});
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
    const join=' FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id';
    db.get('SELECT COUNT(*) total'+join+where,params,(error,count)=>{
        if(error)return res.status(500).json({error:error.message});
        db.all("SELECT a.*,COALESCE(a.actor_name,u.name,'Deleted user') user_name,COALESCE(a.actor_username,u.username) username,COALESCE(a.actor_role,u.role) user_role,COALESCE(a.campus_id,u.campus_id) actor_campus_id"+join+where+' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?',[...params,limit,(page-1)*limit],(error,logs)=>{
            if(error)return res.status(500).json({error:error.message});
            db.all('SELECT DISTINCT a.action_type'+join+scope+' ORDER BY a.action_type',scopeParams,(error,actions)=>{
                if(error)return res.status(500).json({error:error.message});
                res.json({logs,total:count.total,page,limit,action_types:actions.map(a=>a.action_type)});
            });
        });
    });
});
app.get('/api/notifications', requireAuth(), (req, res) => {
    db.all(`
        SELECT n.*, u.name as sender_name 
        FROM notifications n
        LEFT JOIN users u ON n.sender_id = u.id
        WHERE n.recipient_id = ?
        ORDER BY n.created_at DESC
        LIMIT 50
    `, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ notifications: rows });
    });
});

app.post('/api/notifications/read', requireAuth(), (req, res) => {
    db.run(`UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0`, [req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// TWO-TIER CANDIDATE VERIFICATION REMINDERS
// Tier 1: Admin sends consolidated reminder to Dean/VP (CC to RC)
// Tier 2: Dean / VP or RC sends department-wise reminders to HODs (cross-CC)
// ══════════════════════════════════════════════════════════════════════════════

// Helper to query all pending HOD verification candidates with Dean & RC info
function queryPendingCandidates(scopeWhere, scopeParams, cb) {
    const sql = `
        SELECT 
            c.id, c.application_no, c.registered_name, c.status,
            c.department_id, c.institution_id,
            d.name as department_name,
            i.name as institution_name, i.campus_id,
            u.name as hod_name, u.email as hod_email, u.username as hod_username,
            COALESCE(u_dean.name, u_dean2.name, 'Dean / VP Research') as dean_name,
            COALESCE(u_dean.email, u_dean2.email, 'dean@srmist.edu.in') as dean_email,
            COALESCE(coord.name, 'Research Coordinator') as coord_name,
            COALESCE(coord.email, 'coord@srmist.edu.in') as coord_email
        FROM candidates c
        JOIN departments d ON c.department_id = d.id
        JOIN institutions i ON c.institution_id = i.id
        JOIN users u ON u.role = 'hod' AND u.department_id = c.department_id AND u.campus_id = c.campus_id
        LEFT JOIN users u_dean ON u_dean.username = i.dean_username
        LEFT JOIN users u_dean2 ON (u_dean2.institution_id = i.id AND u_dean2.role = 'dean')
        LEFT JOIN users coord ON coord.username = i.coord_username
        WHERE ${scopeWhere}
          AND c.status = 'Under HOD Verification'
          AND c.current_owner = 'HOD'
        ORDER BY i.name, d.name, c.application_no
    `;
    db.all(sql, scopeParams, cb);
}

// ──────────────────────────────────────────────────────────────────────────────
// TIER 1: ADMIN -> DEAN/VP (CC: RC)
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/admin/remind-deans/preview - Generate consolidated drafts for Admin review
app.get('/api/admin/remind-deans/preview', requireAuth(['admin', 'super_admin']), (req, res) => {
    const user = req.user;
    let scopeWhere = 'c.campus_id = ?';
    let scopeParams = [user.campus_id || 1];
    if (user.role === 'super_admin' && req.query.campus_id) {
        scopeParams = [req.query.campus_id];
    }

    queryPendingCandidates(scopeWhere, scopeParams, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.json({ success: true, total_pending: 0, drafts: [], message: 'No pending HOD verifications found.' });
        }

        // Group candidates by institution
        const instMap = {};
        rows.forEach(r => {
            if (!instMap[r.institution_id]) {
                instMap[r.institution_id] = {
                    institution_id: r.institution_id,
                    institution_name: r.institution_name,
                    dean_name: r.dean_name,
                    dean_email: r.dean_email,
                    coord_name: r.coord_name,
                    coord_email: r.coord_email,
                    candidate_count: 0,
                    departments: {}
                };
            }
            if (!instMap[r.institution_id].departments[r.department_name]) {
                instMap[r.institution_id].departments[r.department_name] = {
                    hod_name: r.hod_name,
                    hod_email: r.hod_email,
                    candidates: []
                };
            }
            instMap[r.institution_id].departments[r.department_name].candidates.push({
                id: r.id, application_no: r.application_no, name: r.registered_name
            });
            instMap[r.institution_id].candidate_count++;
        });

        const fromEmail = user.email || getFromEmail(user.campus_id);
        const drafts = Object.values(instMap).map(inst => {
            const deptSections = Object.entries(inst.departments).map(([dname, dinfo]) => {
                const cList = dinfo.candidates.map((c, i) => `    ${i + 1}. ${c.application_no} - ${c.name}`).join('\n');
                return `• Department of ${dname} (HOD: ${dinfo.hod_name}) — ${dinfo.candidates.length} pending:\n${cList}`;
            }).join('\n\n');

            const subject = `[Action Required] Pending PhD Eligibility Verifications — ${inst.institution_name}`;
            const body = `Dear ${inst.dean_name},
CC: ${inst.coord_name} (Research Coordinator),

This is an official communication from the Directorate of Research regarding pending PhD applications for the July 2026 session.

The following candidate application(s) under your faculty (${inst.institution_name}) are currently awaiting eligibility verification by the respective department HODs:

Faculty: ${inst.institution_name}
Total Pending Applications: ${inst.candidate_count}

Department Breakdown:
${deptSections}

Kindly review and issue department-wise reminders to the respective HODs to complete the eligibility checks in the PhD Admissions Portal at the earliest.

PhD Admissions Portal: http://localhost:3000

Warm Regards,
${user.name}
Directorate of Research
SRM Institute of Science and Technology`;

            return {
                institution_id: inst.institution_id,
                institution_name: inst.institution_name,
                from_name: user.name,
                from_email: fromEmail,
                to_name: inst.dean_name,
                to_email: inst.dean_email,
                cc_name: inst.coord_name,
                cc_email: inst.coord_email,
                subject,
                body,
                candidate_count: inst.candidate_count,
                dept_count: Object.keys(inst.departments).length,
                first_cand_id: Object.values(inst.departments)[0].candidates[0].id
            };
        });

        res.json({
            success: true,
            total_pending: rows.length,
            drafts
        });
    });
});

// POST /api/admin/remind-deans - Send consolidated reminders to Deans/VPs (CC to RC)
app.post('/api/admin/remind-deans', requireAuth(['admin', 'super_admin']), async (req, res) => {
    const user = req.user;
    let scopeWhere = 'c.campus_id = ?';
    let scopeParams = [user.campus_id || 1];
    if (user.role === 'super_admin' && req.body.campus_id) {
        scopeParams = [req.body.campus_id];
    }

    queryPendingCandidates(scopeWhere, scopeParams, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.json({ success: true, message: 'No pending HOD verifications found. All HODs are up to date!', reminded: 0 });
        }

        const instMap = {};
        rows.forEach(r => {
            if (!instMap[r.institution_id]) {
                instMap[r.institution_id] = {
                    institution_id: r.institution_id,
                    institution_name: r.institution_name,
                    dean_name: r.dean_name,
                    dean_email: r.dean_email,
                    coord_name: r.coord_name,
                    coord_email: r.coord_email,
                    candidate_count: 0,
                    departments: {}
                };
            }
            if (!instMap[r.institution_id].departments[r.department_name]) {
                instMap[r.institution_id].departments[r.department_name] = {
                    hod_name: r.hod_name,
                    hod_email: r.hod_email,
                    candidates: []
                };
            }
            instMap[r.institution_id].departments[r.department_name].candidates.push({
                id: r.id, application_no: r.application_no, name: r.registered_name
            });
            instMap[r.institution_id].candidate_count++;
        });

        const transporter = getMailTransporter();
        const fromEmail = user.email || getFromEmail(user.campus_id);
        let deansSent = 0;
        let logged = 0;

        for (const inst of Object.values(instMap)) {
            const deptSections = Object.entries(inst.departments).map(([dname, dinfo]) => {
                const cList = dinfo.candidates.map((c, i) => `    ${i + 1}. ${c.application_no} - ${c.name}`).join('\n');
                return `• Department of ${dname} (HOD: ${dinfo.hod_name}) — ${dinfo.candidates.length} pending:\n${cList}`;
            }).join('\n\n');

            const subject = `[Action Required] Pending PhD Eligibility Verifications — ${inst.institution_name}`;
            const body = `Dear ${inst.dean_name},
CC: ${inst.coord_name} (Research Coordinator),

This is an official communication from the Directorate of Research regarding pending PhD applications for the July 2026 session.

The following candidate application(s) under your faculty (${inst.institution_name}) are currently awaiting eligibility verification by the respective department HODs:

Faculty: ${inst.institution_name}
Total Pending Applications: ${inst.candidate_count}

Department Breakdown:
${deptSections}

Kindly review and issue department-wise reminders to the respective HODs to complete the eligibility checks in the PhD Admissions Portal at the earliest.

PhD Admissions Portal: http://localhost:3000

Warm Regards,
${user.name}
Directorate of Research
SRM Institute of Science and Technology`;

            const firstCandId = Object.values(inst.departments)[0].candidates[0].id;
            const mailOpts = {
                from: `"${user.name}" <${fromEmail}>`,
                replyTo: user.email || fromEmail,
                to: inst.dean_email,
                subject,
                text: body
            };
            if (inst.coord_email && inst.coord_email !== inst.dean_email) {
                mailOpts.cc = inst.coord_email;
            }

            if (transporter && inst.dean_email) {
                try {
                    await transporter.sendMail(mailOpts);
                    logEmail(firstCandId, inst.dean_email, subject, body,
                        `Consolidated Reminder Sent to Dean (${inst.dean_name}, CC: ${inst.coord_name})`, inst.dean_name);
                    deansSent++;
                } catch (ex) {
                    logEmail(firstCandId, inst.dean_email, subject, body,
                        `Consolidated Reminder Failed (${ex.message})`, inst.dean_name);
                    logged++;
                }
            } else {
                logEmail(firstCandId, inst.dean_email || 'unknown', subject, body,
                    `Consolidated Reminder Logged (Mock) — Dean: ${inst.dean_name}, CC: ${inst.coord_name}, Faculty: ${inst.institution_name}, Pending: ${inst.candidate_count}`, inst.dean_name);
                logged++;
            }
        }

        res.json({
            success: true,
            message: `Consolidated reminders processed for ${Object.keys(instMap).length} faculty/institution(s). ${rows.length} pending candidate(s) covered. Deans notified: ${deansSent}, Logged: ${logged}.`,
            deans_sent: deansSent,
            logged,
            institutions_count: Object.keys(instMap).length,
            total_pending: rows.length
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// TIER 2: DEAN / VP / RC -> DEPARTMENT HODs (CROSS-CC)
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/faculty/remind-hods/preview - Generate department-wise drafts for Dean/RC review
app.get('/api/faculty/remind-hods/preview', requireAuth(['dean', 'coordinator', 'admin', 'super_admin']), (req, res) => {
    const user = req.user;
    let scopeWhere = 'c.campus_id = ?';
    let scopeParams = [user.campus_id || 1];

    if (user.role === 'coordinator') {
        scopeWhere += ' AND (i.coord_username = ? OR c.institution_id = ?)';
        scopeParams.push(user.username, user.institution_id);
    } else if (user.role === 'dean') {
        scopeWhere += ' AND (i.dean_username = ? OR u_dean2.username = ? OR c.institution_id = ?)';
        scopeParams.push(user.username, user.username, user.institution_id);
    }

    queryPendingCandidates(scopeWhere, scopeParams, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.json({ success: true, total_pending: 0, drafts: [], message: 'No pending HOD verifications found in your faculty.' });
        }

        // Group by department
        const deptMap = {};
        rows.forEach(r => {
            if (!deptMap[r.department_id]) {
                deptMap[r.department_id] = {
                    department_id: r.department_id,
                    department_name: r.department_name,
                    institution_name: r.institution_name,
                    hod_name: r.hod_name,
                    hod_email: r.hod_email,
                    dean_name: r.dean_name,
                    dean_email: r.dean_email,
                    coord_name: r.coord_name,
                    coord_email: r.coord_email,
                    candidates: []
                };
            }
            deptMap[r.department_id].candidates.push({
                id: r.id, application_no: r.application_no, name: r.registered_name
            });
        });

        const fromEmail = user.email || getFromEmail(user.campus_id);
        const drafts = Object.values(deptMap).map(dept => {
            // Determine CC: If user is Dean -> CC RC; If user is RC -> CC Dean
            let ccName = dept.coord_name;
            let ccEmail = dept.coord_email;
            let roleLabel = 'Dean / VP Research';
            if (user.role === 'coordinator') {
                ccName = dept.dean_name;
                ccEmail = dept.dean_email;
                roleLabel = 'Research Coordinator';
            }

            const candidateListText = dept.candidates.map((c, i) =>
                `  ${i + 1}. ${c.application_no} - ${c.name}`
            ).join('\n');

            const subject = `[Action Required] Pending PhD Eligibility Verifications — Department of ${dept.department_name}`;
            const body = `Dear ${dept.hod_name},

This is a reminder regarding candidate applications in the Department of ${dept.department_name} awaiting eligibility verification in the PhD Admissions Portal (July 2026 session).

Faculty: ${dept.institution_name}
Department: ${dept.department_name}
${ccName ? `CC: ${ccName}` : ''}

Pending Candidates:
${candidateListText}

Please log in to the PhD Admissions Portal and complete the eligibility verification for each candidate listed above at the earliest.

PhD Admissions Portal: http://localhost:3000

Warm Regards,
${user.name}
${roleLabel}
${dept.institution_name}
SRM Institute of Science and Technology`;

            return {
                department_id: dept.department_id,
                department_name: dept.department_name,
                institution_name: dept.institution_name,
                from_name: user.name,
                from_email: fromEmail,
                to_name: dept.hod_name,
                to_email: dept.hod_email,
                cc_name: ccName,
                cc_email: ccEmail,
                subject,
                body,
                candidate_count: dept.candidates.length,
                candidates: dept.candidates,
                first_cand_id: dept.candidates[0].id
            };
        });

        res.json({
            success: true,
            total_pending: rows.length,
            drafts
        });
    });
});

// POST /api/faculty/remind-hods - Send department-wise reminders to HODs
app.post('/api/faculty/remind-hods', requireAuth(['dean', 'coordinator', 'admin', 'super_admin']), async (req, res) => {
    const user = req.user;
    let scopeWhere = 'c.campus_id = ?';
    let scopeParams = [user.campus_id || 1];

    if (user.role === 'coordinator') {
        scopeWhere += ' AND (i.coord_username = ? OR c.institution_id = ?)';
        scopeParams.push(user.username, user.institution_id);
    } else if (user.role === 'dean') {
        scopeWhere += ' AND (i.dean_username = ? OR u_dean2.username = ? OR c.institution_id = ?)';
        scopeParams.push(user.username, user.username, user.institution_id);
    }

    queryPendingCandidates(scopeWhere, scopeParams, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.json({ success: true, message: 'No pending HOD verifications found in your faculty.', reminded: 0 });
        }

        const deptMap = {};
        rows.forEach(r => {
            if (!deptMap[r.department_id]) {
                deptMap[r.department_id] = {
                    department_id: r.department_id,
                    department_name: r.department_name,
                    institution_name: r.institution_name,
                    hod_name: r.hod_name,
                    hod_email: r.hod_email,
                    dean_name: r.dean_name,
                    dean_email: r.dean_email,
                    coord_name: r.coord_name,
                    coord_email: r.coord_email,
                    candidates: []
                };
            }
            deptMap[r.department_id].candidates.push({
                id: r.id, application_no: r.application_no, name: r.registered_name
            });
        });

        const transporter = getMailTransporter();
        const fromEmail = user.email || getFromEmail(user.campus_id);
        let reminded = 0;
        let logged = 0;

        for (const dept of Object.values(deptMap)) {
            let ccName = dept.coord_name;
            let ccEmail = dept.coord_email;
            let roleLabel = 'Dean / VP Research';
            if (user.role === 'coordinator') {
                ccName = dept.dean_name;
                ccEmail = dept.dean_email;
                roleLabel = 'Research Coordinator';
            }

            const candidateListText = dept.candidates.map((c, i) =>
                `  ${i + 1}. ${c.application_no} - ${c.name}`
            ).join('\n');

            const subject = `[Action Required] Pending PhD Eligibility Verifications — Department of ${dept.department_name}`;
            const body = `Dear ${dept.hod_name},

This is a reminder regarding candidate applications in the Department of ${dept.department_name} awaiting eligibility verification in the PhD Admissions Portal (July 2026 session).

Faculty: ${dept.institution_name}
Department: ${dept.department_name}
${ccName ? `CC: ${ccName}` : ''}

Pending Candidates:
${candidateListText}

Please log in to the PhD Admissions Portal and complete the eligibility verification for each candidate listed above at the earliest.

PhD Admissions Portal: http://localhost:3000

Warm Regards,
${user.name}
${roleLabel}
${dept.institution_name}
SRM Institute of Science and Technology`;

            const firstCandId = dept.candidates[0].id;
            const mailOpts = {
                from: `"${user.name}" <${fromEmail}>`,
                replyTo: user.email || fromEmail,
                to: dept.hod_email,
                subject,
                text: body
            };
            if (ccEmail && ccEmail !== dept.hod_email) {
                mailOpts.cc = ccEmail;
            }

            if (transporter && dept.hod_email) {
                try {
                    await transporter.sendMail(mailOpts);
                    const ccNote = ccEmail ? ` (CC: ${ccName})` : '';
                    logEmail(firstCandId, dept.hod_email, subject, body,
                        `Department Reminder Sent to HOD (${dept.hod_name})${ccNote}`, dept.hod_name);
                    reminded++;
                } catch (ex) {
                    logEmail(firstCandId, dept.hod_email, subject, body,
                        `Department Reminder Failed (${ex.message})`, dept.hod_name);
                    logged++;
                }
            } else {
                const ccNote = ccEmail ? `, CC: ${ccName} <${ccEmail}>` : '';
                logEmail(firstCandId, dept.hod_email || 'unknown', subject, body,
                    `Department Reminder Logged (Mock) — HOD: ${dept.hod_name}${ccNote}, Dept: ${dept.department_name}, Pending: ${dept.candidates.length}`, dept.hod_name);
                logged++;
            }
        }

        res.json({
            success: true,
            message: `Department-wise reminders processed for ${Object.keys(deptMap).length} department(s). ${rows.length} pending candidate(s) covered. HODs notified: ${reminded}, Logged: ${logged}.`,
            reminded,
            logged,
            dept_count: Object.keys(deptMap).length,
            total_pending: rows.length
        });
    });
});

// Backward-compatible alias
app.post('/api/admin/remind-hods', requireAuth(['dean', 'coordinator', 'admin', 'super_admin']), (req, res) => {
    // If admin calls remind-hods, redirect to remind-deans; if dean/coord calls, route to faculty remind-hods
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
        // Redirect logic to remind-deans
        return res.redirect(307, '/api/admin/remind-deans');
    }
    return res.redirect(307, '/api/faculty/remind-hods');
});

// --- SUPERADMIN ANALYTICS API ---
app.get('/api/superadmin/analytics', requireAuth(['super_admin']), (req, res) => {
    db.all(`
        SELECT 
            camp.name as campus_name,
            COUNT(c.id) as total_applied,
            SUM(CASE WHEN c.status = 'Eligible' OR c.status = 'HOD Verified Eligible' OR c.status = 'Verified Eligible' OR c.status = 'Entrance Exam Attended' OR c.status = 'Entrance Exam Absent' OR c.status = 'Marks Entered' OR c.status = 'Ranked' OR c.status = 'Ranks Released' OR c.status = 'Guide Allocation Open' OR c.status = 'Guide Allocated' OR c.status = 'Selection Finalized' OR c.status = 'Approved Guides' THEN 1 ELSE 0 END) as eligible_count,
            SUM(CASE WHEN c.status = 'Not Eligible' OR c.status = 'HOD Verified Ineligible' OR c.status = 'Verified Ineligible' THEN 1 ELSE 0 END) as ineligible_count,
            SUM(CASE WHEN c.exam_attendance = 'Present' THEN 1 ELSE 0 END) as present_count,
            SUM(CASE WHEN c.selection_status = 'Selected' THEN 1 ELSE 0 END) as selected_count
        FROM campuses camp
        LEFT JOIN candidates c ON c.campus_id = camp.id
        GROUP BY camp.id
    `, (err, campusStats) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(`
            SELECT i.id as institution_id, i.name as inst_name, camp.name as campus, 
                COUNT(c.id) as count,
                SUM(CASE WHEN c.status IN ('Eligible', 'HOD Verified Eligible', 'Verified Eligible', 'Entrance Exam Attended', 'Entrance Exam Absent', 'Marks Entered', 'Ranked', 'Ranks Released', 'Under Dean Review (Ranks)', 'Under RC Review (Ranks)', 'Guide Allocation Open', 'Guide Allocated', 'Selection Finalized', 'Under Dean Final Review', 'Returned to HOD (Guides)', 'Returned to RC (Guides)', 'Returned to Dean (Final)', 'Approved Guides') THEN 1 ELSE 0 END) as eligible_count,
                SUM(CASE WHEN c.status IN ('Not Eligible', 'HOD Verified Ineligible', 'Verified Ineligible') THEN 1 ELSE 0 END) as ineligible_count,
                SUM(CASE WHEN c.exam_attendance = 'Present' THEN 1 ELSE 0 END) as present_count,
                SUM(CASE WHEN c.exam_attendance = 'Absent' THEN 1 ELSE 0 END) as absent_count,
                SUM(CASE WHEN c.selection_status = 'Selected' THEN 1 ELSE 0 END) as selected_count,
                0 as selected_ft_wf,
                0 as selected_ft_ss,
                SUM(CASE WHEN c.selection_status = 'Selected' AND LOWER(c.mode_of_study) LIKE '%academic%' THEN 1 ELSE 0 END) as selected_pte_acad,
                SUM(CASE WHEN c.selection_status = 'Selected' AND LOWER(c.mode_of_study) LIKE '%industry%' THEN 1 ELSE 0 END) as selected_pte_ind,
                SUM(CASE WHEN c.selection_status = 'Selected' AND LOWER(c.mode_of_study) LIKE '%internal%' THEN 1 ELSE 0 END) as selected_pti
            FROM candidates c
            JOIN institutions i ON c.institution_id = i.id
            JOIN campuses camp ON c.campus_id = camp.id
            GROUP BY i.id
        `, (err, instStats) => {
            if (err) return res.status(500).json({ error: err.message });
            db.all("SELECT institution_id,mode_of_study FROM candidates WHERE selection_status='Selected'", [], (modeError, selected) => {
                if (modeError) return res.status(500).json({error:modeError.message});
                for (const institute of instStats) {
                    const list=selected.filter(c=>Number(c.institution_id)===Number(institute.institution_id));
                    institute.selected_ft_wf=list.filter(studyModePolicy.isFullTimeWithFellowship).length;
                    institute.selected_ft_ss=list.filter(studyModePolicy.isFullTimeWithoutFellowship).length;
                }
                res.json({ campus: campusStats, institutions: instStats });
            });
        });
    });
});
// --- CONTACT & EMAIL ROUTES ---
app.get('/api/contact/recipients', requireAuth(), (req, res) => {
    const { role, campus_id, institution_id } = req.user;
    let query = '';
    let params = [];

    if (role === 'hod') {
        // HOD can contact Coordinators in their campus AND their specific institution
        query = 'SELECT id, name, role, email FROM users WHERE role = ? AND campus_id = ? AND institution_id = ?';
        params = ['coordinator', campus_id, institution_id];
    } else if (role === 'coordinator') {
        // Coordinator can contact Admin in their campus, and HODs in their campus AND their specific institution
        query = "SELECT id, name, role, email FROM users WHERE (role = 'admin' AND campus_id = ?) OR (role = 'hod' AND campus_id = ? AND institution_id = ?)";
        params = [campus_id, campus_id, institution_id];
    } else if (role === 'admin') {
        // Admin can contact Superadmin and Coordinators in their campus
        query = "SELECT id, name, role, email FROM users WHERE role = 'super_admin' OR (role = 'coordinator' AND campus_id = ?)";
        params = [campus_id];
    } else if (role === 'super_admin') {
        // Superadmin can contact Admins
        query = "SELECT id, name, role, email FROM users WHERE role = 'admin'";
        params = [];
    }

    if (!query) return res.json({ recipients: [] });

    db.all(query, params, (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ recipients: users });
    });
});

app.post('/api/contact/send', requireAuth(), (req, res) => {
    const { recipient_id, subject, message } = req.body;
    if (!recipient_id || !subject || !message) {
        return res.status(400).json({ error: 'Recipient, subject, and message are required.' });
    }

    // Get recipient email
    db.get('SELECT email, name, role FROM users WHERE id = ?', [recipient_id], (err, recipient) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!recipient) return res.status(404).json({ error: 'Recipient not found.' });
        if (!recipient.email) return res.status(400).json({ error: 'Recipient does not have an email address configured.' });

        const transporter = getMailTransporter();
        if (!transporter) {
            return res.status(500).json({ error: 'Email configuration missing on the server.' });
        }

        const senderCampusId = req.user.campus_id || 1;
        const fromEmail = getFromEmail(senderCampusId);

        const mailOptions = {
            from: `"Ph.D. Admission Portal" <${fromEmail}>`,
            to: recipient.email,
            subject: `[Portal Message] ${subject}`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h3 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">New Message from ${req.user.name} (${req.user.role.toUpperCase()})</h3>
                    <p style="font-size: 16px; color: #333;">Hello ${recipient.name},</p>
                    <p style="font-size: 15px; color: #555;">You have received a new message through the Ph.D. Admission Portal:</p>
                    <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0; white-space: pre-wrap; color: #333;">${message}</div>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                    <p style="font-size: 13px; color: #888; text-align: center;">This is an automated message from the Ph.D. Admission Portal.</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (mailErr, info) => {
            if (mailErr) {
                logEmail(null, recipient.email, subject, message, 'Failed', recipient.name);
                return res.status(500).json({ error: 'Failed to send email. Please try again.' });
            }
            logEmail(null, recipient.email, subject, message, 'Sent', recipient.name);
            sendNotification(recipient_id, req.user.id, `New message regarding: ${subject}`);
            res.json({ success: true, message: 'Message sent successfully.' });
        });
    });
});

// Start Server
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`PhD Admission Portal running at http://${HOST}:${PORT}`);
});
