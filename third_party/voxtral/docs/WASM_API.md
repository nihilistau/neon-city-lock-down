# WASM JavaScript API Reference

The browser interface exposes two main classes: `VoxtralClient` for inference and `WaveformRenderer` for visualization.

## VoxtralClient

Main-thread client wrapping WebWorker communication and Web Audio API.

### Constructor

```js
const client = new VoxtralClient();
```

### Methods

#### `async init()`

Initialize WASM module and WebGPU device inside a WebWorker.

```js
await client.init();
// client.ready === true
```

#### `async loadFromServer()`

Download Q4 GGUF shards from the hosting server and load the model.

```js
client.setProgressCallback((stage, percent) => {
    console.log(`${stage}: ${percent}%`);
});
await client.loadFromServer();
// client.modelLoaded === true
```

#### `async loadModel(ggufBytes, tokenizerJson)`

Load model from pre-existing ArrayBuffer (for custom hosting).

- `ggufBytes` — `ArrayBuffer | Uint8Array` of the GGUF file
- `tokenizerJson` — `string` of the tekken.json tokenizer

#### `async transcribeFile(file)`

Transcribe an audio File/Blob. Returns the transcription string.

```js
const text = await client.transcribeFile(audioFile);
```

The decoded audio is also sent to `onAudioChunk` for waveform visualization.

#### `async startMicrophone()`

Begin recording from the microphone. Requires user gesture.

```js
await client.startMicrophone();
```

If `onAudioChunk` is set, real-time audio samples are delivered at ~20fps via an AnalyserNode.

#### `async stopAndTranscribe()`

Stop recording and transcribe the captured audio.

```js
const text = await client.stopAndTranscribe();
```

#### `cancelMicrophone()`

Cancel recording without transcribing.

#### `isReady()`

Returns `true` if both WASM is initialized and model is loaded.

#### `isRecording()`

Returns `true` if currently recording from microphone.

### Callbacks

#### `onProgress`

Set via `setProgressCallback(fn)`. Called with `(stage: string, percent?: number)`.

#### `onAudioChunk`

```js
client.onAudioChunk = (samples: Float32Array) => {
    waveform.pushSamples(samples);
};
```

Called during:
- Microphone recording (~20fps with 2048-sample chunks from AnalyserNode)
- File transcription (entire decoded audio delivered as one chunk)

### Cache Management

#### `async checkCache()`

Returns `{ cached: boolean, shardsCached: number, shardsTotal: number }`.

#### `async clearCache()`

Removes all cached model shards from browser storage.

---

## WaveformRenderer

Canvas-based scrolling waveform for real-time audio visualization.

### Constructor

```js
import { WaveformRenderer } from './waveform.js';

const wf = new WaveformRenderer(canvasElement, {
    durationSecs: 3,     // visible window (default: 3)
    sampleRate: 16000,   // expected sample rate (default: 16000)
    color: '#cf6a4c',    // waveform bar color
    bgColor: '#151515',  // background
    lineColor: '#303030' // center line
});
```

### Methods

#### `start()`

Begin the `requestAnimationFrame` render loop.

#### `stop()`

Pause rendering (does not clear buffer).

#### `clear()`

Reset the buffer and clear the canvas.

#### `pushSamples(samples: Float32Array)`

Push new audio samples into the internal ring buffer. Older samples are overwritten when the buffer (3 seconds) is full.

#### `setColor(color: string)`

Change the waveform color (e.g., switch between mic/file indicators).

#### `destroy()`

Stop rendering and disconnect the ResizeObserver.

### Rendering Behavior

- Uses `requestAnimationFrame` for smooth 60fps updates
- Peak-bucketed downsampling: each pixel column shows the max absolute amplitude of its corresponding audio bucket
- Handles high-DPI displays via `devicePixelRatio` scaling
- Automatically resizes with the canvas container (ResizeObserver)

---

## WebWorker Protocol

The worker (`worker.js`) handles messages:

| Message type | Direction | Purpose |
|-------------|-----------|---------|
| `init` | Main → Worker | Initialize WASM + WebGPU |
| `ready` | Worker → Main | Initialization complete |
| `loadFromServer` | Main → Worker | Download and load model shards |
| `progress` | Worker → Main | Loading progress updates |
| `loaded` | Worker → Main | Model loaded successfully |
| `transcribe` | Main → Worker | Run inference on Float32Array audio |
| `result` | Worker → Main | Transcription text result |
| `error` | Worker → Main | Error message |

### Shard Loading Flow

1. Worker fetches `/api/shards` to get shard list
2. Downloads each shard sequentially (to avoid WASM OOM)
3. Calls `appendModelShard(bytes)` for each shard
4. Calls `loadModelFromShards()` to finalize (drops reader, builds model)
5. Reports `loaded` to main thread

---

## Integration Example

```html
<canvas id="waveform" style="width:100%; height:80px;"></canvas>
<script type="module">
import { VoxtralClient } from './voxtral-client.js';
import { WaveformRenderer } from './waveform.js';

const client = new VoxtralClient();
const wf = new WaveformRenderer(document.getElementById('waveform'));
wf.start();

client.onAudioChunk = (samples) => wf.pushSamples(samples);

await client.init();
await client.loadFromServer();

// Mic recording with live waveform
wf.setColor('#cf6a4c');
await client.startMicrophone();
// ... user speaks ...
const text = await client.stopAndTranscribe();
console.log(text);
</script>
```
