# Hyperspace Jam — Session Handoff (2026-03-22)

## What Was Accomplished

### Phase 1: React+Vite Approach (abandoned)
- Built full React+R3F+Tone.js app with 5 agents
- Webcam never worked in HF Spaces iframe due to bundling issues
- Code is in `C:\Users\caleb\hyperspace-jam` (GitHub PR #1 on SolshineCode/hyperspace-jam)

### Phase 2: Fork arpeggiator-test (current working approach)
- Forked gaganyatri/arpeggiator-test as base (vanilla JS, ESM imports from CDN)
- Webcam + hand tracking + audio all work in HF Spaces iframe
- Working directory: `C:\Users\caleb\hyperspace-jam-v2`
- Deploy directory: `C:\Users\caleb\hyperspace-jam-v2-clean` (used for HF uploads)
- HF Space: https://huggingface.co/spaces/Solshine/hyperspace-jam
- Direct URL: https://solshine-hyperspace-jam.static.hf.space/index.html

### Transformations Applied
1. **WaveformVisualizer.js** → Poincaré {7,3} hyperbolic tessellation shader (semi-transparent, audio-reactive)
2. **MusicManager.js** → 3 EDM presets (Hyperspace Pluck, Acid Bass, Ethereal Pad), 128 BPM, FeedbackDelay + Reverb
3. **index.html + styles.css** → Dark kiosk UI, "STEP UP TO JAM", attract mode overlay, scale toggle
4. **MandalaVisualizer.js** → NEW: Sacred geometry between fingers (pentagram, rays, rings, inter-hand bridges)
5. **game.js** → Modified: psychedelic hue-rotating webcam filter, MandalaVisualizer integration, screen blend mode

### Deploy Method
```python
from huggingface_hub import HfApi
api = HfApi()
api.upload_folder(folder_path='.', repo_id='Solshine/hyperspace-jam', repo_type='space', ignore_patterns=['.git*'])
```
(Must run from the hyperspace-jam-v2-clean directory, which has the actual files without LFS)

## What's Next
- Test current deploy, fix any JS errors
- More diverse controls: each finger mapped to different parameters
- Geometry-to-music feedback: mandala shape properties (area, symmetry) influence audio
- Attract mode logic (30s timer, sine-wave shader animation when idle)
- Scale toggle button wiring (PENTATONIC/MIXOLYDIAN)
- GitHub repo for the v2 code (currently only on HF Spaces)

## Key Files
| File | Purpose |
|------|---------|
| game.js | Main orchestrator (67KB transpiled, surgical edits only) |
| WaveformVisualizer.js | Poincaré shader background |
| MusicManager.js | EDM synth engine |
| DrumManager.js | 909 drum patterns (unchanged from arpeggiator) |
| MandalaVisualizer.js | Sacred geometry finger visualizations |
| index.html | Page shell + UI elements |
| styles.css | Dark kiosk styling |
| main.js | Entry point (5 lines, unchanged) |

## HF Credentials
- Logged in via `huggingface-cli login` with token `ForClaudeCode`
- HF username: Solshine
- Binary assets require Xet storage (handled by HfApi.upload_folder)
