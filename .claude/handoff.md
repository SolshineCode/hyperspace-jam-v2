# Hyperspace Jam — Session Handoff (2026-03-22 final)

## Current State
- **HF Space**: https://huggingface.co/spaces/Solshine/hyperspace-jam
- **Direct URL**: https://solshine-hyperspace-jam.static.hf.space/index.html
- **GitHub**: https://github.com/SolshineCode/hyperspace-jam-v2
- **Working dir**: C:\Users\caleb\hyperspace-jam-v2
- **Deploy dir**: C:\Users\caleb\hyperspace-jam-v2-clean (copy files here, then HfApi.upload_folder)

## Deploy Command
```bash
cd /c/Users/caleb/hyperspace-jam-v2-clean
cp /c/Users/caleb/hyperspace-jam-v2/*.js /c/Users/caleb/hyperspace-jam-v2/*.html /c/Users/caleb/hyperspace-jam-v2/*.css .
python -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='Solshine/hyperspace-jam', repo_type='space', ignore_patterns=['.git*'])"
```

## What Works
- Webcam + MediaPipe hand tracking (2 hands)
- EDM synth engine (3 presets: Pluck, Acid Bass, Pad) at 128 BPM
- Drum patterns on hand 2
- Hand skeleton visualization (lines + circles)
- Mandala geometry (pentagram, rays, rings)
- Psychedelic hue-rotating webcam filter
- Per-finger expression controls (delay, reverb, speed, timbre)
- Displacement filter (ON by default, toggle 'D')
- Background Poincaré shader (semi-transparent, audio-reactive)

## CRITICAL: What Needs Fixing Next Session

### 1. ShapeManager Rewrite (current implementation is wrong)
The current ShapeManager ONLY creates anchors from pinch gestures. The reference video shows:
- **Each fingertip (thumb, index, middle) is an INDEPENDENT anchor**
- **Pinch = two fingertips merge into ONE anchor** (thumb+index touching = 1 anchor instead of 2)
- **Un-pinched fingers are still separate anchors**
- **Single hand can create triangle** (spread thumb + index + middle = 3 anchors = triangle)
- **Two-hand pinch = 2 anchors = line** (left pinch + right pinch)
- **Two-hand spread = 4 anchors = quad** (left thumb + left index + right thumb + right index)

Current logic: only creates anchors from pinch detection → wrong.
New logic:
```
for each hand:
  if thumb+index pinching: 1 anchor (midpoint)
  else: thumb tip = anchor, index tip = anchor
  if middle finger extended and spread: middle tip = anchor too
```

### 2. Shapes Need to be MUCH More Visible
- Line thickness: currently standard THREE.Line (1px) → needs 3-5px equivalent (use tube/mesh)
- Node size: 6-8px rings → needs 15-20px
- Color: pure white, high contrast
- Z-depth scaling needs to be dramatic (2x-4x size change, not subtle 0.6-2.5x)

### 3. Audio Needs to Sound More Polished/Profound
Current audio issues:
- Synth presets sound thin/basic
- Effects chain is functional but not lush enough
- No audio-shape interaction (proximity filter not implemented yet)

Needed:
- Richer FM synthesis parameters
- Layer multiple voices for thickness
- Proximity-to-camera → lowpass filter sweep + distortion (from vision spec)
- Shape area → delay feedback amount
- More musical note transitions (glide/portamento)

### 4. Internal Tessellation
ShapeTessellationShader.js exists but depends on ShapeManager providing correct anchor data. Fix ShapeManager first, then the tessellation should work.

### 5. Multiplayer (Phase 3.6)
Not yet implemented. Plan in `.claude/plans/cozy-wiggling-acorn.md`

## Key Files
| File | Lines | Purpose |
|------|-------|---------|
| game.js | ~1460 | Main orchestrator (TRANSPILED, surgical edits only) |
| ShapeManager.js | ~320 | Pinch shapes — NEEDS REWRITE per above |
| ShapeTessellationShader.js | ~150 | Internal Poincaré shader for shapes |
| DisplacementFilter.js | ~55 | Trippy CSS displacement (ON by default) |
| WaveformVisualizer.js | ~200 | Background Poincaré shader + breathing |
| MandalaVisualizer.js | ~175 | Sacred geometry between fingers |
| MusicManager.js | ~220 | Tone.js EDM synth engine |
| DrumManager.js | ~250 | Drum sequencer (transpiled) |
| index.html | ~55 | Page shell |
| styles.css | ~90 | Dark kiosk styling |

## Reference Docs
- `.claude/vision-reference.md` — Full interaction spec from Instagram reel analysis
- `.claude/plans/cozy-wiggling-acorn.md` — Phase 3 implementation plan

## HF Auth
- Logged in via `huggingface-cli login` with token `ForClaudeCode`
- Binary assets need Xet storage (HfApi handles automatically)
