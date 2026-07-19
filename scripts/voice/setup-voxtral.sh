#!/usr/bin/env bash
# Set up the vendored Voxtral TTS engine under third_party/voxtral/ (binary +
# models, both gitignored). Copy from an existing build, or build + download.
#   scripts/voice/setup-voxtral.sh                    # build + download
#   scripts/voice/setup-voxtral.sh /path/to/voxtral-mini-realtime-rs   # copy existing
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/third_party/voxtral"
FROM="${1:-}"
mkdir -p "$DEST/target/release" "$DEST/models"

if [[ -n "$FROM" && -d "$FROM" ]]; then
  echo "Copying binary + models from $FROM ..."
  bin="$FROM/target/release/voxtral"; [[ -f "$FROM/target/release/voxtral.exe" ]] && bin="$FROM/target/release/voxtral.exe"
  if [[ -f "$bin" ]]; then cp "$bin" "$DEST/target/release/"; echo "  binary copied"; else echo "  WARN: no built binary in $FROM"; fi
  if [[ -d "$FROM/models" ]]; then cp -r "$FROM/models/." "$DEST/models/"; echo "  models copied (~2.7GB)"; else echo "  WARN: no models in $FROM"; fi
else
  echo "Building voxtral (release, wgpu+cli+hub) — slow (LTO)..."
  ( cd "$DEST" && cargo build --release --features "wgpu,cli,hub" )
  echo "Fetching Q4 model + tokenizer + voice embeddings (huggingface-cli)..."
  echo "  (requires: pip install huggingface_hub)"
  huggingface-cli download TrevorJS/voxtral-tts-q4-gguf --local-dir "$DEST/models" || \
    echo "  If this 404s, see third_party/voxtral/README.md for the exact model repo + voice-embedding paths."
fi

bin="$DEST/target/release/voxtral"; [[ -f "$DEST/target/release/voxtral.exe" ]] && bin="$DEST/target/release/voxtral.exe"
echo
[[ -f "$bin" ]] && echo "voxtral binary: OK ($bin)" || echo "voxtral binary: MISSING"
echo "Start the voice server with:  node tools/sidecar.mjs"
