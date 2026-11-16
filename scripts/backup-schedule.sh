#!/bin/bash
# Run the backup automatically every hour on this Mac (a macOS "launch agent").
#
#   scripts/backup-schedule.sh install     # start hourly backups (also runs one straight away)
#   scripts/backup-schedule.sh status      # is it installed, and when did it last run
#   scripts/backup-schedule.sh uninstall   # stop and remove it (your backups are left alone)
#
# Backups go to ~/Backups/hung-workspace and, if Google Drive for desktop is installed,
# a second copy goes to "My Drive/Hung Workspace Backups". Hourly runs are cheap: nothing is
# written unless a page changed. Override with BACKUP_DIR / BACKUP_MIRROR_DIR when installing.
set -euo pipefail

LABEL="com.hungworkspace.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE="$(command -v node || true)"
    [ -n "$NODE" ] || { echo "node not found. Run: nvm use 22"; exit 1; }
    case "$("$NODE" -v)" in v22.*|v23.*|v24.*|v25.*|v26.*) ;; *) echo "Need Node 22 or newer (found $("$NODE" -v)). Run: nvm use 22"; exit 1;; esac

    BACKUP_DIR="${BACKUP_DIR:-$HOME/Backups/hung-workspace}"
    if [ -z "${BACKUP_MIRROR_DIR:-}" ]; then
      DRIVE="$(ls -d "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive" 2>/dev/null | head -1 || true)"
      [ -n "$DRIVE" ] && BACKUP_MIRROR_DIR="$DRIVE/Hung Workspace Backups" || BACKUP_MIRROR_DIR=""
    fi
    mkdir -p "$BACKUP_DIR" "$HOME/Library/LaunchAgents"

    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>--experimental-transform-types</string>
    <string>$PROJECT/scripts/backup.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BACKUP_DIR</key><string>$BACKUP_DIR</string>
    <key>BACKUP_MIRROR_DIR</key><string>$BACKUP_MIRROR_DIR</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$BACKUP_DIR/backup.log</string>
  <key>StandardErrorPath</key><string>$BACKUP_DIR/backup.log</string>
</dict>
</plist>
PLISTEOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed. Hourly backups of $PROJECT/content"
    echo "  -> $BACKUP_DIR"
    [ -n "$BACKUP_MIRROR_DIR" ] && echo "  -> $BACKUP_MIRROR_DIR" || echo "  (no Google Drive folder found, so no second copy)"
    echo "Log: $BACKUP_DIR/backup.log"
    ;;
  status)
    if [ -f "$PLIST" ]; then echo "Installed: $PLIST"; launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state =|last exit code|runs =" || echo "(not loaded; run install)"; else echo "Not installed."; fi
    LOG="$HOME/Backups/hung-workspace/backup.log"; [ -f "$LOG" ] && { echo "--- last log lines"; tail -5 "$LOG"; } || true
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed the schedule. Existing backups were not touched."
    ;;
  *) echo "Usage: scripts/backup-schedule.sh install|status|uninstall"; exit 1;;
esac
