' Launch the script in the project directory. The Startup shortcut points here.
Dim fso, projectDir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & projectDir & "\windows-server.ps1"" -Action Start"
CreateObject("WScript.Shell").Run cmd, 0, False
