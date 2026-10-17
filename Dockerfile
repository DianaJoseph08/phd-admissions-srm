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
RUN npm install --omit=dev

# Copy application code and runtime assets (filtered by .dockerignore)
COPY . .

# Prepare mount directory for persistent Cloud Storage bucket (/app/data) and uploads
RUN mkdir -p /app/data /app/uploads /app/public/uploads

# Expose standard Cloud Run port
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
