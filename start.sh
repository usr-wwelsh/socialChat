#!/bin/bash
set -e

# Ensure media and session directories exist
mkdir -p "${MEDIA_PATH:-/app/media}"
mkdir -p "${MEDIA_PATH:-/app}/.sessions"

# Start the app on the public port (Railway sets $PORT)
exec bun server/index.js
