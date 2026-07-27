# ============================================================
# pre-deploy.ps1 — 部署前强制质量门控（v1.0, 2026-07-27）
# 教训 B16: 推送前必须 tsc + eslint 双零，禁止带错入库
# ============================================================
param(
    [switch]$Strict = $true
)

$ErrorActionPreference = "Continue"
$exitCode = 0

Push-Location $PSScriptRoot\..

Write-Host "`n=== Pre-Deploy Check ===" -ForegroundColor Cyan

# ---------------------------
# B15: .eslintignore 存在性
# ---------------------------
Write-Host "`n[1/4] Checking .eslintignore..." -ForegroundColor Yellow
if (-not (Test-Path ".eslintignore")) {
    Write-Host "  FAIL: .eslintignore is missing" -ForegroundColor Red
    $exitCode = 1
} else {
    $content = Get-Content ".eslintignore" -Raw
    $required = @("node_modules", "build")
    $missing = $required | Where-Object { $content -notmatch $_ }
    if ($missing) {
        Write-Host "  WARN: .eslintignore missing entries: $($missing -join ', ')" -ForegroundColor Yellow
    } else {
        Write-Host "  PASS" -ForegroundColor Green
    }
}

# ---------------------------
# B16: TypeScript 零错误
# ---------------------------
Write-Host "`n[2/4] TypeScript typecheck..." -ForegroundColor Yellow
$tscOutput = cmd /c "npx tsc --noEmit 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAIL: tsc --noEmit has errors" -ForegroundColor Red
    ($tscOutput -split "`r?`n" | Select-Object -First 20) | ForEach-Object { Write-Host "  $_" }
    $exitCode = 1
} else {
    Write-Host "  PASS: 0 errors" -ForegroundColor Green
}

# ---------------------------
# B16: ESLint 零错误零警告
# ---------------------------
Write-Host "`n[3/4] ESLint source check..." -ForegroundColor Yellow
$lintOutput = cmd /c "npx eslint app/ e2e/ --max-warnings 0 2>&1"
$lintExit = $LASTEXITCODE
if ($lintExit -ne 0) {
    Write-Host "  FAIL: ESLint has errors/warnings" -ForegroundColor Red
    ($lintOutput -split "`r?`n" | Where-Object { $_ -match "error|warning|problem" } | Select-Object -First 15) | ForEach-Object { Write-Host "  $_" }
    $exitCode = 1
} else {
    Write-Host "  PASS: 0 errors, 0 warnings" -ForegroundColor Green
}

# ---------------------------
# B9: 0-byte 空文件扫描
# ---------------------------
Write-Host "`n[4/4] 0-byte file scan (B9)..." -ForegroundColor Yellow
$emptyFiles = Get-ChildItem -Path app -Recurse -Include *.ts,*.tsx | Where-Object { $_.Length -eq 0 }
if ($emptyFiles) {
    Write-Host "  FAIL: Found 0-byte files:" -ForegroundColor Red
    $emptyFiles | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    $exitCode = 1
} else {
    Write-Host "  PASS: 0 empty files" -ForegroundColor Green
}

# ---------------------------
# 结果
# ---------------------------
Pop-Location

Write-Host "`n========================================" -ForegroundColor Cyan
if ($exitCode -eq 0) {
    Write-Host "  ALL CHECKS PASSED — safe to deploy" -ForegroundColor Green
} else {
    Write-Host "  $exitCode check(s) FAILED — fix before deploying" -ForegroundColor Red
}
Write-Host "========================================`n" -ForegroundColor Cyan

exit $exitCode
