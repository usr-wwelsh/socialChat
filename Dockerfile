# --- Stage 1: Get Anubis binary ---
FROM ghcr.io/techarohq/anubis:latest AS anubis

# --- Stage 2: Build the app image ---
FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app code
COPY . .

# Copy Anubis binary from stage 1 (ko-built image)
COPY --from=anubis /ko-app/anubis /usr/bin/anubis

# Make entrypoint executable
RUN chmod +x /app/start.sh

# Anubis default configuration
ENV DIFFICULTY=4
ENV SERVE_ROBOTS_TXT=true
ENV OG_PASSTHROUGH=true
ENV OG_EXPIRY_TIME=24h

ENTRYPOINT ["/app/start.sh"]
