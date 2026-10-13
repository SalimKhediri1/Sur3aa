# Sur3aa, سرعة

A YouTube download manager for Chrome and Brave. The extension adds a **Download** button to video pages. A local Node.js server uses yt-dlp and ffmpeg to save videos, MP3 audio, or a trimmed clip.

The server listens only on `127.0.0.1:3333`. Downloads go directly from YouTube to your computer. Sur3aa has no cloud service, accounts, or tracking.

## Start here

Sur3aa has two parts: the browser extension and a local download companion. **Install the companion once before loading the extension.**

1. Download and extract the **entire project** into a permanent folder.
2. Install Node.js 22 or newer from [nodejs.org](https://nodejs.org/).
3. Run setup: double click `setup.bat` on Windows, or run `./setup.sh` from the project folder in a Linux terminal. Wait for setup to finish successfully.
4. Load the `extension/` folder using your browser's **Load unpacked** button, as described below.
5. Open YouTube and use **Download**. You do not need to keep a server terminal open after successful automatic startup setup.

Setup starts the companion immediately and configures startup at login on Windows and graphical Linux systems with a systemd user session. Other Linux sessions require the manual start command printed by setup. Keep the project folder: startup uses files inside it.

## Sharing and distribution

Share the whole project with these installation instructions, rather than sharing only `extension/`. Loading the extension alone cannot install Node.js, yt-dlp, ffmpeg, or the companion service. A Chrome native messaging host could launch an installed companion, but it also requires a separate operating-system installation; see [Chrome's native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Direct distribution through the project's GitHub repository lets users load the extension in Developer mode. Chrome Web Store publishing requires a [one-time developer registration fee](https://developer.chrome.com/docs/webstore/register). More importantly for Sur3aa, Google's [violation guidance](https://developer.chrome.com/docs/webstore/troubleshooting#prohibited-products) explicitly lists facilitating YouTube video downloads as a reason for rejection or removal. The current YouTube downloader should therefore be distributed directly rather than relying on Web Store approval.

## Requirements

- **Node.js 22 or newer**, including npm, from [nodejs.org](https://nodejs.org/).
- Chrome or Brave.
- Windows 10/11 with Windows PowerShell, or Linux with a graphical desktop.
- An internet connection for setup and downloads.

Node 22 is required because current yt-dlp YouTube support uses an external JavaScript runtime. Sur3aa explicitly enables the installed Node executable. Official yt-dlp downloads include its challenge solver scripts. Package manager installations may require an extra package, see the [yt-dlp runtime guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Windows setup

Extract or clone the entire project into a permanent folder. Install Node.js first, then double click `setup.bat`. It installs missing yt-dlp and ffmpeg through winget, installs the locked server dependencies, checks the tools, starts the server, and creates a login shortcut pointing to this project.

If winget is unavailable, install Microsoft's **App Installer** or install yt-dlp and ffmpeg yourself and put them on PATH. Already installed tools are reused. Setup records their absolute paths so a new tool is available immediately without logging out.

To skip the login shortcut, run from Command Prompt:

```cmd
setup.bat -NoAutostart
```

Keep the project in its current folder. If you move it, stop the server first and run setup again from the new location.

## Linux setup

```bash
./setup.sh
```

Run as your normal user. Setup requests sudo only for missing system packages. It supports apt, dnf, pacman, and zypper. Distribution repositories must provide ffmpeg, zenity, and Python 3. If yours does not, install those tools manually first. Setup installs the official yt-dlp executable into `~/.local/bin` when missing and uses `npm ci` for reproducible dependencies.

On a graphical systemd user session, it creates and starts a user service. Otherwise it prints the command to start the server manually. To install dependencies without changing autostart:

```bash
./setup.sh --no-autostart
node server/index.js
```

To update the locally installed yt-dlp when YouTube changes:

```bash
./setup.sh --update-ytdlp
```

The shell script supports Linux. macOS is not currently supported.

**Run the setup for your operating system before loading the extension.** Loading an unpacked extension does not launch the local server.

## Load the extension

1. Open `chrome://extensions` or `brave://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the project's `extension/` folder.

After updating the code, click **Reload** on the extension card and refresh open YouTube tabs.

## Download

1. Open a YouTube `/watch` video page and click the red **Download** button below its title.
2. Choose a video resolution or **Audio only (mp3)**. When the video duration is available, the two slider handles let you select a clip. Leaving both at their edges downloads the full video.
3. Choose an existing writable folder **inside your user home directory**. Cancel the picker to abandon the request.
4. Watch progress in the page panel or the extension popup. **Cancel** stops the downloader and its ffmpeg children.

Up to three downloads can run at once. Identical active downloads to the same folder are rejected. Video filenames include the video ID and resolution. MP3 filenames use a separate audio label. Clips include their range. This avoids collisions between video, audio, and clips. The actual video container depends on the selected streams, it may be MP4, WebM, or MKV.

Downloads reuse recently fetched video information to avoid repeating the format lookup. Expired media links trigger one fresh lookup automatically. Temporary media stays in a private `.sur3aa-download-*` folder inside your chosen destination, so finishing a large file does not require copying it from another drive. This folder is removed when the download finishes, fails, or is cancelled.

Clip boundaries are reencoded for accurate cuts and may take more CPU than a full download. Closed progress panels do not stop downloads. The popup can still manage them. Completed jobs stay visible in the server for five minutes; job history resets on restart.

Use downloads only for content you have permission to save. Private, age restricted, region restricted, removed videos, and YouTube anti-bot challenges may require capabilities this app does not provide. Live streams have no finite trim slider.

## Manage the server

| Action | Windows | Linux with systemd |
|---|---|---|
| Start | `start-server-hidden.vbs` | `systemctl --user start sur3aa` |
| Stop | `stop-server.bat` | `systemctl --user stop sur3aa` |
| Debug | `start-server.bat` | `journalctl --user -u sur3aa -n 50` |
| Check status | `http://127.0.0.1:3333/ping` | `systemctl --user status sur3aa` |
| Remove autostart | Delete `Sur3aa.lnk` from `shell:startup` | `systemctl --user disable --now sur3aa` |

Manual start on either platform: `node server/index.js`. Keep that terminal open and use Ctrl+C there to stop it. When upgrading an older Windows installation, stop its old server before running the new setup.

Windows background logs are in `server/server.log` and `server/server-error.log`. The stop script checks the recorded Node executable and project path before killing a process, instead of killing whoever owns port 3333.

## Troubleshooting

- **Server unavailable:** check the server status, start it, and reload the extension and YouTube tab. Port 3333 must be free. Sur3aa uses IPv4 explicitly to avoid `localhost` resolving to an IPv6 address the server does not listen on.
- **Missing tools:** run `npm run doctor --prefix server`. Re-run setup after moving the project or reinstalling tools. `server/tools.json` holds machine specific tool paths and is not shared in git.
- **Windows yt-dlp update:** use `winget upgrade --id yt-dlp.yt-dlp --exact`, then re-run setup to refresh recorded paths.
- **Folder picker fails on Linux:** install zenity and run in a graphical session. Re-run setup inside that session so it imports the display environment for systemd. Restart the service after logging into a different graphical session if needed.
- **Download failed:** hover over the error in the progress panel or popup for the downloader's reason. Update yt-dlp before retrying a YouTube extraction error.
- **Folder rejected:** the chosen folder must exist, be writable, and resolve inside your home. External drives and symlinks pointing outside home are intentionally rejected.

## Development and verification

No bundler or extra test dependencies are needed.

```bash
npm ci --prefix server
npm test --prefix server
npm run doctor --prefix server
```

On Windows, also run `powershell -NoProfile -ExecutionPolicy Bypass -File server/test/windows-encoding.ps1` to verify that tool paths containing Unicode survive Windows PowerShell's default encoding.

Optional Chromium DOM checks, using a clean temporary profile and simulated API responses:

```bash
npm run test:browser --prefix server
```

Set `CHROME_BIN` if Chromium has a different executable name. On Linux, `SUR3AA_REAL_EXTENSION=1 npm run test:browser --prefix server` additionally loads the actual extension and checks its connection to the guarded server. Port 3333 must be free.

Optional live integration check, which downloads a small public video, MP3, and clip, inspects them with ffprobe, then deletes the test files:

```bash
npm run test:live --prefix server
```

GitHub Actions runs the regression tests on Linux and Windows with Node 22 and 24, checks scripts, verifies the browser UI on Linux, and exercises Windows start/stop from a folder containing spaces and Unicode. See [the release verification record](docs/release-verification.md) for the checks actually run and remaining manual checks.
