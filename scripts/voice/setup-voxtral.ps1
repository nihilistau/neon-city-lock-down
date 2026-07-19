# Set up the vendored Voxtral TTS engine: put a working binary + model weights
# under third_party/voxtral/ (both gitignored). Two modes:
#   -From <dir>   copy an existing build (binary + models) from another checkout
#   (default)     cargo build the binary, then fetch the models via huggingface-cli
#
# Usage:
#   pwsh scripts/voice/setup-voxtral.ps1                 # build + download
#   pwsh scripts/voice/setup-voxtral.ps1 -From 'D:\path\to\voxtral-mini-realtime-rs'
param([string]$From = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dest = Join-Path $root "third_party\voxtral"
New-Item -ItemType Directory -Force -Path (Join-Path $dest "target\release"), (Join-Path $dest "models") | Out-Null

if ($From -and (Test-Path $From)) {
  Write-Host "Copying binary + models from $From ..."
  $srcBin = Join-Path $From "target\release\voxtral.exe"
  if (Test-Path $srcBin) { Copy-Item $srcBin (Join-Path $dest "target\release\voxtral.exe") -Force; Write-Host "  binary copied" }
  else { Write-Warning "  no built binary at $srcBin" }
  $srcModels = Join-Path $From "models"
  if (Test-Path $srcModels) { Copy-Item (Join-Path $srcModels "*") (Join-Path $dest "models") -Recurse -Force; Write-Host "  models copied (~2.7GB)" }
  else { Write-Warning "  no models at $srcModels" }
}
else {
  Write-Host "Building voxtral (release, wgpu+cli+hub) — this is slow (LTO)..."
  Push-Location $dest
  cargo build --release --features "wgpu,cli,hub"
  Pop-Location
  Write-Host "Fetching Q4 model + tokenizer + voice embeddings via huggingface-cli..."
  Write-Host "  (requires: pip install huggingface_hub ; then re-run, or download manually)"
  huggingface-cli download TrevorJS/voxtral-tts-q4-gguf --local-dir (Join-Path $dest "models") 2>$null
  Write-Host "  If the download 404s, see third_party/voxtral/README.md / CLAUDE.md for the exact model repo + voice-embedding paths."
}

$bin = Join-Path $dest "target\release\voxtral.exe"
Write-Host ""
Write-Host ("voxtral binary: " + $(if (Test-Path $bin) { "OK ($bin)" } else { "MISSING" }))
Write-Host "Start the voice server with:  node tools/sidecar.mjs"
