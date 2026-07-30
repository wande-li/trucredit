# TruCredit DB Backup — daily cron via Railway
# Usage: pwsh scripts/backup-db.ps1
param(
  [string]$DbUrl = $env:DATABASE_URL,
  [string]$BackupDir = "backups",
  [int]$RetainDays = 7
)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BackupDir/trucredit_$timestamp.sql"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# Parse DATABASE_URL: postgresql://user:pass@host:port/dbname
$uri = [Uri]$DbUrl
$env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[1])

& pg_dump `
  -h $uri.Host `
  -p $($uri.Port) `
  -U $($uri.UserInfo.Split(':')[0]) `
  -d $($uri.AbsolutePath.TrimStart('/')) `
  -F p `
  --no-owner `
  --no-acl `
  -f $backupFile

if ($LASTEXITCODE -eq 0) {
  Write-Host "Backup created: $backupFile"
  # Clean old backups
  Get-ChildItem $BackupDir -Filter "trucredit_*.sql" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetainDays) } |
    Remove-Item
} else {
  Write-Error "Backup failed with exit code $LASTEXITCODE"
  exit 1
}
