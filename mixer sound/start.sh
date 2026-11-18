#!/usr/bin/env bash
# ==============================================================================
# AuraMixer Studio Launcher (Soundboard & Live Voice Changer)
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
SERVER_PID_FILE="/tmp/auramixer_server.pid"

echo "=========================================================="
echo "  🎙️  AuraMixer Studio - Soundboard & Voice Changer"
echo "=========================================================="

# 1. Start Virtual Microphone for Discord
echo "[1/3] Initializing PipeWire Virtual Microphone..."
./virtual-mic.sh start || echo "Virtual mic already active."

# 2. Start Backend Server
echo "[2/3] Starting AuraMixer Backend Server on http://localhost:3030..."
server_running=0
if [ -f "$SERVER_PID_FILE" ]; then
    pid=$(cat "$SERVER_PID_FILE" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        server_running=1
    fi
fi
if [ "$server_running" -eq 0 ] && curl -fsS "http://localhost:3030/api/status" >/dev/null 2>&1; then
    server_running=1
fi

if [ "$server_running" -eq 0 ]; then
    setsid nohup node server.js > server.log 2>&1 < /dev/null &
    echo "$!" > "$SERVER_PID_FILE"
    sleep 1
fi

# 3. Open Browser
URL="http://localhost:3030"
echo "[3/3] Launching interface at $URL..."
if command -v xdg-open &>/dev/null; then
    xdg-open "$URL" >/dev/null 2>&1 &
elif command -v sensible-browser &>/dev/null; then
    sensible-browser "$URL" >/dev/null 2>&1 &
fi

echo ""
echo "✨ AuraMixer is running!"
echo "📡 Open in browser: $URL"
echo ""
echo "App Setup:"
echo " 1. In your voice app -> Settings -> Voice & Video"
echo " 2. Set INPUT DEVICE to: 'Soundboard Virtual Mic'"
echo " 3. Set OUTPUT DEVICE to: Your Headphones"
echo " 4. Turn off Noise Suppression"
echo " 5. In AuraMixer UI, click 'Start Mic' and test your voices!"
echo ""
echo "Tip: monitoring starts OFF to prevent speaker feedback."
echo "     Click 'Hear myself' (H) while wearing headphones."
echo "=========================================================="
