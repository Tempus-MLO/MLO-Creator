# Makes the folder you can copy to another PC (or keep as the installed program) and zips it: the program, its libraries, the editor files and the models that come with it.
# Nothing personal goes in: no projects, no settings, no cache, no exports. Build first (build.ps1). The WebView2 runtime is part of Windows 11 and of Edge.
param([string]$Exe = 'MloCreator.exe', [string]$Dest = '', [switch]$NoZip)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dest) { $Dest = Join-Path $here 'dist\MLO Creator' }
$src = Join-Path $here $Exe
if (-not (Test-Path -LiteralPath $src)) { throw "$src not found: run build.ps1 first." }
if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -LiteralPath $src -Destination (Join-Path $Dest 'MloCreator.exe')
Copy-Item -LiteralPath "$here\MloCreator.exe.config" -Destination (Join-Path $Dest 'MloCreator.exe.config')
Copy-Item -LiteralPath "$here\lib" -Destination (Join-Path $Dest 'lib') -Recurse
Copy-Item -LiteralPath "$here\ui" -Destination (Join-Path $Dest 'ui') -Recurse
Copy-Item -LiteralPath "$here\runtime" -Destination (Join-Path $Dest 'runtime') -Recurse
Copy-Item -LiteralPath "$here\models" -Destination (Join-Path $Dest 'models') -Recurse
Copy-Item -LiteralPath "$here\docs" -Destination (Join-Path $Dest 'docs') -Recurse
Copy-Item -LiteralPath "$here\README.md" -Destination (Join-Path $Dest 'README.md')
Copy-Item -LiteralPath "$here\THIRD-PARTY-NOTICES.md" -Destination (Join-Path $Dest 'THIRD-PARTY-NOTICES.md')
Copy-Item -LiteralPath "$here\LICENSE" -Destination (Join-Path $Dest 'LICENSE')
New-Item -ItemType Directory -Force -Path (Join-Path $Dest 'projects') | Out-Null
$files = Get-ChildItem -LiteralPath $Dest -Recurse -File; $mb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
"packaged $($files.Count) files, $mb MB -> $Dest"
if (-not $NoZip) {
    $zip = "$Dest.zip"; if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -Confirm:$false }
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    # entries with forward slashes (CreateFromDirectory of .NET Framework writes backslashes, which other unzip tools get wrong); the folder name leads every path
    $top = Split-Path -Leaf $Dest; $za = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in (Get-ChildItem -LiteralPath $Dest -Recurse -File)) { $rel = $f.FullName.Substring($Dest.Length).TrimStart('\') -replace '\\', '/'; [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, $f.FullName, "$top/$rel", [IO.Compression.CompressionLevel]::Optimal) }
        [void]$za.CreateEntry("$top/projects/")
    } finally { $za.Dispose() }
    "zip: $zip ($([math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)) MB)"
}
