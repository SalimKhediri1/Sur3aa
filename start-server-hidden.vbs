' Launches the Sur3aa Node.js server silently, no CMD window appears.
' Window style 0 = hidden; False = do not wait for the process to exit.
Dim fso, dir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "node """ & dir & "\server\index.js"""
CreateObject("WScript.Shell").Run cmd, 0, False
