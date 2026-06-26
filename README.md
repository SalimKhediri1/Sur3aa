# Sur3aa

## What it is

Sur3aa is a personal YouTube download manager made of two parts: a Brave/Chrome browser extension and a local Node.js server. The extension adds a download button to YouTube video pages and lets you pick a format. The server receives the request and uses yt-dlp and ffmpeg to handle the actual download.

## Requirements

- Node.js (v18 or later)
- Brave or Chrome browser

yt-dlp and ffmpeg are installed automatically by the setup script below.

## Setup

**Linux / macOS**
```bash
chmod +x setup.sh
./setup.sh
```

**Windows**
Double-click `setup.bat` or run it from Command Prompt.

After setup completes, load the extension in your browser (see Extension section below).

## Extension

1. Start the server: `node server/index.js`
2. Open Brave or Chrome and go to `brave://extensions` or `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and select the `extension/` folder
5. Navigate to any YouTube video — the ⬇ Sur3aa button will appear

## Usage

Click the Sur3aa button on any YouTube video page. A format panel appears with resolution options and an audio-only option. Select a format. The file downloads to your system Downloads folder. A status indicator next to the button shows progress and confirms when the download is complete.

## Notes

- The server must be running locally for the extension to work
- Downloads go to the system Downloads folder by default (configurable in `server/config.js`)
- The server handles up to 3 concurrent downloads
