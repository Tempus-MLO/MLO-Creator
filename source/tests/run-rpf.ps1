param([Parameter(Mandatory=$true)][string]$Gta, [string]$WorkDir=(Join-Path $env:TEMP ('MloRpfPilot_'+[Guid]::NewGuid().ToString('N'))))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
& (Join-Path $root 'build.ps1')
$bin=Join-Path $WorkDir 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Path "$root\lib\*" -Destination $bin -Recurse -Force
Copy-Item -LiteralPath "$root\MloCreator.exe" -Destination $bin -Force
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fw=Split-Path $compiler
& $compiler /nologo /target:exe /platform:x64 "/r:$fw\netstandard.dll" "/r:$fw\System.Runtime.dll" "/r:$root\MloCreator.exe" "/r:$root\lib\CodeWalker.Core.dll" /r:System.Web.Extensions.dll "/out:$bin\RpfCatalogueTest.exe" "$PSScriptRoot\RpfCatalogueTest.cs"
if($LASTEXITCODE -ne 0){throw 'RPF test harness compilation failed'}
& "$bin\RpfCatalogueTest.exe" $Gta (Join-Path $WorkDir 'index')
if($LASTEXITCODE -ne 0){throw 'RPF pilot failed'}
Write-Output "RPF pilot passed; metadata and own test geometry retained in $WorkDir"
