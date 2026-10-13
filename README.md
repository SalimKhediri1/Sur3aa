# Sur3aa — سرعة

Download YouTube videos, save audio as MP3, or save just part of a video. Sur3aa adds a **Download** button to YouTube in Chrome or Brave.

Your files are saved on your own computer. You do not need a Sur3aa account.

## Before you start

You need a **Windows 10/11** or **Linux** computer with a desktop, **Chrome or Brave**, and an internet connection. macOS is not supported yet.

**There are two setup steps:** run Sur3aa's setup file, then add the extension to your browser. Setup starts the helper that downloads your videos. Adding only the extension will show a “Server unavailable” message.

## 1. Download Sur3aa

1. Open [Sur3aa on GitHub](https://github.com/SalimKhediri1/Sur3aa).
2. Click the green/blue **Code** button, **Download ZIP** then Extract it.
4. Put the extracted folder somewhere you will keep it, Open it: you should see `setup.bat`, `setup.sh`, and a folder named `extension`.

Keep this folder after setup. Sur3aa needs the files inside it to run.

## 2. Set up your computer

Follow the instructions for **your operating system**

### Windows

1. Visit [nodejs.org](https://nodejs.org/) and download the **LTS Windows installer**. Sur3aa needs Node.js version 22 or newer. Node.js is the program that runs the download helper.
2. Open the installer and follow its steps. Keep the default options, including **npm**.
3. Open your extracted Sur3aa folder and double-click **`setup.bat`**. If Windows hides file extensions, it may appear as **setup**, with the type **Windows Batch File**.
4. When setup succeeds, the window may close. Continue to step 3 below. If it shows an error and stays open, read the [help section](#need-help).

The helper starts immediately and starts again when you sign in to Windows. You do not need to keep a terminal window open.

### Linux

1. Visit [nodejs.org](https://nodejs.org/) and follow its **Linux installation instructions** for Node.js 22 or newer, including npm. If you already have it installed, skip this step.
2. Open your extracted Sur3aa folder in your file manager.
3. Right-click an empty area and choose **Open in Terminal**. The wording may differ on your desktop. Make sure this folder contains `setup.sh`.
4. Copy this command into the terminal and press **Enter**:

   ```bash
   bash setup.sh
   ```
5. Wait for **“Sur3aa is running and will start at login.”** Then continue to step 3 below.

Most Linux desktops can start the helper automatically when you sign in. If setup instead says **“Start manually”**, copy the command it prints, run it in that terminal, and keep the terminal open while using Sur3aa. Repeat that manual start after restarting your computer.

## 3. Add Sur3aa to your browser

1. Open Chrome or Brave.
2. Copy the address for your browser into its address bar and press **Enter**:

   | Browser | Address |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Brave | `brave://extensions` |

3. Turn on **Developer mode**, usually in the top-right corner. This lets you add an extension from your computer.
4. Click **Load unpacked**.
5. Find the Sur3aa folder you extracted. Select the **`extension` folder inside it**, then click **Select Folder** or **Open**.
6. You should see a **Sur3aa** card on the extensions page. Open YouTube, or refresh any YouTube tabs you already had open.

## 4. Download your first video

1. Open a video on YouTube.
2. Click the red **Download** button below the video title.
3. To save the whole video, leave the two time sliders at their starting positions. To save a clip, move them to choose the start and end.
4. Choose a video quality, such as **720p**, or choose **Audio only (mp3)**.
5. Choose where to save the file. Your **Downloads** folder is a good choice. The folder must be inside your personal user folder; external drives are not supported.
6. Wait for **Done**, then open the folder you chose to find your file.

You can follow progress on the YouTube page or by clicking Sur3aa in your browser's extensions menu (the puzzle-piece icon). Click **Cancel** to stop a download. Closing the progress panel does not stop it.

You can download up to three items at once. Clips can take longer because Sur3aa processes the video to cut at the times you selected.

Only download content you have permission to save. Some videos, including private, age-restricted, and region-restricted videos, may not work.

## Need help?

### “Server unavailable” or “Server not running”

The download helper is not running. You do not need to buy or rent a server; the helper runs on your own computer.

- **First installation:** finish step 2 above before loading the extension.
- **Windows:** open your Sur3aa folder and double-click `start-server-hidden.vbs`. If that fails, run `setup.bat` again.
- **Linux:** open a terminal in your Sur3aa folder and run `bash setup.sh` again. If setup prints a manual start command, run it and keep that terminal open.

Then refresh YouTube and try again.

### Setup says Node.js or npm is missing

Install Node.js 22 or newer from [nodejs.org](https://nodejs.org/), keeping npm included. Close and reopen your terminal, then repeat setup.

### Windows setup says “winget” or “App Installer” is missing

Open **Microsoft Store**, search for **App Installer** by Microsoft, and install or update it. Then run `setup.bat` again.

### Linux says “No such file or directory”

Your terminal is in the wrong folder. Open the folder containing `setup.sh`, choose **Open in Terminal**, and try `bash setup.sh` again.

### The Download button is missing

Check that Sur3aa is switched on at `chrome://extensions` or `brave://extensions`. Open a video page and refresh it. Sur3aa's button appears on video pages, rather than the YouTube home page.

### A download fails

Move your mouse over the error message to see more detail. Try another public video to check whether the problem affects only that video.

YouTube changes sometimes require an update to the download tool:

- **Linux:** open a terminal in your Sur3aa folder and run `bash setup.sh --update-ytdlp`.
- **Windows:** open a terminal in your Sur3aa folder and run `winget upgrade --id yt-dlp.yt-dlp --exact`. When it finishes, run `setup.bat` again.

### The folder is rejected or the folder window does not open

Choose an existing folder inside your personal user folder, such as **Downloads** or **Documents**. On Linux, run setup from a terminal on your desktop, then try again.

### I moved the Sur3aa folder

Stop the helper using the instructions below, then run setup from the folder's new location. If the extension shows an error, remove its old browser entry and load the new `extension` folder using step 3.

## Update or remove Sur3aa

**To update:** stop the helper, replace the files in your existing Sur3aa folder with the newly downloaded files, and repeat setup. On your browser's extensions page, click **Reload** on the Sur3aa card, then refresh YouTube.

**To stop the helper:**

- **Windows:** double-click `stop-server.bat` in your Sur3aa folder.
- **Linux with automatic startup:** run `systemctl --user stop sur3aa` in a terminal.
- **Linux with manual startup:** press **Ctrl+C** in the terminal running the helper.

**To remove Sur3aa completely:**

1. Click **Remove** on Sur3aa's card at `chrome://extensions` or `brave://extensions`.
2. Remove automatic startup:
   - **Windows:** press **Windows+R**, type `shell:startup`, and press **Enter**. Delete the **Sur3aa** shortcut, then run `stop-server.bat`.
   - **Linux with automatic startup:** run `systemctl --user disable --now sur3aa`.
   - **Linux with manual startup:** press **Ctrl+C** in the helper's terminal.
3. Delete your Sur3aa folder. Files you downloaded into other folders stay there. Node.js and the other tools installed during setup also remain installed.

## For developers

See [the developer guide](docs/development.md) for test commands and advanced setup options, and [the verification record](docs/release-verification.md) for tested behavior and remain
