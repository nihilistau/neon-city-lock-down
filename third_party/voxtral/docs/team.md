# Voxtral TTS — Agent Team Plan

Derived from [tts-tasks.md](tts-tasks.md). 4 teammates, phased execution with
3 phase gates. Each teammate has exclusive file ownership to prevent conflicts.

---

## Teammates

### 1. backbone (5 tasks)

**Tasks:** T-01, T-02, T-03, T-04, T-07

**Responsibility:** TTS config parsing, plain decoder layer mode, backbone weight
loading, voice embedding loading, and autoregressive backbone decoding.

**Exclusive files:**
- `src/tts/config.rs` (create)
- `src/tts/backbone.rs` (create)
- `src/tts/voice.rs` (create)
- `src/tts/mod.rs` (create — module root with all `pub mod` declarations)
- `src/models/layers/decoder_layer.rs` (modify — add plain mode)
- `scripts/convert_voice_embeds.py` (create)

**Execution order:**
1. T-01 (config) — no deps
2. T-02 (plain decoder layer) — no deps, parallel with T-01
3. T-03 (backbone weights) — needs T-01, T-02
4. T-04 (voice loading) — needs T-01
5. T-07 (autoregressive decode) — needs T-03, T-05 from **flow-matching**

**Cross-team dependencies:**
- T-07 needs T-05 (audio codebook embeddings) and T-06 (input sequence) from
  **flow-matching**. Wait for phase gate 2 before starting T-07.

---

### 2. flow-matching (5 tasks)

**Tasks:** T-05, T-06, T-08, T-09, T-10

**Responsibility:** Audio codebook embedding logic, input sequence construction,
flow-matching transformer, time embedding integration, and Euler ODE solver
with CFG.

**Exclusive files:**
- `src/tts/embeddings.rs` (create)
- `src/tts/sequence.rs` (create)
- `src/tts/flow_matching.rs` (create)

**Execution order:**
1. T-09 (time embedding) — no deps, verify existing `TimeEmbedding` reuse
2. T-08 (FM transformer) — needs T-01 from **backbone**
3. T-05 (audio codebook embeddings) — needs T-03 from **backbone**
4. T-06 (input sequence) — needs T-04 from **backbone**, T-05
5. T-10 (Euler ODE + CFG) — needs T-08, T-09

**Cross-team dependencies:**
- T-08 needs T-01 (config) from **backbone**. Wait for phase gate 1.
- T-05 needs T-03 (backbone loads embedding table). Wait for phase gate 1.
- T-06 needs T-04 (voice embeddings) from **backbone**. Wait for phase gate 1.

---

### 3. codec-primitives (7 tasks)

**Tasks:** T-11, T-12, T-13, T-14, T-15, T-16, T-17

**Responsibility:** All codec building blocks — quantization (FSQ + VQ),
ALiBi, QK-norm, LayerScale, causal Conv1d, causal ConvTranspose1d.

**Exclusive files:**
- `src/tts/codec/quantizer.rs` (create)
- `src/tts/codec/alibi.rs` (create)
- `src/tts/codec/qk_norm.rs` (create)
- `src/tts/codec/layer_scale.rs` (create)
- `src/tts/codec/conv.rs` (create)

**Execution order:**
1. T-11 (FSQ) — no deps
2. T-13 (ALiBi) — no deps
3. T-14 (QK-norm) — no deps
4. T-15 (LayerScale) — no deps
5. T-16 (Conv1d) — no deps
6. T-17 (ConvTranspose1d) — needs T-16
7. T-12 (VQ dequant) — needs weight loading patterns from T-03

All of T-11, T-13, T-14, T-15, T-16 are independent — implement in parallel
or any order. These are small, self-contained modules with unit tests.

**Cross-team dependencies:**
- T-12 needs weight loading convention established in T-03 from **backbone**.
  Can start the struct/logic immediately; wire up weight loading after phase
  gate 1.

---

### 4. integration (6 tasks)

**Tasks:** T-18, T-19, T-20, T-21, T-22, T-23

**Responsibility:** Codec decoder layer assembly, full codec decoder, 24 kHz
WAV support, end-to-end pipeline, CLI binary, and code reuse verification.

**Exclusive files:**
- `src/tts/codec/block.rs` (create)
- `src/tts/codec/mod.rs` (create — codec module root + `CodecDecoder` struct)
- `src/audio/io.rs` (modify — add 24 kHz test)
- `src/tts/pipeline.rs` (create)
- `src/bin/speak.rs` (create)
- `Cargo.toml` (modify — add `[[bin]]` entry)

