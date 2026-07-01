# Sur3aa — سرعة

A personal YouTube download manager for Brave and Chrome. Adds a **Download** button directly to YouTube video pages and handles everything else — format selection, segment trimming, folder picker, progress tracking — without touching a single line of code.

---

## How it works

Two parts work together:

- **Extension** — injects a Download button into YouTube. Lets you pick a format, trim a segment with a dual-handle slider, and choose a save folder.
- **Local server** — runs silently in the background. Receives download requests from the extension and calls yt-dlp + ffmpeg to do the actual work.

Nothing leaves your machine. No accounts, no cloud, no tracking.

---

## Requirements

Before running the setup script, make sure you have:

- [Node.js v18+](https://nodejs.org) (includes npm)
- Brave or Chrome
- Windows 10/11 or Linux

Everything else (yt-dlp, ffmpeg, zenity) is installed automatically.

---

## Setup

### Windows

Double-click `setup.bat`, or open a Command Prompt in the project folder and run:

```cmd
setup.bat
```

The script installs all dependencies, starts the server silently in the background, and registers it to auto-start on every login.

### Linux

```bash
chmod +x setup.sh
./setup.sh
```

The script installs all dependencies and registers the server as a systemd user service that starts automatically on every login.

---

Once setup is done, **you never need to touch the server again**. It runs silently in the background and survives reboots.

---

## Loading the extension

1. Go to `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder from this repo

The extension is now active.

> Brave and Chrome will show a "Disable developer mode extensions" prompt on startup — this is normal for any unpacked extension. Dismiss it once and it won't block anything.

---

## Using Sur3aa

1. Open any YouTube video — a red **Download** button appears below the title
2. Click it — a format panel opens instantly
3. **Optional:** use the slider to trim a segment — drag the left handle for start, right handle for end. Leave both at the edges for the full video.
4. Click your format (`1080p`, `720p`, `Audio only (mp3)`, etc.)
5. A folder picker opens — choose where to save
6. The download begins:
   - A progress panel appears in the bottom-right corner (percent, speed, ETA)
   - A status badge appears next to the Download button
   - The extension popup also shows active downloads with cancel buttons

---

## Managing the server

### Windows

| Action | How |
|---|---|
| Stop the server | Run `stop-server.bat` |
| Start again (silent) | Double-click `start-server-hidden.vbs` |
| Start again (visible, for debugging) | Run `start-server.bat` |
| Remove autostart | Delete `Sur3aa.vbs` from `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` |

If you see **Server not running** — double-click `start-server-hidden.vbs`.

### Linux

| Action | How |
|---|---|
| Check status | `systemctl --user status sur3aa` |
| Stop | `systemctl --user stop sur3aa` |
| Start again | `systemctl --user start sur3aa` |

If you see **Server not running** — run `systemctl --user start sur3aa` or re-run `./setup.sh`.

---

## Notes

- The server uses near-zero CPU at idle — it only wakes when you click Download.
- Formats are prefetched the moment you land on a video page, so the panel opens instantly.
- Downloads use 8 parallel connections for maximum speed.
- Up to 3 concurrent downloads are supported.
- Segment downloads (slider trimming) show real progress via ffmpeg output.
