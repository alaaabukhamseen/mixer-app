#!/usr/bin/env bash
# ==============================================================================
# AuraMixer Studio Stop Script
# ==============================================================================
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
SERVER_PID_FILE="/tmp/auramixer_server.pid"

echo "Stopping AuraMixer Virtual Microphone..."
./virtual-mic.sh stop

echo "Stopping AuraMixer Backend Server..."
if [ -f "$SERVER_PID_FILE" ]; then
    pid=$(cat "$SERVER_PID_FILE" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
    fi
    rm -f "$SERVER_PID_FILE"
fi

# Fallback for servers started manually from this directory.
for pid in $(pgrep -f "node .*/discord-soundboard-mixer/server.js" 2>/dev/null || true); do
    kill "$pid" 2>/dev/null || true
done

echo "✨ AuraMixer stopped."
