# Hyperspace Jam — Session Handoff (2026-03-22 final-final)

## STATUS: Working but crashes after extended use

The app loads, tracks hands, plays gesture-driven music, shows psychedelic effects. But it crashes after a few minutes of use — likely memory leak from per-frame geometry creation/disposal.

## Links
- **HF Space**: https://huggingface.co/spaces/Solshine/hyperspace-jam
- **Direct URL**: https://solshine-hyperspace-jam.static.hf.space/index.html
- **GitHub**: https://github.com/SolshineCode/hyperspace-jam-v2
- **Working dir**: C:\Users\caleb\hyperspace-jam-v2
- **Deploy dir**: C:\Users\caleb\hyperspace-jam-v2-clean

## Deploy Command
```bash
cd /c/Users/caleb/hyperspace-jam-v2-clean
cp /c/Users/caleb/hyperspace-jam-v2/*.js /c/Users/caleb/hyperspace-jam-v2/*.html /c/Users/caleb/hyperspace-jam-v2/*.css .
python -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='Solshine/hyperspace-jam', repo_type='space', ignore_patterns=['.git*'])"
```

## PRIORITY 1: Fix Crash (Memory Leak)

### Likely causes:
1. **ShapeManager.js** — `update()` clears ALL group children and recreates geometry every frame. Should reuse geometry and only update positions.
2. **MandalaVisualizer.js** — same pattern, disposes and recreates every frame
3. **MusicManager.js stopArpeggio()** — `setTimeout(() => synth.dispose(), 3000)` can accumulate if called rapidly. Add tracking to prevent duplicates.
4. **SVG turbulence filter** — updating DOM attributes 60x/sec may cause browser layout thrashing

### Fix approach:
- ShapeManager: pre-allocate node meshes and edge meshes in constructor, reuse them, only update positions in update()
- MandalaVisualizer: same — pre-allocate, reuse
- MusicManager: track pending disposals, cancel duplicates
- DisplacementFilter: throttle SVG attribute updates to 15fps instead of 60fps

## PRIORITY 2: Features That Need Testing
- Gesture-driven music (pad + pluck + percussion layers)
- Per-finger expression controls (delay, reverb, speed, timbre)
- ShapeManager pinch detection (fingertip anchors)
- ShapeTessellationShader (internal Poincaré tessellation in shapes)
- SVG turbulence displacement

## PRIORITY 3: Remaining Phase 3 Features
- Phase 3.5: Audio-geometry feedback (proximity filter, shape area → delay)
- Phase 3.6: Multiplayer jam session (numHands: 4, treble+bass split)

## What Works Well
- Webcam + MediaPipe hand tracking in HF Spaces
- EDM gesture-driven music (3 layers: pad, pluck, percussion)
- Hand skeleton visualization (magenta lines, cyan dots)
- Mandala geometry (pentagram, rays, rings)
- Psychedelic hue-rotating webcam filter (fast, dramatic)
- SVG turbulence displacement (organic per-pixel warping)
- Displacement ON by default, toggle with 'D'
- Top bar shows control instructions
- Labels on hands: "PAD: note", "WIGGLE FINGERS TO PLAY"

## Key Files
| File | Lines | Status |
|------|-------|--------|
| game.js | ~1480 | TRANSPILED — many surgical edits, handle with care |
| ShapeManager.js | ~435 | Rewritten — correct anchor logic, NEEDS optimization |
| ShapeTessellationShader.js | ~200 | Has `ctr` rename fix, otherwise untested |
| DisplacementFilter.js | ~115 | SVG turbulence, working |
| WaveformVisualizer.js | ~200 | Poincaré shader + breathing, working |
| MandalaVisualizer.js | ~175 | Working but leaks geometry |
| MusicManager.js | ~340 | Gesture-driven, working, needs disposal fix |
| DrumManager.js | ~250 | Unchanged from arpeggiator, stable |

## Reference Docs
- `.claude/vision-reference.md` — Instagram reel interaction spec + multiplayer spec
- `.claude/plans/cozy-wiggling-acorn.md` — Phase 3 implementation plan
