param([switch]$EmulateLegacyDefaults)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$scriptPath = Join-Path $PSScriptRoot '../../windows-server.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors) { throw 'Windows server script did not parse.' }
$readToolsFunction = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-Tools' }, $true)
Invoke-Expression $readToolsFunction.Extent.Text
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('sur3aa-encoding-' + [guid]::NewGuid())
New-Item -ItemType Directory $testDir | Out-Null
try {
    $toolsPath = Join-Path $testDir 'tools.json'
    $expected = 'C:\Users\tester\Sur3aa test ' + [char]0xE9 + '\node.exe'
    [IO.File]::WriteAllText($toolsPath, (@{node=$expected} | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    if ($EmulateLegacyDefaults) {
        # PS7 can reproduce PS5.1's default for BOM-less files without changing the machine locale.
        function Get-Content {
            param([string]$Path, [switch]$Raw, [string]$Encoding)
            $codec = if ($Encoding -eq 'UTF8') { [Text.Encoding]::UTF8 } else { [Text.Encoding]::GetEncoding(1252) }
            return [IO.File]::ReadAllText($Path, $codec)
        }
    }
    if ((Read-Tools).node -ne $expected) { throw 'Unicode executable path did not round trip through tools.json.' }
    'PASS: Windows tool path JSON preserves Unicode.'
} finally { Remove-Item $testDir -Recurse -Force }
