# Sur3aa

## What it is

Sur3aa is a personal YouTube download manager made of two parts: a Brave/Chrome browser extension and a local Node.js server. The extension adds a download button to YouTube video pages. The server runs silently in the background and uses yt-dlp and ffmpeg to handle the actual download.

## Requirements

- Node.js (v18 or later) + npm, download from [nodejs.org](https://nodejs.org)
- Brave or Chrome browser
- Windows 10/11 **or** Linux

yt-dlp and ffmpeg are installed automatically by the setup script.

## Setup (one time only)

### Windows

Open **Command Prompt** in the project folder and run:

```cmd
setup.bat
```

Or just double-click `setup.bat` in File Explorer.

The script installs all dependencies, starts the server in the background, and registers it to start automatically on every login. No terminal window, no manual steps.

### Linux

```bash
chmod +x setup.sh
./setup.sh
```

The script installs all dependencies and registers the server as a **systemd user service** that starts automatically in the background on every login.

---

On both platforms, once setup is done you never need to think about the server again. It just works silently in the background.

## Loading the extension

1. Open Brave or Chrome and go to `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the `extension/` folder in this repo

The extension is now active and the server is already running.

## Using the extension

1. Navigate to any YouTube video. A red **Download** button appears below the video title.
2. Click the button. A format panel opens instantly (formats are prefetched as soon as you land on the page).
3. *(Optional)* Drag the **left dot** on the slider to set the start point and the **right dot** to set the end point. The time codes update live. Leave both handles at the edges to download the full video.
4. Click a format (e.g. `1080p - video + audio`, `720p`, or `Audio only (mp3)`)
5. A folder picker dialog opens. Choose where to save the file.
6. The download starts:
   - A progress panel appears in the bottom-right of the YouTube page showing percent, speed, and ETA
   - An inline status badge next to the button shows Downloading then Done
   - The extension popup (click the Sur3aa icon in the toolbar) also lists active downloads with cancel buttons

## Managing the server

### Windows

| What | How |
|---|---|
| Stop the server | Run `stop-server.bat` |
| Start it again (hidden) | Double-click `start-server-hidden.vbs` |
| Start it (visible terminal, for debugging) | Run `start-server.bat` |
| Remove autostart | Delete `Sur3aa.vbs` from `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` |

If you see **Server not running** next to the button, double-click `start-server-hidden.vbs`.

### Linux

| What | How |
|---|---|
| Check status | `systemctl --user status sur3aa` |
| Stop the server | `systemctl --user stop sur3aa` |
| Start it again | `systemctl --user start sur3aa` |

If you see **Server not running** next to the button, run `systemctl --user start sur3aa` or re-run `setup.sh`.

## Notes

- The server uses near-zero CPU when idle. It wakes only when the extension calls it.
- Formats are prefetched as soon as you open a YouTube video, so the panel opens instantly when you click Download.
- yt-dlp uses 8 parallel fragment connections per download for faster speeds.
- The server handles up to 3 concurrent downloads.
