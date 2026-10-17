# Google Cloud Run Deployment Guide — PhD Admissions Portal

This guide provides step-by-step instructions for deploying the **PhD Admissions Webapp** to **Google Cloud Run** using the proven zero-data-loss architecture from the SIFT app.

**Target Google Account**: `sureshscience@gmail.com`

---

## Architecture Overview

```
                          ┌──────────────────────────────────────────────┐
                          │         Google Cloud Run (HTTPS)             │
                          │                                              │
Client Browsers ─────────►│  Node.js (Express 5 + Socket.io)            │
                          │  Active DB: /tmp/phd_admissions.db (POSIX)   │
                          │  WAL checkpointing on mutations              │
                          └──────────────────────┬───────────────────────┘
                                                 │ GCS FUSE Volume Mount
                                                 ▼ (/app/data)
                          ┌──────────────────────────────────────────────┐
                          │ Google Cloud Storage Bucket                  │
                          │ gs://phd-admissions-data-srm                 │
                          │  ├── phd_admissions.db (Mirrored DB)         │
                          │  ├── uploads/ (Uploaded documents)           │
                          │  └── public_uploads/ (Public candidate docs) │
                          └──────────────────────────────────────────────┘
```

1. **Serverless Auto-Scaling**: Cloud Run manages container instances automatically, scaling to zero when idle and instantly responding to requests.
2. **Zero Data Loss**: 
   - SQLite runs locally on `/tmp/phd_admissions.db` inside the container for native POSIX locks and lightning-fast queries.
   - On container startup/cold-boot, `storage-persistence.js` restores existing database state from the mounted Cloud Storage bucket (`/app/data/phd_admissions.db`).
   - When applicant data, marks, or decisions are modified, WAL checkpointing flushes transactions directly to `/app/data`.
   - File uploads are stored directly on the persistent volume (`/app/data/uploads` and `/app/data/public_uploads`).

---

## Quick Deployment Steps

### Step 1: Push Code to GitHub

Run `deploy_gcp.bat` in the project root:
```cmd
deploy_gcp.bat
```
If you haven't linked a GitHub repository yet:
1. Create a repository on GitHub (e.g. `phd-admissions-webapp`).
2. Link and push:
   ```cmd
   git remote add origin https://github.com/YOUR_USERNAME/phd-admissions-webapp.git
   git push -u origin main
   ```

---

### Step 2: Open Google Cloud Console & Cloud Shell

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/).
2. Verify you are logged into **`sureshscience@gmail.com`**.
3. Select or create your GCP project (e.g., `phd-admissions-portal`).
4. Click the **Cloud Shell** icon `[>_]` in the top-right toolbar.

---

### Step 3: Deploy the Application to Cloud Run

In Cloud Shell, clone your repository and deploy:

```bash
# 1. Clone your repository
git clone https://github.com/YOUR_USERNAME/phd-admissions-webapp.git
cd phd-admissions-webapp

# 2. Deploy to Cloud Run (builds container image automatically via Cloud Build)
gcloud run deploy phd-admissions \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1
```

Once deployment completes, Cloud Run will print your live HTTPS service URL:
```
Service URL: https://phd-admissions-xxxx-uc.a.run.app
```

---

### Step 4: Attach Persistent Cloud Storage Bucket (Zero-Data-Loss)

To ensure SQLite records and document uploads persist across container restarts and revisions:

#### Option A: Via Command Line (Cloud Shell)

```bash
# 1. Create a private Cloud Storage bucket (replace with your preferred bucket name)
gcloud storage buckets create gs://phd-admissions-data-srm --location=us-central1

# 2. Attach the bucket as a volume mount to your Cloud Run service at /app/data
gcloud run services update phd-admissions \
  --region us-central1 \
  --add-volume=name=phd-storage,type=cloud-storage,bucket=phd-admissions-data-srm \
  --add-volume-mount=volume=phd-storage,mount-path=/app/data
```

#### Option B: Via Cloud Console UI

1. Go to **Cloud Run** > Click on `phd-admissions`.
2. Click **Edit & Deploy New Revision**.
3. Scroll down and click **Volumes** > **Add Volume**.
   - Volume Type: **Cloud Storage bucket**
   - Volume Name: `phd-storage`
   - Bucket: Select or create `phd-admissions-data-srm`
4. In the container settings, under **Volume Mounts**:
   - Volume: `phd-storage`
   - Mount Path: `/app/data`
5. Click **Deploy**.

---

## Verifying Persistence

To verify zero-data-loss durability:
1. Open your live Cloud Run URL in a browser.
2. Log in and make a minor update (e.g., mark entry, note, or preference).
3. In Cloud Console, deploy a new revision or restart the instance.
4. Refresh your browser — all saved changes remain completely preserved.

---

## Maintenance & Backups

You can download an off-site backup of your live database at any time using Google Cloud Storage:
```bash
# Download live database snapshot to your machine or Cloud Shell:
gcloud storage cp gs://phd-admissions-data-srm/phd_admissions.db ./backup_$(date +%Y%m%d).db
```
