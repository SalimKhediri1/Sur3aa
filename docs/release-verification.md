# Release verification, 2026-10-13

## Goal and status

Prepare the existing extension and local server for public use while retaining format selection, full video downloads, MP3 conversion, clips, folder selection, progress, cancellation, and three concurrent jobs. Installation should be reproducible on Linux and Windows.

Implementation and automated Linux checks are complete. Native Windows setup, folder selection, and login startup still require a Windows desktop check. The owner opened a separate VirtualBox Windows VM and then explicitly requested that autonomous Windows VM testing stop. Native Windows verification is therefore left as a manual release check; Wine and PowerShell encoding checks passed. The Linux “server not running” report was reproduced as a refused connection and a missing user service. Normal setup now installed, enabled, and started the persistent Linux user service.

## Checks actually run

| Check | Result | Scope |
|---|---|---|
| Node regression suite | Passed, 20 tests with PowerShell enabled after the Windows picker follow-up | Worker authorization, API guards, request validation, format discovery and cache, concurrency, process errors, folder lifecycle, paths, progress chunks, cancellation, file isolation, Windows picker ownership and cleanup |
| Windows Node 22.23.3 under Wine | Passed, final 15 test suite | Real Windows Node runtime and Windows filesystem behavior, mocked downloader and native dialog |
| Chromium DOM smoke | Passed after the final folder protocol change | Real DOM with simulated API responses, injection, format menu, trim, concurrent requests, cancellation, navigation, progress resumption, popup rendering, popup cancel, HTTP failure |
| Loaded MV3 extension connection | Passed | Actual content script through worker to guarded local server, fixture YouTube document |
| Live YouTube integration | Passed | Actual format lookup, video, MP3 and clip downloads using yt-dlp 2026.08.19 and ffmpeg 9.0.1 |
| File inspection | Passed | ffprobe confirmed audio in all three outputs and a two second video clip |
| Linux full installation | Passed | Normal setup installed and enabled the persistent user service, started it, and checked the live ping endpoint |
| Linux setup without autostart | Passed | Reproducible npm install, tool discovery, dependency check, manual start instructions; system tools already present |
| Linux background runtime | Passed | Temporary systemd user service started, ping and job APIs responded, socket bound only to 127.0.0.1; native picker accepted a request and remained pending until test shutdown |
| systemd unit parser | Passed | Generated service with spaces, percent signs, and dollar signs in the script path |
| Windows PowerShell encoding regression | Passed | Real Read-Tools function tested with PS5.1 legacy default encoding emulated on PS7; UTF-8 paths preserved |
| PowerShell parser | Passed after the final edit | Official PowerShell 7.6.6 parser on Linux |
| npm production audit | Zero known vulnerabilities | Updated proxy-addr and qs within existing dependency ranges |

The live test uses a public 19 second YouTube video and deletes its temporary outputs. The old yt-dlp example video was unavailable; the test uses a currently available video instead. Network checks are opt in because YouTube availability, anti-bot restrictions, and extraction behavior can change.

## Changes and decisions

- Added actionable setup guidance to the extension offline UI and emphasized that the local server must be installed before loading the extension.
- Kept Node.js, Express, vanilla JavaScript, and the existing extension UI. Added no npm packages.
- Raised the minimum Node version to 22 and enabled that executable as yt-dlp's JavaScript runtime, matching current extractor requirements.
- Moved local API requests from the YouTube content script to the extension worker and used IPv4 explicitly. Reduced host permissions to the local server.
- Read machine tool paths and process records explicitly as UTF-8 so Windows PowerShell 5.1 preserves Unicode folder names. The Windows launch workflow places node.exe in a Unicode path to verify both reads.
- Replaced the misplaced Windows Startup script copy with a shortcut to the project launcher. Recorded absolute executable paths, verified startup, and replaced port based process killing with process identity checks.
- Made folder selection asynchronous so choosing a folder for more than 30 seconds does not lose the worker request. Preserved UTF-8, spaces, picker locks, cancellation, and errors.
- Validated request types, complete URLs, formats, times, ordering, and writable directories inside home. Fixed split progress parsing and capped buffered errors, jobs, cached formats, and process concurrency.
- Cached and shared format lookups, included videos with audio already present, and bounded extractor runtime. Audio requests select audio streams instead of downloading an unnecessary video stream.
- Separated audio, resolution, and clip filenames and private temporary files. A live test exposed MP3 conversion deleting an existing video with the same stem, which these changes fixed.
- Restored UI tracking after YouTube navigation and allowed more than one active download from a page. Added slider and close button accessibility labels.
- Kept the home directory restriction from the original project. External drives and symlinks outside home remain rejected.
- Limited the shell installer to Linux, which is the requested platform and the only Unix platform with a working native picker here. Removed misleading macOS and guaranteed maximum speed claims.
- Added GitHub Actions for native Linux/Windows Node tests, script checks, browser behavior, and Windows launch/stop from a folder with spaces and Unicode. The workflow has not been run remotely yet.

