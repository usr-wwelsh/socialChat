#!/bin/bash
set -e

# Start the Node.js app on internal port 3000
PORT=3000 node server/index.js &
NODE_PID=$!

# Start Anubis as the public-facing reverse proxy
# Railway sets $PORT for the public listener; default to 8080 locally
export BIND=":${PORT:-8080}"
export TARGET="http://localhost:3000"
/usr/bin/anubis &
ANUBIS_PID=$!

# If either process exits, stop the other and exit
trap "kill $NODE_PID $ANUBIS_PID 2>/dev/null; exit 1" TERM INT

wait -n $NODE_PID $ANUBIS_PID
EXIT_CODE=$?

kill $NODE_PID $ANUBIS_PID 2>/dev/null
exit $EXIT_CODE
