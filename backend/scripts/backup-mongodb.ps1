# Stockyard MongoDB backup -> Desktop\MongoDB Backup\<timestamp>
$ErrorActionPreference = "Stop"

$BackendRoot = Split-Path $PSScriptRoot -Parent
$EnvFile = Join-Path $BackendRoot ".env"
if (-not (Test-Path $EnvFile)) {
  throw "backend .env not found at: $EnvFile"
}

$MongoUri = $null
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*MONGODB_URI\s*=\s*(.+)\s*$') {
    $MongoUri = $Matches[1].Trim().Trim('"').Trim("'")
  }
}
if (-not $MongoUri) {
  throw "MONGODB_URI missing in backend .env"
}

$DumpExe = $null
$candidates = @(
  "C:\Program Files\MongoDB\Tools\100\bin\mongodump.exe",
  "C:\Program Files\MongoDB\Tools\100\bin\mongodump.exe".Replace("100", "101"),
  "mongodump"
)
foreach ($c in $candidates) {
  if ($c -eq "mongodump") {
    $cmd = Get-Command mongodump -ErrorAction SilentlyContinue
    if ($cmd) { $DumpExe = $cmd.Source; break }
  } elseif (Test-Path $c) {
    $DumpExe = $c
    break
  }
}
# Prefer known install path if present
if (Test-Path "C:\Program Files\MongoDB\Tools\100\bin\mongodump.exe") {
  $DumpExe = "C:\Program Files\MongoDB\Tools\100\bin\mongodump.exe"
}
if (-not $DumpExe) {
  throw "mongodump.exe not found. Install MongoDB Database Tools and retry."
}

$BackupRoot = "C:\Users\profile\OneDrive - Profile Data Center Solutions Pvt. Ltd\Desktop\MongoDB Backup\Store Management System"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$Stamp = Get-Date -Format "dd-MM-yyyy_HH-mm-ss"
$OutDir = Join-Path $BackupRoot $Stamp
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Using: $DumpExe"
Write-Host "Backup folder: $OutDir"
Write-Host "Starting mongodump..."

& $DumpExe --uri=$MongoUri --out=$OutDir
if ($LASTEXITCODE -ne 0) {
  throw "mongodump failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Backup completed successfully."
Write-Host "Saved to: $OutDir"
Get-ChildItem $OutDir -Recurse -File | Select-Object FullName, Length | Format-Table -AutoSize
