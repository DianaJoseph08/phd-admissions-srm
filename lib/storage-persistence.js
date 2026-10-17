const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Cloud Run Persistent Storage Engine
 * Handles Google Cloud Storage (GCS) FUSE volume mount persistence
 * for SQLite and uploaded files with zero data loss.
 */

const baseDir = path.resolve(__dirname, '..');
const bundledDbPath = path.join(baseDir, 'phd_admissions.db');

// Check for persistent mount directory (Cloud Run FUSE volume mounted at /app/data or DATA_DIR env)
const persistentDir = process.env.DATA_DIR || (fs.existsSync('/app/data') ? '/app/data' : null);
const persistentDbPath = persistentDir ? path.join(persistentDir, 'phd_admissions.db') : null;

let activeDbPath;
let tempUploadDir;
let docsUploadDir;

if (process.env.DB_PATH) {
    activeDbPath = process.env.DB_PATH;
    tempUploadDir = path.join(baseDir, 'uploads');
    docsUploadDir = path.join(baseDir, 'public', 'uploads');
} else if (persistentDir) {
    // Cloud Run environment: GCS FUSE does not support POSIX locking for SQLite.
    // We run the active database on local container POSIX filesystem (/tmp/phd_admissions.db)
    // and sync transactions to the persistent Cloud Storage volume (/app/data).
    const localTmpDir = process.env.LOCAL_TMP_DIR || (process.platform === 'win32' ? os.tmpdir() : '/tmp');
    try {
        if (!fs.existsSync(localTmpDir)) fs.mkdirSync(localTmpDir, { recursive: true });
    } catch (e) {}
    activeDbPath = path.join(localTmpDir, 'phd_admissions.db');

    try {
        if (!fs.existsSync(persistentDir)) {
            try { fs.mkdirSync(persistentDir, { recursive: true }); } catch (e) {}
        }

        // Restore existing database from persistent GCS volume if available
        if (fs.existsSync(persistentDbPath) && fs.statSync(persistentDbPath).size > 0) {
            fs.copyFileSync(persistentDbPath, activeDbPath);
            console.log(`[StorageEngine] Restored database from Cloud Storage: ${persistentDbPath} -> ${activeDbPath} (${fs.statSync(activeDbPath).size} bytes)`);
        } else if (fs.existsSync(bundledDbPath)) {
            // Seed /tmp from bundled database template
            fs.copyFileSync(bundledDbPath, activeDbPath);
            console.log(`[StorageEngine] Initialized database in /tmp from bundled seed: ${bundledDbPath}`);
            // Also save initial copy to persistent GCS bucket
            try {
                fs.copyFileSync(bundledDbPath, persistentDbPath);
                console.log(`[StorageEngine] Seeded Cloud Storage persistent bucket: ${persistentDbPath}`);
            } catch (err) {
                console.warn(`[StorageEngine] Warning: Could not write initial seed to persistent volume:`, err.message);
            }
        }
    } catch (err) {
        console.warn(`[StorageEngine] Persistent storage initialization warning:`, err.message);
        if (!fs.existsSync(activeDbPath) && fs.existsSync(bundledDbPath)) {
            fs.copyFileSync(bundledDbPath, activeDbPath);
        }
    }

    // Configure persistent upload directories
    tempUploadDir = path.join(persistentDir, 'uploads');
    docsUploadDir = path.join(persistentDir, 'public_uploads');
    try {
        if (!fs.existsSync(tempUploadDir)) fs.mkdirSync(tempUploadDir, { recursive: true });
        if (!fs.existsSync(docsUploadDir)) fs.mkdirSync(docsUploadDir, { recursive: true });
    } catch (e) {
        console.warn(`[StorageEngine] Warning creating persistent upload folders:`, e.message);
    }
} else {
    // Local development environment (standard filesystem)
    activeDbPath = bundledDbPath;
    tempUploadDir = path.join(baseDir, 'uploads');
    docsUploadDir = path.join(baseDir, 'public', 'uploads');
}

// Ensure base upload folders exist
try {
    if (!fs.existsSync(tempUploadDir)) fs.mkdirSync(tempUploadDir, { recursive: true });
    if (!fs.existsSync(docsUploadDir)) fs.mkdirSync(docsUploadDir, { recursive: true });
} catch (e) {}

let syncTimeout = null;
let registeredDbInstance = null;

/**
 * Register the active sqlite3 db instance for WAL checkpointing
 */
function registerDatabaseInstance(db) {
    registeredDbInstance = db;
}

/**
 * Synchronize local SQLite database to persistent volume (Cloud Storage bucket)
 */
function syncToPersistentStorage(immediate = false) {
    if (!persistentDbPath || activeDbPath === persistentDbPath) return;

    const performSync = () => {
        try {
            if (!fs.existsSync(persistentDir)) {
                try { fs.mkdirSync(persistentDir, { recursive: true }); } catch (e) {}
            }

            // Flush pending transactions to disk before copying
            if (registeredDbInstance) {
                try {
                    registeredDbInstance.run('PRAGMA wal_checkpoint(PASSIVE)');
                } catch (e) {}
            }

            if (fs.existsSync(activeDbPath)) {
                fs.copyFileSync(activeDbPath, persistentDbPath);
                console.log(`[StorageEngine] Synced database to persistent Cloud Storage: ${persistentDbPath} (${fs.statSync(persistentDbPath).size} bytes)`);
            }
        } catch (err) {
            console.error(`[StorageEngine] Failed to sync database to persistent volume (${persistentDbPath}):`, err.message);
        }
    };

    if (immediate) {
        if (syncTimeout) {
            clearTimeout(syncTimeout);
            syncTimeout = null;
        }
        performSync();
    } else {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(performSync, 1000);
    }
}

// Graceful shutdown listeners to guarantee final persistent flush
process.on('SIGTERM', () => {
    console.log('[StorageEngine] Received SIGTERM. Flushing persistent data...');
    syncToPersistentStorage(true);
});

process.on('SIGINT', () => {
    console.log('[StorageEngine] Received SIGINT. Flushing persistent data...');
    syncToPersistentStorage(true);
});

module.exports = {
    activeDbPath,
    persistentDir,
    persistentDbPath,
    tempUploadDir,
    docsUploadDir,
    registerDatabaseInstance,
    syncToPersistentStorage
};