**Execution order:**
1. T-20 (24 kHz WAV) — no deps, start immediately
2. T-18 (codec layer) — needs T-13, T-14, T-15 from **codec-primitives**
3. T-19 (codec assembly) — needs T-11, T-12, T-16, T-17, T-18
4. T-21 (pipeline) — needs T-06, T-07 from **backbone**/**flow-matching**, T-10, T-19
5. T-22 (CLI binary) — needs T-21
6. T-23 (code reuse verification) — needs all tasks complete

**Cross-team dependencies:**
- T-18 needs codec primitives from **codec-primitives** (phase gate 1)
- T-19 needs quantizers + convs from **codec-primitives** (phase gate 2)
- T-21 needs everything from **backbone** and **flow-matching** (phase gate 3)

---

## Phase Gates

### Phase Gate 1: Independent Modules Compile

**Trigger:** All wave-1 tasks complete.

**Teammates report complete:**
- **backbone**: T-01 (config), T-02 (plain decoder)
- **flow-matching**: T-09 (time embedding verified)
- **codec-primitives**: T-11, T-13, T-14, T-15, T-16
- **integration**: T-20 (24 kHz WAV)

**Verification:**
```bash
cargo check --features "wgpu,cli,hub"
cargo test --features "wgpu,cli,hub" -- tts::config codec::alibi codec::qk_norm codec::layer_scale codec::conv codec::quantizer
```

**Unlocks:**
- **backbone**: T-03 (weight loading), T-04 (voice loading)
- **flow-matching**: T-08, T-05, T-06
- **codec-primitives**: T-17, T-12
- **integration**: T-18 (codec layer)

---

### Phase Gate 2: All Components Built

**Trigger:** All wave-2 and wave-3 tasks complete.

**Teammates report complete:**
- **backbone**: T-03, T-04 (all except T-07)
- **flow-matching**: T-05, T-06, T-08, T-10 (all tasks done)
- **codec-primitives**: T-12, T-17 (all tasks done)
- **integration**: T-18, T-19 (codec fully assembled)

**Verification:**
```bash
cargo check --features "wgpu,cli,hub"
cargo test --features "wgpu,cli,hub" -- tts::
```

**Unlocks:**
- **backbone**: T-07 (autoregressive decode — the last backbone task)
- **integration**: T-21 (pipeline — once T-07 completes)

---

### Phase Gate 3: Pipeline Functional

**Trigger:** T-07 and T-21 complete. End-to-end TTS works.

**Teammates report complete:**
- **backbone**: T-07 (all tasks done)
- **integration**: T-21 (pipeline works)

**Verification:**
```bash
cargo test --features "wgpu,cli,hub" -- tts::pipeline
# Manual: generate audio, play it, verify intelligibility
```

**Unlocks:**
- **integration**: T-22 (CLI binary), T-23 (verification)

---

## Coordination Strategy

### Shared State

All teammates read from but do not modify:
- `src/models/layers/` (except `decoder_layer.rs` owned by **backbone**)
- `src/models/weights.rs` — weight loading utilities
- `src/models/time_embedding.rs` — reused by **flow-matching**
- `src/tokenizer/` — shared Tekken tokenizer

### Module Declaration Convention

**backbone** creates `src/tts/mod.rs` with all submodule declarations upfront:
```rust
pub mod config;
pub mod backbone;
pub mod voice;
pub mod embeddings;      // created by flow-matching
pub mod sequence;        // created by flow-matching
pub mod flow_matching;   // created by flow-matching
pub mod codec;           // created by integration
pub mod pipeline;        // created by integration
```

This prevents merge conflicts from concurrent `mod.rs` edits. Each teammate
creates their own files; the module root already expects them.

### Communication Protocol

- After completing each task, update its checkboxes in `docs/tts-tasks.md`
- Before starting a cross-dependency task, verify the dependency teammate has
  completed their prerequisite (check the task file)
- If blocked, document the blocker in the task file and move to the next
  independent task

---

## Task-to-Teammate Assignment Summary

| Teammate | Tasks | File Count | Wave 1 | Wave 2 | Wave 3 | Wave 4+ |
|----------|-------|-----------|--------|--------|--------|---------|
| backbone | T-01, T-02, T-03, T-04, T-07 | 6 | T-01, T-02 | T-03, T-04 | — | T-07 |
| flow-matching | T-05, T-06, T-08, T-09, T-10 | 3 | T-09 | T-05, T-08 | T-06, T-10 | — |
| codec-primitives | T-11, T-12, T-13, T-14, T-15, T-16, T-17 | 5 | T-11, T-13, T-14, T-15, T-16 | T-12, T-17 | — | — |
| integration | T-18, T-19, T-20, T-21, T-22, T-23 | 6 | T-20 | T-18 | T-19 | T-21, T-22, T-23 |

---

## Kickoff Prompt

```
You are implementing TTS (text-to-speech) for the voxtral-mini-realtime-rs
project. Read docs/add-tts-spec.md for the full architecture spec and
docs/tts-tasks.md for the complete task breakdown with acceptance criteria.

You are teammate "{name}" responsible for: {tasks}.

Your exclusive files (only you may create/edit these):
{file_list}

Shared files you may READ but not modify:
- src/models/layers/ (attention.rs, swiglu.rs, rms_norm.rs, rope.rs, kv_cache.rs)
- src/models/weights.rs
- src/models/time_embedding.rs
- src/tokenizer/

Rules:
1. Only edit files in your exclusive list
2. Write unit tests for every new module (TDD — tests first)
3. Follow existing code patterns in src/models/ for consistency
4. Use BF16 weights, convert to F32 at load time per backend (match weights.rs)
5. All new code goes in src/tts/ (or src/tts/codec/ for codec work)
6. After completing each task, mark its checkboxes done in docs/tts-tasks.md

Phase gates control when you start cross-dependency tasks. Do NOT start a task
until its prerequisites (from other teammates) are complete. Check
docs/tts-tasks.md for completion status.

Start with your wave-1 tasks (no dependencies). Work through tasks in the
execution order specified in docs/team.md.
```
