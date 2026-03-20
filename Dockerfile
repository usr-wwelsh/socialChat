FROM oven/bun:1

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN bun install --production

# Copy app code
COPY . .

# Make entrypoint executable
RUN chmod +x /app/start.sh

ENTRYPOINT ["/app/start.sh"]
