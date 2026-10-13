param([string]$PickerScriptFile, [ValidateSet('OK', 'Cancel', 'Throw')][string]$Outcome)
$ErrorActionPreference = 'Stop'
$global:pickerOutcome = $Outcome
$global:pickerOwner = $null
$global:pickerDialog = $null

# Execute the actual picker command with fake UI objects. This verifies owner
# activation, selection, cancellation and cleanup without opening a CI dialog.
function Add-Type { param([string]$AssemblyName) }
function New-Object {
    param([string]$TypeName)
    switch ($TypeName) {
        'System.Windows.Forms.Form' {
            $global:pickerOwner = [pscustomobject]@{
                TopMost = $false; ShowInTaskbar = $true; Opacity = 1
                FormBorderStyle = ''; Width = 0; Height = 0; StartPosition = ''
                Shown = $false; Activated = $false; Disposed = $false
            }
            $global:pickerOwner | Add-Member ScriptMethod Show { $this.Shown = $true }
            $global:pickerOwner | Add-Member ScriptMethod Activate { $this.Activated = $true }
            $global:pickerOwner | Add-Member ScriptMethod Dispose { $this.Disposed = $true }
            return $global:pickerOwner
        }
        'System.Windows.Forms.FolderBrowserDialog' {
            $global:pickerDialog = [pscustomobject]@{
                Description = ''; SelectedPath = ('C:\Users\test' + [char]0xE9 + '\Downloads'); Disposed = $false
            }
            $global:pickerDialog | Add-Member ScriptMethod ShowDialog {
                param($owner)
                if (!$owner -or !$owner.TopMost -or !$owner.Shown -or !$owner.Activated) {
                    throw 'Picker must receive a shown and activated topmost owner.'
                }
                if ($owner.ShowInTaskbar -or $owner.Opacity -ne 0) { throw 'Owner must be invisible.' }
                if ($global:pickerOutcome -eq 'Throw') { throw 'Simulated picker failure' }
                return $global:pickerOutcome
            }
            $global:pickerDialog | Add-Member ScriptMethod Dispose { $this.Disposed = $true }
            return $global:pickerDialog
        }
        default { return Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName }
    }
}

$caught = $null
try { Invoke-Expression ([IO.File]::ReadAllText($PickerScriptFile)) }
catch { $caught = $_ }
if ($Outcome -eq 'Throw') {
    if (!$caught -or $caught.Exception.Message -notlike '*Simulated picker failure*') {
        throw 'Expected the simulated dialog failure.'
    }
} elseif ($caught) { throw $caught }
if (!$global:pickerOwner.Disposed -or !$global:pickerDialog.Disposed) {
    throw 'Both UI objects must be disposed after selection, cancellation or failure.'
}
Write-Output ('PASS: ' + $Outcome)
