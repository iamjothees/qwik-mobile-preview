#!/usr/bin/env bash
set -e

# Detect Host LAN IP
if [ -z "$HOST_IP" ]; then
  if command -v ipconfig >/dev/null 2>&1; then
    # macOS
    HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  fi
  if [ -z "$HOST_IP" ] && command -v hostname >/dev/null 2>&1; then
    # Linux
    HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  if [ -z "$HOST_IP" ]; then
    HOST_IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1 || true)
  fi
fi

export HOST_IP="${HOST_IP:-127.0.0.1}"
echo "Detected Host LAN IP: $HOST_IP"

# Write to .env for docker compose
echo "HOST_IP=$HOST_IP" > .env

# Start container
docker compose up -d

PORT="${PORT:-4567}"
echo ""
echo "=========================================================="
echo "⚡ Qwik Mobile Preview is running!"
echo "💻 Laptop Dashboard : http://localhost:$PORT"
echo "📱 Mobile LAN URL   : http://$HOST_IP:$PORT"
echo "=========================================================="
echo ""
echo "👉 On your mobile device, open: http://$HOST_IP:$PORT"
echo "👉 In Chrome, load unpacked extension from: ./extension"
echo ""