## Before public release

1. Run the GitHub Actions workflow on the repository and require green Linux and Windows checks.
2. In the Windows VM, place the project in a folder with spaces, install Node 22 or newer, and run setup.bat. Re-run setup to confirm installed tools are reused.
3. Load extension/ in Chrome or Brave, refresh YouTube, choose a home folder containing spaces or Unicode, and verify video, MP3, and a trimmed clip. Leave the folder dialog open for more than 30 seconds before confirming once. Verify cancellation stops ffmpeg too.
4. Sign out and back in. Confirm the Startup shortcut launches the server. Test stop-server.bat and the hidden launcher. Check logs when diagnosing a failure.
5. On a Linux desktop using systemd, verify the picker from the background service after login. This session installed and enabled the persistent service and checked its health. Full native folder selection and a new login session remain manual checks.

## Verification limits

### Windows picker follow-up

The Windows folder dialog now uses a shown, activated, invisible topmost Windows Forms owner. Both the owner and dialog are disposed in a finally block. Linux's zenity command is unchanged. The real generated PowerShell command passed selection, cancellation, failure cleanup, and Unicode output checks using simulated UI objects in PowerShell 7.6.6 on Linux. This regression also runs under Windows PowerShell in CI. Actual foreground placement still requires confirmation on the user's Windows desktop. The approach uses [Form.TopMost](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.form.topmost?view=netframework-4.8.1) and the dialog's owner overload.

### Download speed follow-up

The video download path now reuses the extractor result already fetched for the format menu using yt-dlp's `--load-info-json`. It retains at most eight results of at most 2 MiB each for five minutes, excludes live/upcoming streams, and keeps this metadata out of API responses. HTTP 403/404/410 or unavailable-format failures retry once through fresh URL extraction, preserving the job and cancellation state. Job cleanup removes the temporary metadata file. Temporary media now lives on the destination filesystem, avoiding a full-file copy from `/tmp` or another drive.

Measured locally with the same public 19-second video (`jNQXAC9IVRw`), the same highest offered resolution, and the same 474,478-byte output. Each round performed a format lookup first, then timed POST `/download` through completed status with 100 ms polling. The time below excludes the initial format lookup, which the extension normally prefetches.

| Measurement | Before, two runs | After, two runs |
|---|---|---|
| Download completion | 2,681 / 2,534 ms | 1,037 / 1,001 ms |
| First yt-dlp download output | 1,998 / 1,899 ms | 407 / 406 ms |

All 19 Node regression tests passed after this change, including cache expiry, cancellation during retry, live-stream bypass, metadata size limits, and temporary-file cleanup. The persistent Linux service was restarted while no downloads were active and its health endpoint passed.

These small-video measurements show reduced startup overhead, not a guaranteed network transfer speedup for every video. A real stale-link check injected a locally served HTTP 403 into cached metadata: Sur3aa refreshed from YouTube and completed with two downloader attempts and one output file. Real video, MP3, and accurate two-second clip downloads passed after cache reuse, with ffprobe validating their streams and duration. No resolution, codec preference, or clip accuracy was reduced. Existing eight-fragment concurrency was retained rather than increased without evidence.

Wine does not prove winget installation, Windows Forms rendering, COM shortcuts, or Windows login behavior. The Chromium fixture does not prove compatibility with every future YouTube layout. Successful live tests prove the tested public video only; private, age restricted, region restricted videos, and anti-bot challenges are not supported authentication flows.

No blanket claim that every video works or that code contains no possible bugs is made. The checks define the release evidence and the remaining work explicitly.

Windows PowerShell 5.1 encoding behavior was checked against [Microsoft's character encoding reference](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-5.1). The reproduction failed on the previous Read-Tools function and passed after explicit UTF-8 decoding.
