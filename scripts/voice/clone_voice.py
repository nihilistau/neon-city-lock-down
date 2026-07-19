#!/usr/bin/env python3
"""Voice cloning add-on for the Neon-City voice server.

Turns a reference into a Voxtral voice embedding (`<name>.safetensors`, a single
tensor "embedding" of shape [N, 3072] BF16) that `voxtral speak --voice <name>`
can use. Two input modes:

  --from-pt <file.pt>   wrap an existing .pt voice embedding (fully supported)
  --ref <audio>         extract an embedding from a reference CLIP  (needs the
                        Voxtral speech encoder — see ENCODER note below)

Usage (invoked by tools/sidecar.mjs /clone, or by hand):
  python scripts/voice/clone_voice.py --ref shannon.wav --name shannon --out-dir user/voices
  python scripts/voice/clone_voice.py --from-pt voice.pt --name shannon --out-dir user/voices

Requires: torch, safetensors  (and, for --ref, soundfile + the Voxtral encoder)
  pip install -r scripts/voice/requirements.txt

The vendored fork's scripts/convert_voice_embeds.py does the .pt -> .safetensors
step; this wraps it and adds the reference-clip path. Clip -> embedding is the
one piece Voxtral does NOT expose in the CLI, so it lives here as an add-on.
"""
import argparse
import sys
from pathlib import Path


def save_embedding(tensor, out_path: Path):
    """Save a [N, 3072] tensor as SafeTensors with the key 'embedding' (BF16)."""
    import torch
    from safetensors.torch import save_file
    if tensor.dim() != 2 or tensor.shape[1] != 3072:
        raise SystemExit(f"expected [N, 3072], got {tuple(tensor.shape)}")
    save_file({"embedding": tensor.to(torch.bfloat16).contiguous()}, str(out_path))
    print(f"wrote {out_path}  shape={tuple(tensor.shape)}")


def from_pt(pt_path: Path):
    import torch
    data = torch.load(pt_path, map_location="cpu", weights_only=True)
    if isinstance(data, dict):
        data = data.get("embedding", next(iter(data.values())))
    return data


def from_reference(ref_path: Path):
    """Encode a reference clip into a [N, 3072] voice embedding.

    ENCODER: this requires running the clip through the Voxtral speech encoder +
    the TTS voice-conditioning projection. That model code is not exposed by the
    `voxtral speak` CLI, so wire it here using mistral-common / the vendored
    fork's reference pipeline (see third_party/voxtral/scripts/reference_*.py and
    docs/systems/voice.md). Until wired, this raises a clear error and the voice
    server falls back to drop-in .safetensors embeddings.
    """
    try:
        import soundfile  # noqa: F401  (validates the audio dep is present)
    except ImportError:
        raise SystemExit("clip cloning needs `soundfile` (pip install -r scripts/voice/requirements.txt)")
    raise SystemExit(
        "clip -> embedding extraction is not wired in this build.\n"
        "  Options: (1) supply a pre-computed embedding with --from-pt, or drop a\n"
        "  <name>.safetensors ([N,3072] BF16) into the voices dir; (2) implement the\n"
        "  Voxtral encoder call in from_reference() — see docs/systems/voice.md."
    )


def main():
    ap = argparse.ArgumentParser(description="Create a Voxtral voice embedding")
    ap.add_argument("--ref", help="reference audio clip (wav/mp3/m4a)")
    ap.add_argument("--from-pt", dest="from_pt", help="existing .pt voice embedding")
    ap.add_argument("--name", required=True, help="voice name (embedding file stem)")
    ap.add_argument("--out-dir", required=True, help="directory to write <name>.safetensors")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.name}.safetensors"

    if args.from_pt:
        tensor = from_pt(Path(args.from_pt))
    elif args.ref:
        tensor = from_reference(Path(args.ref))
    else:
        ap.error("provide --ref or --from-pt")

    save_embedding(tensor, out_path)


if __name__ == "__main__":
    sys.exit(main())
