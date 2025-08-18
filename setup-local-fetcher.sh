#!/bin/bash

# Setup script for local feed fetcher automation

echo "=== Paper Trails Local Fetcher Setup ==="
echo

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "This script is designed for Linux systems with systemd."
    echo "For other systems, please set up cron manually."
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(which node)"
SCRIPT_PATH="$PROJECT_DIR/src/scripts/fetch-feeds-local.js"
SERVICE_NAME="papertrails-fetcher"

# Create systemd service file
cat > /tmp/${SERVICE_NAME}.service << EOF
[Unit]
Description=Paper Trails RSS Feed Fetcher
After=network.target

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_PATH $SCRIPT_PATH
StandardOutput=append:/var/log/${SERVICE_NAME}.log
StandardError=append:/var/log/${SERVICE_NAME}-error.log
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"

[Install]
WantedBy=multi-user.target
EOF

# Create systemd timer for scheduling
cat > /tmp/${SERVICE_NAME}.timer << EOF
[Unit]
Description=Run Paper Trails fetcher every 6 hours
Requires=${SERVICE_NAME}.service

[Timer]
# Run at 2am, 8am, 2pm, 8pm
OnCalendar=02:00
OnCalendar=08:00
OnCalendar=14:00
OnCalendar=20:00
# Also run 5 minutes after boot
OnBootSec=5min
# If missed, run as soon as possible
Persistent=true

[Install]
WantedBy=timers.target
EOF

echo "Service files created. To install:"
echo
echo "1. Install systemd service (requires sudo):"
echo "   sudo cp /tmp/${SERVICE_NAME}.service /etc/systemd/system/"
echo "   sudo cp /tmp/${SERVICE_NAME}.timer /etc/systemd/system/"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable ${SERVICE_NAME}.timer"
echo "   sudo systemctl start ${SERVICE_NAME}.timer"
echo
echo "2. Check status:"
echo "   systemctl status ${SERVICE_NAME}.timer"
echo "   systemctl list-timers ${SERVICE_NAME}"
echo
echo "3. View logs:"
echo "   sudo journalctl -u ${SERVICE_NAME}.service -f"
echo
echo "4. Run manually:"
echo "   sudo systemctl start ${SERVICE_NAME}.service"
echo
echo "Alternative: Use cron (no sudo required):"
echo "   crontab -e"
echo "   Add: 0 2,8,14,20 * * * cd $PROJECT_DIR && $NODE_PATH $SCRIPT_PATH >> ~/papertrails-fetch.log 2>&1"
echo
echo "For better Substack success rate, consider:"
echo "1. Install Tor: sudo apt install tor"
echo "2. Use the proxy-enabled script: fetch-with-proxy.js"
echo "3. Run from different machines/VPNs"