# Sur3aa

## What it is

Sur3aa is a personal YouTube download manager made of two parts: a Brave/Chrome browser extension and a local Node.js server. The extension adds a download button to YouTube video pages. The server runs silently in the background and uses yt-dlp and ffmpeg to handle the actual download.

## Requirements

- Node.js (v18 or later) + npm
- Brave or Chrome browser
- Linux (the folder picker uses zenity — install with `sudo apt install zenity`)

yt-dlp and ffmpeg are installed automatically by the setup script.

## Setup (one time only)

```bash
chmod +x setup.sh
./setup.sh
```

This installs ffmpeg, yt-dlp, the server's Node.js dependencies, and registers the server as a **systemd user service** that starts automatically in the background on every login. You never need to start it manually.

To check if the server is running:
```bash
systemctl --user status sur3aa
```

## Loading the extension

1. Open Brave or Chrome and go to `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the `extension/` folder in this repo

That's it — the extension is active and the server is already running in the background.

## Using the extension

1. Navigate to any YouTube video — a red **⬇ Download** button appears below the video title
2. Click the button — a format panel opens with a range slider and format options
3. *(Optional)* Drag the **left dot** on the slider to set the start point and the **right dot** to set the end point — the time codes update live. Leave both handles at the edges to download the full video.
4. Click a format (e.g. `1080p — video + audio`, `720p`, or `Audio only (mp3)`)
5. A system folder picker dialog opens — choose where to save the file
6. The download starts:
   - A progress panel appears in the bottom-right of the YouTube page showing percent, speed, and ETA
   - An inline status badge next to the button shows ⏳ Downloading → ✓ Done
   - The extension popup (click the Sur3aa icon in the toolbar) also lists active downloads with cancel buttons

## Notes

- If you see **✗ Server not running** next to the button, run `systemctl --user start sur3aa` or re-run `setup.sh`
- The folder picker uses **zenity** — install with `sudo apt install zenity` if missing
- yt-dlp uses 4 parallel fragment connections per download for faster speeds
- The server handles up to 3 concurrent downloads
