# Frontend-only redeploy: build -> S3 sync -> CloudFront invalidation
# Usage (from repo root or frontend/):
#   .\scripts\deploy-frontend.ps1
# Required env (do not hardcode production URLs in this script):
#   $env:VITE_API_BASE = "https://YOUR_API_ID.execute-api.ap-northeast-1.amazonaws.com/api/v1"
# Optional:
#   $env:AWS_PROFILE = "deploy"
#   $env:VITE_SLACK_CLIENT_ID = "...."
#   $env:FRONTEND_STACK = "wizway-scheduler-frontend"

$ErrorActionPreference = 'Stop'

$Profile = if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { 'deploy' }
$Region = if ($env:AWS_DEFAULT_REGION) { $env:AWS_DEFAULT_REGION } else { 'ap-northeast-1' }
$StackName = if ($env:FRONTEND_STACK) { $env:FRONTEND_STACK } else { 'wizway-scheduler-frontend' }
$ApiBase = $env:VITE_API_BASE
if (-not $ApiBase) {
  throw "Set VITE_API_BASE to your API Gateway URL before deploying (no hardcoded default)."
}

$FrontendDir = Split-Path -Parent $PSScriptRoot
Set-Location $FrontendDir

$env:AWS_PROFILE = $Profile
$env:AWS_DEFAULT_REGION = $Region

Write-Host "Reading stack outputs: $StackName"
$outputs = aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
$bucket = ($outputs | Where-Object { $_.OutputKey -eq 'FrontendBucketName' }).OutputValue
$distId = ($outputs | Where-Object { $_.OutputKey -eq 'CloudFrontDistributionId' }).OutputValue
$frontendUrl = ($outputs | Where-Object { $_.OutputKey -eq 'FrontendUrl' }).OutputValue
if (-not $bucket -or -not $distId -or -not $frontendUrl) {
  throw "Missing FrontendBucketName / CloudFrontDistributionId / FrontendUrl on stack $StackName"
}

$env:VITE_API_BASE = $ApiBase
$env:VITE_USE_API = 'true'
if (-not $env:VITE_SLACK_CLIENT_ID) {
  throw "Set VITE_SLACK_CLIENT_ID before deploying (no hardcoded default)."
}
$env:VITE_SLACK_REDIRECT_URI = "$frontendUrl/auth/slack/callback"

Write-Host "Building with VITE_API_BASE=$ApiBase"
Write-Host "VITE_SLACK_REDIRECT_URI=$($env:VITE_SLACK_REDIRECT_URI)"
npx vite build

Write-Host "Syncing dist/ -> s3://$bucket"
aws s3 sync .\dist "s3://$bucket" --delete --cache-control "public,max-age=31536000,immutable" --exclude "index.html"
aws s3 cp .\dist\index.html "s3://$bucket/index.html" --cache-control "public,max-age=0,must-revalidate" --content-type "text/html"

Write-Host "Invalidating CloudFront $distId"
aws cloudfront create-invalidation --distribution-id $distId --paths '/*' | Out-Null

Write-Host "Done. FrontendUrl=$frontendUrl"
