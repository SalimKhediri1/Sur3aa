#!/usr/bin/env bash
# Linux setup. Run without sudo, package installation requests it when needed.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_YTDLP=false
NO_AUTOSTART=false
for arg in "$@"; do
  case "$arg" in
    --update-ytdlp) UPDATE_YTDLP=true ;;
    --no-autostart) NO_AUTOSTART=true ;;
    *) echo "Usage: ./setup.sh [--update-ytdlp] [--no-autostart]"; exit 1 ;;
  esac
done
if [ "$(uname -s)" != Linux ]; then
  echo 'This script supports Linux. On Windows run setup.bat.'
  exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'Install Node.js 22 or newer with npm, then run setup again.'
  exit 1
fi
export PATH="$HOME/.local/bin:$PATH"
missing=()
for tool in ffmpeg zenity python3; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  if command -v apt-get >/dev/null; then
    sudo apt-get update
    sudo apt-get install -y "${missing[@]}"
  elif command -v dnf >/dev/null; then
    sudo dnf install -y "${missing[@]}"
  elif command -v pacman >/dev/null; then
    # Avoid a partial Arch upgrade, the system should be updated before setup.
    sudo pacman -S --needed "${missing[@]/python3/python}"
  elif command -v zypper >/dev/null; then
    sudo zypper install -y "${missing[@]}"
  else
    echo "Install these tools using your package manager, then run setup again: ${missing[*]}"
    exit 1
  fi
fi
if ! command -v yt-dlp >/dev/null || [ "$UPDATE_YTDLP" = true ]; then
  mkdir -p "$HOME/.local/bin"
  candidate="$(mktemp "$HOME/.local/bin/yt-dlp.XXXXXX")"
  trap 'rm -f "$candidate"' EXIT
  url='https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
  if command -v curl >/dev/null; then
    curl --fail --location --retry 2 "$url" -o "$candidate"
  elif command -v wget >/dev/null; then
    wget -O "$candidate" "$url"
  else
    echo 'Install curl or wget, then run setup again.'; exit 1
  fi
  chmod +x "$candidate"
  "$candidate" --ignore-config --version
  mv "$candidate" "$HOME/.local/bin/yt-dlp"
  trap - EXIT
fi
(cd "$SCRIPT_DIR/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
# Record resolved tools for both manual and systemd launches.
SUR3AA_TOOLS_FILE="$SCRIPT_DIR/server/tools.json" SUR3AA_YTDLP="$(command -v yt-dlp)" SUR3AA_FFMPEG="$(command -v ffmpeg)" node - <<'JS'
require('fs').writeFileSync(process.env.SUR3AA_TOOLS_FILE, JSON.stringify({
  ytDlp: process.env.SUR3AA_YTDLP, ffmpeg: process.env.SUR3AA_FFMPEG, node: process.execPath,
}, null, 2));
JS
node "$SCRIPT_DIR/server/doctor.js"
if [ "$NO_AUTOSTART" = true ]; then
  echo "Setup complete. Start manually: node \"$SCRIPT_DIR/server/index.js\""
  exit 0
fi
if ! command -v systemctl >/dev/null || ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "Setup complete. No systemd user session is available. Start manually: node \"$SCRIPT_DIR/server/index.js\""
  exit 0
fi
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
# Quote paths and escape systemd specifiers for paths containing spaces or percent.
SUR3AA_SERVICE_FILE="$SERVICE_DIR/sur3aa.service" SUR3AA_ENTRY="$SCRIPT_DIR/server/index.js" node - <<'JS'
const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$') + '"';
require('fs').writeFileSync(process.env.SUR3AA_SERVICE_FILE, `[Unit]
Description=Sur3aa local download server
After=graphical-session.target

[Service]
ExecStart=${quote(process.execPath)} ${quote(process.env.SUR3AA_ENTRY)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`);
JS
# Native dialogs need the current graphical session, not just the service PATH.
for variable in DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS; do
  if [ -n "${!variable:-}" ]; then systemctl --user import-environment "$variable"; fi
done
systemctl --user daemon-reload
systemctl --user enable sur3aa.service
systemctl --user restart sur3aa.service
sleep 1
if ! systemctl --user is-active --quiet sur3aa.service; then
  echo 'Server startup failed. Run: journalctl --user -u sur3aa -n 30'
  exit 1
fi
node - <<'JS'
fetch('http://127.0.0.1:3333/ping', { signal: AbortSignal.timeout(5000) })
  .then(response => response.json()).then(data => {
    if (data.app !== 'sur3aa') throw new Error('Unexpected server on port 3333');
    console.log('Sur3aa is running and will start at login. Load the extension/ folder in your browser.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
JS
