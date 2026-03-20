#!/bin/bash
set -e

# Ensure media directory exists
mkdir -p "${MEDIA_PATH:-/app/media}"

# Start the app on the public port (Railway sets $PORT)
exec bun server/index.js
