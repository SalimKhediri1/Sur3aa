param([ValidateSet('Setup', 'Start', 'Stop', 'Foreground')][string]$Action = 'Start', [switch]$NoAutostart)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$serverDir = Join-Path $projectDir 'server'
$entryPath = Join-Path $serverDir 'index.js'
$toolsPath = Join-Path $serverDir 'tools.json'
$runtimePath = Join-Path $serverDir 'runtime.json'

function Refresh-Path {
    $paths = @($env:PATH, [Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'))
    $env:PATH = ($paths | Where-Object { $_ }) -join ';'
}
function Resolve-Tool([string]$Name) {
    Refresh-Path
    $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    # Portable winget packages may not expose their executable until the next login.
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $packages) {
        $match = Get-ChildItem $packages -Filter "$Name.exe" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) { return $match.FullName }
    }
    return $null
}
function Read-Tools {
    if (Test-Path $toolsPath) { return Get-Content $toolsPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    return [pscustomobject]@{ node = (Resolve-Tool 'node') }
}
function Server-Running {
    try {
        $response = Invoke-RestMethod 'http://127.0.0.1:3333/ping' -TimeoutSec 2
        return ($response.app -eq 'sur3aa' -and $response.status -eq 'ok')
    } catch { return $false }
}
function Start-Server {
    if (Server-Running) { Write-Host 'Sur3aa is already running.'; return }
    $tools = Read-Tools
    if (!$tools.node -or !(Test-Path $tools.node)) { throw 'Node.js not found. Run setup.bat first.' }
    $log = Join-Path $serverDir 'server.log'
    $errorLog = Join-Path $serverDir 'server-error.log'
    $process = Start-Process -FilePath $tools.node -ArgumentList ('"' + $entryPath + '"') -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        $process.Refresh()
        if ($process.HasExited) { throw "Server exited. See $errorLog" }
        if (Server-Running) { Write-Host 'Sur3aa is running.'; return }
    }
    # Only stop the process created by this invocation if startup never succeeds.
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    throw "Server did not start. See $errorLog"
}
try {
    switch ($Action) {
        'Setup' {
            $node = Resolve-Tool 'node'
            if (!$node) { throw 'Install Node.js 22 or newer from https://nodejs.org, then run setup.bat again.' }
            $major = [int](& $node -p 'process.versions.node.split(String.fromCharCode(46))[0]')
            if ($LASTEXITCODE -ne 0 -or $major -lt 22) { throw 'Node.js 22 or newer is required.' }
            $npm = Join-Path (Split-Path $node) 'npm.cmd'
            if (!(Test-Path $npm)) { throw 'npm.cmd not found beside Node.js. Reinstall Node.js with npm included.' }
            foreach ($package in @(@('ffmpeg', 'Gyan.FFmpeg'), @('yt-dlp', 'yt-dlp.yt-dlp'))) {
                if (!(Resolve-Tool $package[0])) {
                    if (!(Get-Command 'winget.exe' -ErrorAction SilentlyContinue)) { throw 'Install App Installer from the Microsoft Store, or install ffmpeg and yt-dlp manually.' }
                    & winget.exe install --id $package[1] --exact --accept-package-agreements --accept-source-agreements
                    if ($LASTEXITCODE -ne 0 -and !(Resolve-Tool $package[0])) { throw "Could not install $($package[0])." }
                }
            }
            $ffmpeg = Resolve-Tool 'ffmpeg'
            $ytDlp = Resolve-Tool 'yt-dlp'
            if (!$ffmpeg -or !$ytDlp) { throw 'Tools were installed but could not be found. Open a new terminal and run setup.bat again.' }
            $tools = @{ node = $node; ffmpeg = $ffmpeg; ytDlp = $ytDlp } | ConvertTo-Json
            [IO.File]::WriteAllText($toolsPath, $tools, (New-Object System.Text.UTF8Encoding($false)))
            Push-Location $serverDir
            try {
                & $npm ci --omit=dev --ignore-scripts --no-audit --no-fund
                if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
                & $node 'doctor.js'
                if ($LASTEXITCODE -ne 0) { throw 'Dependency check failed. Resolve the errors above and run setup again.' }
            } finally { Pop-Location }
            Start-Server
            if (!$NoAutostart) {
                $startup = [Environment]::GetFolderPath('Startup')
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut((Join-Path $startup 'Sur3aa.lnk'))
                $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
                $shortcut.Arguments = '"' + (Join-Path $projectDir 'start-server-hidden.vbs') + '"'
                $shortcut.WorkingDirectory = $projectDir
                $shortcut.Description = 'Start Sur3aa local download server'
                $shortcut.Save()
                # Remove only the old launcher that this project's earlier setup created.
                $legacy = Join-Path $startup 'Sur3aa.vbs'
                if (Test-Path $legacy) {
                    $legacyText = Get-Content $legacy -Raw
                    if ($legacyText.Contains('Sur3aa Node.js server')) { Remove-Item $legacy }
                }
                Write-Host 'Sur3aa will start at login. Keep this project in its current folder.'
            }
            Write-Host 'Setup complete. Load the extension/ folder in Chrome or Brave.'
        }
        'Start' { Start-Server }
        'Foreground' {
            $tools = Read-Tools
            if (!$tools.node) { throw 'Node.js not found. Run setup.bat first.' }
            & $tools.node $entryPath
            exit $LASTEXITCODE
        }
        'Stop' {
            if (!(Test-Path $runtimePath)) { throw 'No Sur3aa process record found. No process was stopped.' }
            $runtime = Get-Content $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $running = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$runtime.pid)"
            if (!$running) { Remove-Item $runtimePath; Write-Host 'Sur3aa is already stopped.'; return }
            if ($running.ExecutablePath -ne $runtime.node -or !$running.CommandLine -or $running.CommandLine.IndexOf($entryPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw 'Process identity does not match Sur3aa. No process was stopped.'
            }
            & taskkill.exe /PID $runtime.pid /T /F
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop Sur3aa.' }
            Remove-Item $runtimePath -ErrorAction SilentlyContinue
            Write-Host 'Sur3aa stopped.'
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
