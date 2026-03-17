# --- Stage 1: Get Anubis binary ---
FROM ghcr.io/techarohq/anubis:v1.24.0 AS anubis

# --- Stage 2: Build the app image ---
FROM oven/bun:1

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN bun install --production

# Copy app code
COPY . .

# Copy Anubis binary from stage 1 (ko-built image)
COPY --from=anubis /ko-app/anubis /usr/bin/anubis

# Make entrypoint executable
RUN chmod +x /app/start.sh

# Anubis configuration
ENV DIFFICULTY=4
ENV SERVE_ROBOTS_TXT=true
ENV POLICY_FNAME=/app/anubis-policy.yaml
ENV ANUBIS_REAL_IP_HEADER=X-Forwarded-For

ENTRYPOINT ["/app/start.sh"]
