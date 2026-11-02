param([string]$WorkDir = (Join-Path $env:TEMP ('MloDoorTests_' + [Guid]::NewGuid().ToString('N'))), [string]$Ydr = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& (Join-Path $root 'build.ps1')
$bin = Join-Path $WorkDir 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Path "$root\lib\*" -Destination $bin -Recurse -Force
Copy-Item -LiteralPath "$root\MloCreator.exe" -Destination $bin -Force
Copy-Item -LiteralPath "$root\runtime" -Destination $bin -Recurse -Force
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fw = Split-Path $csc
& $csc /nologo /target:exe /platform:x64 "/r:$fw\netstandard.dll" "/r:$fw\System.Runtime.dll" "/r:$root\MloCreator.exe" "/r:$root\lib\CodeWalker.Core.dll" /r:System.Web.Extensions.dll "/out:$bin\ExportDoors.exe" "$PSScriptRoot\ExportDoors.cs"
if ($LASTEXITCODE -ne 0) { throw 'Test harness compilation failed' }
$testArgs = @($root, (Join-Path $WorkDir 'export'))
if ($Ydr) { $testArgs += $Ydr }
& "$bin\ExportDoors.exe" @testArgs
if ($LASTEXITCODE -ne 0) { throw 'Export regression failed' }
Push-Location $root
try {
    & node --check ui/js/fitmodels.js
    if ($LASTEXITCODE -ne 0) { throw 'Editor syntax check failed' }
    & node --check ui/js/importmodel.js
    if ($LASTEXITCODE -ne 0) { throw 'Import syntax check failed' }
    & node tests/fitmodels_spec.js
    if ($LASTEXITCODE -ne 0) { throw 'Editor regression failed' }
    & node tests/ground_snap_spec.js
    if ($LASTEXITCODE -ne 0) { throw 'Prop ground snapping regression failed' }
    & node tests/catalogue_browse_spec.js
    if ($LASTEXITCODE -ne 0) { throw 'Catalogue paging/search regression failed' }
    # Requires Python with lupa; alternatively run `lua tests/doors_spec.lua`.
    & python -c "from lupa.lua54 import LuaRuntime; LuaRuntime().execute(open('tests/doors_spec.lua', encoding='utf-8').read())"
    if ($LASTEXITCODE -ne 0) { throw 'Lua regression failed (install lupa or use Lua 5.4)' }
    & python -c "from lupa.lua54 import LuaRuntime; LuaRuntime().execute(open('tests/auto_doors_spec.lua', encoding='utf-8').read())"
    if ($LASTEXITCODE -ne 0) { throw 'Auto-open / lock regression failed' }
} finally { Pop-Location }
Write-Output "Tests passed; generated fixtures retained in $WorkDir"
