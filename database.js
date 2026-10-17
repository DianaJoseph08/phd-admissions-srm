const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let dbPath = path.join(__dirname, 'phd_admissions.db');
try {
    const storageConfig = require('./lib/storage-persistence');
    if (storageConfig && storageConfig.activeDbPath) {
        dbPath = storageConfig.activeDbPath;
    }
} catch (e) {}
const db = new sqlite3.Database(dbPath);

const setupData = {
    campuses: [
        { id: 1, name: 'Ramapuram' },
        { id: 2, name: 'Trichy' }
    ],
    institutions: [
        // Ramapuram
        { id: 1, campus_id: 1, name: 'Engineering & Technology', coordinator: 'Dr. Vani', coord_username: 'vani' },
        { id: 2, campus_id: 1, name: 'Science & Humanities', coordinator: 'Dr. Sutha', coord_username: 'sutha' },
        { id: 3, campus_id: 1, name: 'SRM Dental College', coordinator: 'Dr. Deepika', coord_username: 'deepika' },
        { id: 4, campus_id: 1, name: 'Management', coordinator: 'Dr. Priya', coord_username: 'priya' },
        // Trichy (Dr. Infant coordinates all)
        { id: 5, campus_id: 2, name: 'Engineering & Technology', coordinator: 'Dr. Infant', coord_username: 'infant' },
        { id: 6, campus_id: 2, name: 'Science & Humanities', coordinator: 'Dr. Infant', coord_username: 'infant' },
        { id: 7, campus_id: 2, name: 'Faculty of Medical & Health Sciences', coordinator: 'Dr. Infant', coord_username: 'infant' }
    ],
    departments: [
        // Ramapuram E&T
        { institution_id: 1, name: 'Mechanical Engineering' },
        { institution_id: 1, name: 'Electronics and Communication Engineering' },
        { institution_id: 1, name: 'Electrical and Electronics Engineering' },
        { institution_id: 1, name: 'Civil Engineering' },
        { institution_id: 1, name: 'Computer Science and Engineering' },
        { institution_id: 1, name: 'Biotechnology' },
        { institution_id: 1, name: 'Biomedical Engineering' },
        { institution_id: 1, name: 'Mathematics' },
        { institution_id: 1, name: 'Physics' },
        { institution_id: 1, name: 'Chemistry' },
        { institution_id: 1, name: 'English' },

        // Ramapuram S&H
        { institution_id: 2, name: 'Computer Science' },
        { institution_id: 2, name: 'Mathematics' },
        { institution_id: 2, name: 'Biotechnology' },
        { institution_id: 2, name: 'Commerce' },
        { institution_id: 2, name: 'Fashion Designing' },
        { institution_id: 2, name: 'Visual Communication' },
        { institution_id: 2, name: 'Tamil' },
        { institution_id: 2, name: 'English' },
        { institution_id: 2, name: 'Hindi' },

        // Ramapuram SRM Dental College (Consolidated)
        { institution_id: 3, name: 'Dentistry' },

        // Ramapuram Management
        { institution_id: 4, name: 'Management Studies' },

        // Trichy E&T
        { institution_id: 5, name: 'Mechanical Engineering' },
        { institution_id: 5, name: 'Electronics and Communication Engineering' },
        { institution_id: 5, name: 'Electrical and Electronics Engineering' },
        { institution_id: 5, name: 'Computer Science Engineering' },
        { institution_id: 5, name: 'Biotechnology' },
        { institution_id: 5, name: 'Mathematics' },
        { institution_id: 5, name: 'Physics' },
        { institution_id: 5, name: 'Chemistry' },

        // Trichy S&H
        { institution_id: 6, name: 'Commerce' },
        { institution_id: 6, name: 'Computer Science' },
        { institution_id: 6, name: 'Biotechnology' },
        { institution_id: 6, name: 'Biochemistry' },
        { institution_id: 6, name: 'Microbiology' },
        { institution_id: 6, name: 'English' },
        { institution_id: 6, name: 'Tamil' },
        { institution_id: 6, name: 'Physical Education' },

        // Trichy FMHS
        { institution_id: 7, name: 'Occupational Therapy' },
        { institution_id: 7, name: 'Medical Imaging Technology' },
        { institution_id: 7, name: 'Clinical Psychology' },
        { institution_id: 7, name: 'Renal Dialysis Technology' },
        { institution_id: 7, name: 'Anaesthesia Technology' }
    ]
};

