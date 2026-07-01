# Sur3aa — Project Instructions for Claude Code

## Project overview
Sur3aa (سرعة) is a personal YouTube download manager: a Brave/Chrome extension + a local Node.js server. The extension injects a Download button into YouTube pages. The server runs yt-dlp and ffmpeg in the background.

## Repo structure
```
sur3aa/
├── extension/
│   ├── manifest.json          — MV3 manifest, declares permissions and host_permissions
│   ├── content_script.js      — injected into youtube.com; button, format panel, progress UI
│   ├── background.js          — service worker (minimal, currently just logs load)
│   └── popup/
│       ├── popup.html
│       └── popup.js           — download job list with live polling
├── server/
│   ├── index.js               — Express app, CORS + Host guard, loopback-only binding
│   ├── config.js              — port and default download path
│   └── routes/
│       └── download.js        — all download logic: /formats, /status, /jobs, /pick-folder, POST /
├── setup.sh                   — Linux/macOS: installs ffmpeg, zenity, yt-dlp, npm deps, systemd service
├── setup.bat                  — Windows: same via winget + Startup folder autostart
├── start-server.bat           — Windows: start server visibly (debugging)
├── start-server-hidden.vbs    — Windows: start server silently
└── stop-server.bat            — Windows: kill process on port 3333
```

## Architecture decisions worth knowing
- Server binds to `127.0.0.1` only — never reachable from the LAN.
- Every request is checked against an `isAllowedOrigin` guard (youtube.com / chrome-extension://) AND a Host header whitelist (localhost:3333 / 127.0.0.1:3333) to block CSRF and DNS-rebinding.
- `spawn('yt-dlp', args)` — always array form, never shell string. URL is regex-validated before it reaches the process.
- Full downloads: `--concurrent-fragments 8 --buffer-size 16K --newline`.
- Segment downloads (`--download-sections`): yt-dlp hands URLs directly to ffmpeg, so there are no `[download] X%` stdout lines. Progress is parsed from ffmpeg's stderr `time=HH:MM:SS` output.
- `outputPath` is validated with `fs.realpathSync` (resolves symlinks) to stay within `os.homedir()`.

## Tech stack
- Server: Node.js, Express, `child_process.spawn` / `execFile`
- Extension: Vanilla JS, Manifest V3
- No bundler, no TypeScript, no frameworks.

## Coding principles
- No packages beyond what's already in `package.json` unless explicitly requested.
- No shell strings passed to child processes — always argv arrays.
- Don't modify files outside the scope of the current task.
