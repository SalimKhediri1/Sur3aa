# Sur3aa — Project Instructions for Claude Code

## Project overview
Sur3aa (سرعة) is a personal YouTube download manager: a Brave/Chrome extension + a local Node.js server. The extension injects a Download button into YouTube pages. The server runs yt-dlp and ffmpeg in the background.

## Repo structure
```
sur3aa/
├── extension/
│   ├── manifest.json          — MV3 manifest, declares permissions and host_permissions
│   ├── content_script.js      — injected into youtube.com; button, format panel, progress UI
│   ├── background.js          — service worker, restricted relay to the local API
│   └── popup/
│       ├── popup.html
│       └── popup.js           — download job list with live polling
├── server/
│   ├── index.js               — Express app, CORS + Host guard, loopback-only binding
│   ├── config.js              — port and default download path
│   └── routes/
│       └── download.js        — all download logic: /formats, /status, /jobs, /pick-folder, POST /
├── setup.sh                   — Linux: checks tools, installs missing tools and locked npm deps, optional systemd service
├── setup.bat                  — Windows entry point for windows-server.ps1
├── start-server.bat           — Windows: start server visibly (debugging)
├── start-server-hidden.vbs    — Windows: start server silently
└── stop-server.bat            — Windows: stop only the recorded and verified Sur3aa process tree
```

## Architecture decisions worth knowing
- Server binds to `127.0.0.1` only — never reachable from the LAN.
- Requests use Host and Origin guards. Only valid chrome-extension:// origins and local CLI requests pass; YouTube pages call through the extension worker. All extension requests use 127.0.0.1 to avoid IPv6 localhost failures.
- `spawn(config.ytDlp, args)` always uses argv arrays. URL parsing validates and canonicalizes video IDs before spawning. Setup records absolute tools in ignored server/tools.json. Node 22 or newer is enabled explicitly as the yt-dlp runtime.
- Full downloads use `--concurrent-fragments 8 --newline`. Audio selects bestaudio/best; clip cuts use --force-keyframes-at-cuts. Audio, resolutions, and clip ranges have separate output names and each job has a private temporary folder.
- Downloads reuse server-only extractor JSON for five minutes (at most eight entries, 2 MiB each); expired media errors retry the URL once. Temporary folders live inside the destination to avoid a cross-filesystem copy on completion.
- Segment downloads (`--download-sections`): yt-dlp hands URLs directly to ffmpeg, so there are no `[download] X%` stdout lines. Progress is parsed from ffmpeg's stderr `time=HH:MM:SS` output.
- `outputPath` uses realpath and path.relative to stay inside home on both platforms. Native folder pickers return an ID immediately; clients poll /download/pick-folder/:pickerId so the worker never waits for an interactive dialog. Windows cancellation uses taskkill /T; Linux downloads use process groups.

For release checks, see docs/release-verification.md. Run npm test --prefix server for deterministic regressions. Browser and live download checks are opt in scripts in server/package.json.

## Tech stack
- Server: Node.js, Express, `child_process.spawn` / `execFile`
- Extension: Vanilla JS, Manifest V3
- No bundler, no TypeScript, no frameworks.

## Coding principles
- No packages beyond what's already in `package.json` unless explicitly requested.
- No shell strings passed to child processes — always argv arrays.
- Don't modify files outside the scope of the current task.
