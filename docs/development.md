# Developer guide

Sur3aa uses a Manifest V3 Chrome/Brave extension and a Node.js 22+ Express server. The server listens on `127.0.0.1:3333`; downloads run locally through yt-dlp and ffmpeg. No bundler or extra test dependencies are needed.

## Checks

```bash
npm ci --prefix server
npm test --prefix server
npm run doctor --prefix server
```

On Windows, check UTF-8 tool paths with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server/test/windows-encoding.ps1
```

The browser smoke test uses an isolated Chromium profile and simulated API responses:

```bash
npm run test:browser --prefix server
```

Set `CHROME_BIN` if Chromium has a different executable name. On Linux, `SUR3AA_REAL_EXTENSION=1 npm run test:browser --prefix server` also loads the actual extension and checks its local API connection. Port 3333 must be free for that mode.

The optional live check downloads a small public video, MP3, and clip, validates them with ffprobe, and deletes its test files:

```bash
npm run test:live --prefix server
```

GitHub Actions checks Linux and Windows on Node 22 and 24, runs Linux browser checks, and exercises Windows start/stop from a folder containing spaces and Unicode. See [release-verification.md](release-verification.md) for recorded results and manual checks.

## Advanced setup and diagnostics

- Linux setup supports apt, dnf, pacman, and zypper. Other distributions need ffmpeg, zenity, Python 3, and curl or wget installed manually. Run setup as the normal user; it requests sudo for missing system packages.
- Skip automatic startup with `bash setup.sh --no-autostart` on Linux or `setup.bat -NoAutostart` on Windows.
- Start manually from the project root with `node server/index.js`.
- Linux background logs: `journalctl --user -u sur3aa -n 50`.
- Windows foreground diagnostics: `start-server.bat`. Background logs: `server/server.log` and `server/server-error.log`.
- Health endpoint: `http://127.0.0.1:3333/ping`.
- Setup records absolute tool paths in ignored `server/tools.json`. The server writes its process identity to ignored `server/runtime.json`.
- Current yt-dlp YouTube support requires an external JavaScript runtime. Sur3aa enables Node explicitly. Some package-manager installations also need challenge solver scripts; see [yt-dlp's runtime guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Distribution

Share the complete project, including setup files and the server. Users load `extension/` through Developer mode after running setup. An extension cannot install or start an uninstalled local companion. [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) can launch a registered host, but the host requires a separate operating-system installation.

Chrome Web Store publishing requires a [one-time registration fee](https://developer.chrome.com/docs/webstore/register). Google's [violation guidance](https://developer.chrome.com/docs/webstore/troubleshooting#prohibited-products) lists facilitating YouTube video downloads as a reason for rejection or removal; direct distribution is the current approach for Sur3aa.
