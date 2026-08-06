#!/usr/bin/env bash
# Restart the backend server (Windows-safe bash).
PID=$(netstat -ano 2>/dev/null | grep ':5000' | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "$PID" ]; then
  taskkill //PID "$PID" //F >/dev/null 2>&1 && echo "stopped old backend (PID $PID)"
fi
sleep 1
cd backend
(node src/server.js > /tmp/backend.log 2>&1 &)
sleep 8
curl -s -o /dev/null -w 'health %{http_code}\n' http://localhost:5000/api/health
