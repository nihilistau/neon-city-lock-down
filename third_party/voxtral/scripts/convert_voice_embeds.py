#!/usr/bin/env python3
"""Convert voice embedding .pt files to SafeTensors format.

Usage:
    python scripts/convert_voice_embeds.py models/voxtral-tts/voice_embedding/

Reads all .pt files in the given directory and writes corresponding .safetensors
files with the same name. Each output file contains a single tensor named
"embedding" with shape [N, 3072] in BF16.

Requires: torch, safetensors
    pip install torch safetensors
"""

import argparse
import sys
from pathlib import Path

import torch
from safetensors.torch import save_file


def convert_pt_to_safetensors(pt_path: Path) -> tuple[Path, list[int]]:
    """Convert a single .pt voice embedding to SafeTensors.

    Args:
        pt_path: Path to the .pt file.

    Returns:
        Tuple of (output path, tensor shape).
    """
    data = torch.load(pt_path, map_location="cpu", weights_only=True)

    # Handle different .pt formats:
    # - Raw tensor: just the embedding
    # - Dict with a single key: extract the tensor
    if isinstance(data, dict):
        if len(data) == 1:
            tensor = next(iter(data.values()))
        elif "embedding" in data:
            tensor = data["embedding"]
        else:
            keys = list(data.keys())
            raise ValueError(
                f"Unexpected dict keys in {pt_path}: {keys}. "
                f"Expected a single key or 'embedding'."
            )
    elif isinstance(data, torch.Tensor):
        tensor = data
    else:
        raise ValueError(
            f"Unexpected type in {pt_path}: {type(data)}. "
            f"Expected tensor or dict."
        )

    if tensor.ndim != 2:
        raise ValueError(
            f"Expected 2D tensor [N, dim] in {pt_path}, got shape {list(tensor.shape)}"
        )

    # Keep as BF16 if already BF16, otherwise convert
    if tensor.dtype != torch.bfloat16:
        tensor = tensor.to(torch.bfloat16)

    shape = list(tensor.shape)
    out_path = pt_path.with_suffix(".safetensors")
    save_file({"embedding": tensor}, str(out_path))
    return out_path, shape


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert voice embedding .pt files to SafeTensors"
    )
    parser.add_argument(
        "directory",
        type=Path,
        help="Directory containing .pt voice embedding files",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing .safetensors files",
    )
    args = parser.parse_args()

    voice_dir: Path = args.directory
    if not voice_dir.is_dir():
        print(f"Error: {voice_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    pt_files = sorted(voice_dir.glob("*.pt"))
    if not pt_files:
        print(f"No .pt files found in {voice_dir}", file=sys.stderr)
        sys.exit(1)

    converted = 0
    skipped = 0
    for pt_path in pt_files:
        out_path = pt_path.with_suffix(".safetensors")
        if out_path.exists() and not args.force:
            print(f"  skip {pt_path.name} (already converted)")
            skipped += 1
            continue

        try:
            result_path, shape = convert_pt_to_safetensors(pt_path)
            print(f"  done {pt_path.name} -> {result_path.name} {shape}")
            converted += 1
        except Exception as e:
            print(f"  FAIL {pt_path.name}: {e}", file=sys.stderr)

    print(f"\nConverted: {converted}, Skipped: {skipped}, Total: {len(pt_files)}")


if __name__ == "__main__":
    main()