function init() {
    db.serialize(() => {
        // Drop existing tables if needed (we'll start clean)
        db.run('DROP TABLE IF EXISTS transfer_remarks');
        db.run('DROP TABLE IF EXISTS transfer_requests');
        db.run('DROP TABLE IF EXISTS candidate_documents');
        db.run('DROP TABLE IF EXISTS candidates');
        db.run('DROP TABLE IF EXISTS supervisors');
        db.run('DROP TABLE IF EXISTS departments');
        db.run('DROP TABLE IF EXISTS institutions');
        db.run('DROP TABLE IF EXISTS users');
        db.run('DROP TABLE IF EXISTS campuses');

        // Create Tables
        db.run(`CREATE TABLE campuses (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        )`);

        db.run(`CREATE TABLE institutions (
            id INTEGER PRIMARY KEY,
            campus_id INTEGER,
            name TEXT NOT NULL,
            coordinator TEXT NOT NULL,
            coord_username TEXT NOT NULL,
            dean_username TEXT,
            FOREIGN KEY (campus_id) REFERENCES campuses(id),
            UNIQUE(campus_id, name)
        )`);

        db.run(`CREATE TABLE departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            institution_id INTEGER,
            name TEXT NOT NULL,
            ft_allowed INTEGER DEFAULT NULL,
            FOREIGN KEY (institution_id) REFERENCES institutions(id),
            UNIQUE(institution_id, name)
        )`);

        db.run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT CHECK(role IN ('super_admin', 'admin', 'coordinator', 'hod', 'dean')) NOT NULL,
            campus_id INTEGER,
            name TEXT NOT NULL,
            email TEXT,
            institution_id INTEGER, -- For coordinators & HODs
            department_id INTEGER,  -- For HODs
            FOREIGN KEY (campus_id) REFERENCES campuses(id),
            FOREIGN KEY (institution_id) REFERENCES institutions(id),
            FOREIGN KEY (department_id) REFERENCES departments(id)
        )`);

        db.run(`CREATE TABLE candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_no TEXT UNIQUE NOT NULL,
            form_name TEXT,
            registered_name TEXT NOT NULL,
            email TEXT NOT NULL,
            mobile TEXT,
            form_status TEXT,
            payment_status TEXT,
            payment_method TEXT,
            nationality TEXT,
            mode_of_study TEXT NOT NULL, -- Full Time, Part Time Internal, Part Time External (Academic), Part Time External (Industry)
            name_on_cert TEXT,
            dob TEXT,
            gender TEXT,
            campus_id INTEGER,
            institution_id INTEGER,
            department_id INTEGER,
            program TEXT,
            user_id TEXT,
            status TEXT DEFAULT 'Pending Verification', -- Pending Verification, Eligible, Not Eligible
            status_reason TEXT,
            exam_attendance TEXT DEFAULT 'Absent', -- Present, Absent, Exempted
            written_marks REAL DEFAULT NULL, -- Out of 50
            interview_marks_1 REAL DEFAULT NULL, -- Examiner 1 out of 30
            interview_marks_2 REAL DEFAULT NULL, -- Examiner 2 out of 30
            interview_marks_3 REAL DEFAULT NULL, -- Examiner 3 out of 30
            avg_interview_marks REAL DEFAULT NULL, -- Average out of 30
            scaled_written_marks REAL DEFAULT NULL, -- Out of 70
            total_marks REAL DEFAULT NULL, -- Out of 100
            rank INTEGER,
            selection_status TEXT DEFAULT 'Pending Selection', -- Pending Selection, Selected, Not Selected
            supervisor_name TEXT,
            supervisor_designation TEXT,
            supervisor_affiliation TEXT,
            current_owner TEXT DEFAULT 'Admin', -- Admin, RC, HOD, Dean
            category TEXT, -- SC, ST, OBC, General, EWS etc. (Used for cutoffs)
            pg_percentage REAL DEFAULT NULL,
            ug_percentage REAL DEFAULT NULL,
            is_interdisciplinary INTEGER,
            return_remark TEXT,         -- Query statement when a level returns the candidate
            allocation_remark TEXT,     -- HOD remark when supervisor is not candidate's preference
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campus_id) REFERENCES campuses(id),
            FOREIGN KEY (institution_id) REFERENCES institutions(id),
            FOREIGN KEY (department_id) REFERENCES departments(id)
        )`);

        db.run(`CREATE TABLE transfer_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER,
            from_institution_id INTEGER,
            from_department_id INTEGER,
            to_institution_id INTEGER,
            to_department_id INTEGER,
            requested_by TEXT NOT NULL,
            stage TEXT DEFAULT 'ORIG_RC', -- ORIG_RC, ORIG_DEAN, TARGET_DEAN, TARGET_RC, TARGET_HOD, REJECTED_RC, REJECTED_DEAN, REJECTED_ADMIN, COMPLETED, ADMIN_REJECTED
            status TEXT DEFAULT 'In Progress', -- In Progress, Accepted, Rejected by Target HOD, Rejected by Admin
            initial_reason TEXT,
            target_hod_decision TEXT, -- Accepted, Rejected
            target_hod_reason TEXT,
            admin_action TEXT, -- Reassigned, Rejected
            admin_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (candidate_id) REFERENCES candidates(id)
        )`);

        db.run(`CREATE TABLE transfer_remarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transfer_id INTEGER NOT NULL,
            stage TEXT NOT NULL,
            actor_username TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            action TEXT NOT NULL,
            remarks TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (transfer_id) REFERENCES transfer_requests(id)
        )`);

        db.run(`CREATE TABLE candidate_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER,
            document_type TEXT NOT NULL, -- 10th, 12th, UG, PG, Photo, Signature, CG, etc.
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            FOREIGN KEY (candidate_id) REFERENCES candidates(id)
        )`);

        db.run(`CREATE TABLE supervisors (
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

        // Seed Data
        const stmtCampus = db.prepare('INSERT INTO campuses (id, name) VALUES (?, ?)');
        setupData.campuses.forEach(c => stmtCampus.run(c.id, c.name));
        stmtCampus.finalize();

        const stmtInst = db.prepare('INSERT INTO institutions (id, campus_id, name, coordinator, coord_username) VALUES (?, ?, ?, ?, ?)');
        setupData.institutions.forEach(i => stmtInst.run(i.id, i.campus_id, i.name, i.coordinator, i.coord_username));
        stmtInst.finalize();

        const stmtDept = db.prepare('INSERT INTO departments (institution_id, name) VALUES (?, ?)');
        setupData.departments.forEach(d => stmtDept.run(d.institution_id, d.name));
        stmtDept.finalize();

        // Seed Users
        // 1. Super Admin
        db.run("INSERT INTO users (username, password, role, name, email) VALUES ('super_admin', 'password', 'super_admin', 'Dr. Karthikeyan Rajagopal', 'director.research@srmorg.com')");

        // 2. Campus Admins & Deans
        db.run("INSERT INTO users (username, password, role, campus_id, name, email) VALUES ('suresh', 'password', 'admin', 1, 'Dr. Suresh Kumarasamy', 'phd.info@srmrmp.edu.in')");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email) VALUES ('diana', 'password', 'admin', 1, 'Dr. Dianavinnarasi Joseph', 'dianavinnarasi.j@eec.srmrmp.edu.in')");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email) VALUES ('ruby', 'password', 'admin', 2, 'Dr. V. Chithiika Ruby', 'phd.info@srmtrichy.edu.in')");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email) VALUES ('arun', 'password', 'admin', 2, 'Dr. R. Arun', 'arun.r@trp.srmtrichy.edu.in')");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('dy_dean_research_sh_rmp', 'password', 'dean', 1, 'Dr. Sivanesan Dhandayuthapani', 'dy.deanresearch@fsh.srmrmp.edu.in', 2)");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('vp_research_et_rmp', 'password', 'admin', 1, 'Dr. Roopa', 'vp.research.rmp@srmist.edu.in', 1)");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email) VALUES ('dean_research_try', 'password', 'dean', 2, 'Dr. K. Devendranath Ramkumar', 'dean.research@srmtrichy.edu.in')");

        // 3. Coordinators
        // Ramapuram
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('sutha', 'password', 'coordinator', 1, 'Dr. Sutha', 'suthak@srmist.edu.in', 2)");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('vani', 'password', 'coordinator', 1, 'Dr. Vani R', 'vanir@srmist.edu.in', 1)");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('priya', 'password', 'coordinator', 1, 'Dr. Priya K', 'priyak1@srmist.edu.in', 4)");
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('deepika', 'password', 'coordinator', 1, 'Dr. Deepikha', 'deepikhk@srmist.edu.in', 3)");

        // Trichy
        db.run("INSERT INTO users (username, password, role, campus_id, name, email, institution_id) VALUES ('infant', 'password', 'coordinator', 2, 'Dr. M. Infant Shyam Kumar', 'infantshyamkumar.m@ist.srmtrichy.edu.in', 5)");

        // 4. Generate HOD users for all departments dynamically
        db.all("SELECT d.id as dept_id, d.name as dept_name, i.id as inst_id, i.campus_id, i.name as inst_name FROM departments d JOIN institutions i ON d.institution_id = i.id", (err, rows) => {
            if (err) return console.error(err);

            const stmtHod = db.prepare(`INSERT INTO users 
                (username, password, role, campus_id, name, email, institution_id, department_id) 
                VALUES (?, ?, 'hod', ?, ?, ?, ?, ?)`);

            const instCodes = {
                'Engineering & Technology': 'et',
                'Science & Humanities': 'sh',
                'SRM Dental College': 'dental',
                'Management': 'mgt',
                'Faculty of Medical & Health Sciences': 'fmhs'
            };

            rows.forEach(r => {
                const suffix = r.campus_id === 1 ? 'rmp' : 'trichy';
                const instCode = instCodes[r.inst_name] || 'inst';
                const cleanDept = r.dept_name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const username = `hod_${instCode}_${cleanDept}_${suffix}`;
                const hodName = `HOD of ${r.dept_name} (${r.inst_name})`;
                const email = `hod.${instCode}.${cleanDept}.${suffix}@srmist.edu.in`;

                stmtHod.run(username, 'password', r.campus_id, hodName, email, r.inst_id, r.dept_id);
            });

            stmtHod.finalize();
            console.log("Database initialized successfully!");
        });
    });
}

if (require.main === module) {
    init();
}

module.exports = {
    db,
    init
};
