# Hyperspace Jam — Session Handoff (2026-03-22, updated end of session)

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

## What's Next — PHASE 3: Dynamic Geometric Shapes + Internal Tessellation

See `.claude/vision-reference.md` for the full interaction spec (from Instagram reel analysis).

### IMMEDIATE: Make existing effects more dramatic
- Texture breathing is too subtle (5% scale) — increase to 15-20%
- Pinch threshold (40px) may be too tight — try 60px
- Mandala colors need more contrast/glow
- Displacement filter needs bigger amplitude values
- Background Poincaré shader at 0.45 alpha may be washing out — try making it more vivid
- Per-finger expression controls (delay/reverb/speed) need user-visible labels

### Priority 1: Pinch Detection + Dynamic Shape State
- Detect pinch gesture (thumb tip + index tip distance < threshold)
- Merge pinched fingers into single anchor point
- Track active anchor count → determine shape state (line/triangle/quad)
- Smooth transitions between states

### Priority 2: Internal Poincaré Tessellation Inside Shapes
- When a closed shape forms, fill its interior with a Poincaré disk shader
- Use a second ShaderMaterial on a dynamic mesh that conforms to the shape
- Central focal point, tessellation gets denser toward edges
- Re-tessellate in real-time as shape morphs

### Priority 3: DMT-Chrome Iridescent Coloring
- Shifting iridescent colors flowing along curved geometry
- Pulsation rhythm synced to audio beat
- Color intensity increases with finger spread

### Priority 4: Z-Depth Rendering
- Line thickness scales with hand Z-position (landmark.z or hand size proxy)
- Node size scales similarly
- Creates convincing 3D perspective effect

### Priority 5: Audio-Geometry Feedback
- Shape proximity to camera → distortion/low-pass filter on master bus
- Shape area/complexity → additional audio parameters
- Pulsation sync with Transport beat

### Also remaining:
- Attract mode logic (30s timer)
- Scale toggle button wiring
- Per-finger controls are implemented but need testing post-bug-fix

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
