#Requires -Version 5.1
<#
.SYNOPSIS
  Kirim project POS Konter dari Windows ke server Ubuntu via SCP.
.DESCRIPTION
  1. Edit $Server, $User di bawah.
  2. Jalankan: .\deploy\kirim-ke-ubuntu.ps1
  3. Lanjut di Ubuntu: cd /opt/pos-konter; sudo ./deploy/deploy-ubuntu.sh
#>
param(
  [string]$Server = "IP_SERVER",
  [string]$User = "root",
  [string]$RemotePath = "/opt/pos-konter",
  [int]$SshPort = 22
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if ($Server -eq "IP_SERVER") {
  $input = Read-Host "IP / hostname Ubuntu server (cth 103.147.9.25)"
  if ([string]::IsNullOrWhiteSpace($input)) { Write-Error "IP server wajib diisi."; exit 1 }
  $Server = $input.Trim()
}

Write-Host "==> Project : $ProjectRoot" -ForegroundColor Cyan
Write-Host "==> Tujuan  : ${User}@${Server}:${RemotePath}" -ForegroundColor Cyan

# Pastikan scp ada (bawaan Windows 10+ OpenSSH)
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
  Write-Error "scp tidak ditemukan. Install OpenSSH Client: Settings > Apps > Optional features."
}

# Buat arsip zip bersih (tanpa .git, apk, db lokal, cache)
$TmpZip = Join-Path $env:TEMP ("pos-konter-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")
Write-Host "==> Mengarsipkan ke $TmpZip ..."
$Exclude = @(".git", "__pycache__", "*.pyc", "*.db", "*.sqlite*", ".venv", "venv",
  "android-mirror", "*.apk", ".idea", "node_modules", ".docker")
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $TmpZip) { Remove-Item -LiteralPath $TmpZip -Force }
# Kumpulkan file (sederhana & cepat)
$AllFiles = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File | Where-Object {
  $skip = $false
  foreach ($e in $Exclude) {
    if ($_.FullName -like ("*" + $e.Trim("*") + "*")) { $skip = $true; break }
  }
  -not $skip
}
# Tulis zip dengan path relatif
$Zip = [System.IO.Compression.ZipFile]::Open($TmpZip, "Create")
try {
  foreach ($f in $AllFiles) {
    $rel = $f.FullName.Substring($ProjectRoot.Length).TrimStart('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Zip, $f.FullName, $rel) | Out-Null
  }
} finally { $Zip.Dispose() }
Write-Host "    OK ($(Get-Item $TmpZip | Select-Object -ExpandProperty Length) bytes)" -ForegroundColor Green

Write-Host "==> Upload via SCP (port $SshPort) ..."
& scp -P $SshPort "$TmpZip" "${User}@${Server}:/tmp/pos-konter.zip"
if (-not $?) { throw "SCP gagal. Cek IP/user/SSH server." }

Write-Host "==> Extract di server ke $RemotePath ..."
$RemoteCmd = "sudo mkdir -p $RemotePath && sudo apt-get update -y >/dev/null 2>&1; sudo apt-get install -y unzip >/dev/null 2>&1; sudo unzip -o /tmp/pos-konter.zip -d $RemotePath && sudo chmod +x $RemotePath/deploy/*.sh && echo OK"
& ssh -p $SshPort "${User}@${Server}" $RemoteCmd
if (-not $?) { throw "SSH extract gagal." }

Remove-Item -LiteralPath $TmpZip -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "SELESAI. Lanjut di Ubuntu:" -ForegroundColor Green
Write-Host "  ssh -p $SshPort ${User}@${Server}"
Write-Host "  cd $RemotePath; sudo ./deploy/deploy-ubuntu.sh"
Write-Host "  (atau dengan domain: sudo ./deploy/deploy-ubuntu.sh --domain=pos.domainmu.id --email=admin@domainmu.id)"
