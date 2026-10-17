@echo off
title Push PhD Admissions Webapp for Google Cloud Run Deployment
echo =========================================================
echo   PhD Admissions Webapp - Google Cloud Run Assistant
echo   Target Account: sureshscience@gmail.com
echo =========================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git is not found in PATH. Please install Git or run from Git Bash.
    pause
    exit /b
)

if not exist ".git" (
    echo [*] Initializing new local Git repository...
    git init
    git branch -M main
)

echo 1. Staging updated project files (Dockerfile, server, persistent engine, assets)...
git add Dockerfile .dockerignore .gitignore package.json package-lock.json server.js database.js lib/ public/ "Regulations and SOP/" Users_Collect_Template.xlsx minutes_template.docx trichy_logo.png ramapuram_logo.png phd_admissions.db deploy_gcp.bat GCP_DEPLOYMENT_GUIDE.md

echo 2. Committing changes...
git commit -m "Configure PhD Admissions Webapp for Google Cloud Run deployment with persistent storage"

echo 3. Checking remote origin...
git remote get-url origin >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ACTION NEEDED] No GitHub remote origin is configured yet.
    echo To push to GitHub:
    echo   1. Create a repository on GitHub (e.g. phd-admissions-srm)
    echo   2. Run:
    echo      git remote add origin https://github.com/YOUR_USERNAME/phd-admissions-srm.git
    echo      git push -u origin main
    echo.
) else (
    echo Pushing to GitHub (origin main)...
    git push origin main
)

echo.
echo =========================================================
echo  Google Cloud Run Deployment Instructions (sureshscience@gmail.com)
echo =========================================================
echo.
echo OPTION A: Deploy via Google Cloud Shell (Recommended & Fastest)
echo 1. Open Google Cloud Console: https://console.cloud.google.com/
echo 2. Switch to account: sureshscience@gmail.com
echo 3. Open Cloud Shell icon [>_] in the top right header.
echo 4. Clone your repository (or upload code folder):
echo      git clone YOUR_GITHUB_REPO_URL
echo      cd YOUR_REPO_NAME
echo 5. Run the Cloud Run deployment command:
echo      gcloud run deploy phd-admissions --source . --region us-central1 --allow-unauthenticated
echo.
echo OPTION B: Attach Persistent Cloud Storage Bucket (Zero-Data-Loss)
echo To mount a persistent Cloud Storage bucket at /app/data so SQLite
echo and documents persist across container revisions:
echo   1. Create bucket (once):
echo      gcloud storage buckets create gs://phd-admissions-data-srm --location=us-central1
echo   2. Mount to Cloud Run:
echo      gcloud run services update phd-admissions --add-volume=name=phd-data,type=cloud-storage,bucket=phd-admissions-data-srm --add-volume-mount=volume=phd-data,mount-path=/app/data --region us-central1
echo.
echo Refer to GCP_DEPLOYMENT_GUIDE.md for detailed step-by-step instructions.
echo =========================================================
pause
