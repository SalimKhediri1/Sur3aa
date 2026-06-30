#!/usr/bin/env bash
#
# Sur3aa setup script for Linux and macOS.
# Installs ffmpeg, yt-dlp, and the server's Node.js dependencies.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Exits with a clear message if any step fails.

set -e

# Resolve the project root so the script works no matter where it's called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Detect the operating system ---
OS="$(uname -s)"
case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *)
    echo "Error: unsupported operating system '$OS'. This script supports Linux and macOS only."
    exit 1
    ;;
esac

echo "==> Detected platform: $PLATFORM"

# --- Install ffmpeg ---
echo "==> Installing ffmpeg..."
if [ "$PLATFORM" = "linux" ]; then
  if command -v apt >/dev/null 2>&1; then
    sudo apt install -y ffmpeg
  elif command -v dnf >/dev/null 2>&1; then
    # Fedora fallback when apt isn't available
    sudo dnf install -y ffmpeg
  else
    echo "Error: neither apt nor dnf was found. Please install ffmpeg manually, then re-run this script."
    exit 1
  fi
elif [ "$PLATFORM" = "macos" ]; then
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  else
    echo "Error: Homebrew is not installed."
    echo "Install it first from https://brew.sh then re-run this script."
    exit 1
  fi
fi

# --- Install yt-dlp ---
echo "==> Installing yt-dlp..."
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"

if [ "$PLATFORM" = "linux" ]; then
  YTDLP_DIR="$HOME/.local/bin"
else
  YTDLP_DIR="/usr/local/bin"
fi
YTDLP_PATH="$YTDLP_DIR/yt-dlp"

# ~/.local/bin may not exist yet on a fresh Linux install
mkdir -p "$YTDLP_DIR"

# Prefer curl, fall back to wget
if command -v curl >/dev/null 2>&1; then
  curl -L "$YTDLP_URL" -o "$YTDLP_PATH"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$YTDLP_PATH" "$YTDLP_URL"
else
  echo "Error: neither curl nor wget was found. Please install one of them, then re-run this script."
  exit 1
fi

chmod +x "$YTDLP_PATH"
echo "==> yt-dlp installed to $YTDLP_PATH"

# --- Ensure ~/.local/bin is on PATH (Linux only) ---
if [ "$PLATFORM" = "linux" ]; then
  case ":$PATH:" in
    *":$HOME/.local/bin:"*)
      : # already on PATH, nothing to do
      ;;
    *)
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
      echo "==> Added ~/.local/bin to PATH in ~/.bashrc"
      echo "    Run 'source ~/.bashrc' or restart your terminal for it to take effect."
      ;;
  esac
fi

# --- Install Node.js dependencies ---
echo "==> Installing server dependencies..."
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm was not found. Install Node.js (v18+) from https://nodejs.org then re-run this script."
  exit 1
fi
( cd "$SCRIPT_DIR/server" && npm install )

# --- Install systemd user service (Linux only) ---
if [ "$PLATFORM" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
  echo "==> Installing Sur3aa as a background service..."

  NODE_BIN="$(command -v node)"
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"

  cat > "$SERVICE_DIR/sur3aa.service" << EOF
[Unit]
Description=Sur3aa local download server
After=network.target

[Service]
ExecStart=$NODE_BIN $SCRIPT_DIR/server/index.js
Restart=on-failure
RestartSec=5
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable sur3aa.service
  # Restart instead of start so re-running setup picks up any changes
  systemctl --user restart sur3aa.service
  echo "==> Sur3aa server is running in the background and will start automatically on login"
else
  echo "==> Skipping service install (not Linux/systemd). Start the server manually with:"
  echo "    node server/index.js"
fi

# --- Done ---
echo ""
echo "============================================"
echo "  Sur3aa setup complete!"
echo "============================================"
echo "Load the extension in your browser (see the README)."
echo "The server runs automatically in the background — no need to start it manually."
