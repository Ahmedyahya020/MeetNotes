#!/bin/bash
set -e

# Start virtual display (required for Puppeteer headful mode on a server)
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 1

echo "Virtual display started on :99"
exec node src/server.js
