# Production Dockerfile for PhD Admissions Webapp
# Optimized for Google Cloud Run deployment

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install native dependencies required for build tools (e.g. node-gyp for native modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application code and required runtime assets
COPY server.js ./
COPY database.js ./
COPY lib/ ./lib/
COPY public/ ./public/
COPY "Regulations and SOP/" "./Regulations and SOP/"
COPY Users_Collect_Template.xlsx ./
COPY minutes_template.docx ./
COPY trichy_logo.png ./
COPY ramapuram_logo.png ./
COPY phd_admissions.db ./

# Prepare mount directory for persistent Cloud Storage bucket (/app/data) and uploads
RUN mkdir -p /app/data /app/uploads /app/public/uploads

# Expose standard Cloud Run port
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
