# Hyperspace Jam — Session Handoff (2026-03-23)

## STATUS: Working, needs per-finger sound refinement

Core app is stable: hand tracking, pad drone, sub-bass, drums, psychedelic visuals all work.
Per-finger sounds exist in code but need testing/tuning after the rampTo crash fix.

## Links
- **HF Space**: https://huggingface.co/spaces/Solshine/hyperspace-jam
- **Direct URL**: https://solshine-hyperspace-jam.static.hf.space/index.html
- **GitHub**: https://github.com/SolshineCode/hyperspace-jam-v2

## Deploy Command
```bash
cd /c/Users/caleb/hyperspace-jam-v2-clean
cp /c/Users/caleb/hyperspace-jam-v2/*.js /c/Users/caleb/hyperspace-jam-v2/*.html /c/Users/caleb/hyperspace-jam-v2/*.css .
python -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='Solshine/hyperspace-jam', repo_type='space', ignore_patterns=['.git*'])"
```

## What Works
- Webcam + MediaPipe hand tracking (2 hands) in HF Spaces
- Pad drone with harmony voice (root + detuned 5th), smooth pitch glide
- Sub-bass layer with wobble LFO (hand spread = wobble speed)
- Hand height (Y) → pitch across 5 octaves (C1 sub-bass to F5)
- Thumb-index pinch → volume (normalized by palm size, works at any distance)
- Proximity to camera → lowpass filter sweep + reverb/delay wet
- Fist gesture → cycle pad presets (Hypnotic Sub / Acid Growl / Trance Wash)
- Spacebar PANIC → kills all sound + 1 second mute window
- Hand 2 drums via DrumManager (index=kick, middle=snare, ring=hihat, pinky=clap)
- Psychedelic hue-rotating webcam filter (fast, saturated)
- SVG turbulence displacement (organic per-pixel warping)
- Smoke/wave CSS distortion
- Poincaré hyperbolic shader background (audio-reactive, breathing)
- Mandala geometry (pentagram, rays, rings between fingers)
- Shape pinch detection + tessellation shader
- Per-finger labels on both hands
- Controls hint panel (frosted glass, bottom center)
- Pre-allocated geometry pools (ShapeManager + MandalaVisualizer) for stability

## PRIORITY 1: Per-Finger Sound Refinement

### The root cause we found
A `Tone.js rampTo()` with near-zero values threw `RangeError` EVERY FRAME, which crashed `_updateHands()`, which killed ALL tracking AND sound. Fixed by removing the offending rampTo and wrapping in try/catch.

### Current finger synth architecture (MusicManager.js)
**Hand 1 (synth hand) finger synths — all pre-allocated in start():**
- INDEX: MonoSynth "Acid Squelch" (sawtooth + filter sweep) → connected to delay
- MIDDLE: FMSynth "Laser Zap" (modulationIndex=25, square+sawtooth) → delay
- RING: MetalSynth "Crystal Chime" (resonance=3000, 1.5 octaves) → delay
- PINKY: MembraneSynth "Sub Drop" (pitchDecay=0.3, 6 octaves) → limiter

**Hand 2 (drum hand) finger synths — pre-allocated in start():**
- INDEX: MembraneSynth kick (8 octaves) → limiter
- MIDDLE: NoiseSynth "Riser" through AutoFilter → delay
- RING: NoiseSynth "Stutter" (rapid 4x bursts) → limiter
- PINKY: NoiseSynth "Crash" into dedicated Reverb(decay=8) → limiter

### What needs work next session
1. **Test with the crash fix** — the rampTo fix may have unblocked everything
2. **Verify finger extension values** — add console.log in updateGesture to see actual ext values
3. **The curl→extend threshold (0.25→0.35)** may need adjustment based on actual data
4. **Consider going back to the arpeggiator pattern** as the user liked — add finger sounds ON TOP of the arp, not replacing it
5. **The original arpeggiator's finger detection worked** because it used game.js's `_getFingerStates()` which is proven. Our custom extension calculation may be wrong.

### Key insight from user
"The arpeggiator worked so well though" — the working arpeggiator-based version had reliable hand detection because it didn't have per-frame errors crashing the update loop. With the crash fixed, the current version should track properly. But if finger detection is still unreliable, consider using `_getFingerStates()` (boolean up/down, proven to work) instead of continuous extension values.

## Key Files
| File | Purpose | Status |
|------|---------|--------|
| game.js | Main orchestrator (TRANSPILED ~1500 lines) | Many surgical edits, fragile |
| MusicManager.js | 10-finger psybass EDM engine | Crash fixed, needs testing |
| DrumManager.js | Drum sequencer | Stable, unchanged |
| WaveformVisualizer.js | Poincaré shader + breathing | Working |
| MandalaVisualizer.js | Sacred geometry | Pre-allocated pools, stable |
| ShapeManager.js | Pinch shapes + tessellation | Pre-allocated pools, stable |
| ShapeTessellationShader.js | GLSL for shape interiors | `ctr` fix applied |
| DisplacementFilter.js | SVG turbulence + smoke waves | Working |
| index.html | UI + controls hint | Updated labels |
| styles.css | Dark kiosk styling | Working |

## Effects Chain
```
Pad + Harmony → Filter → Chorus → Reverb → Limiter → Destination
Finger synths → Delay → Reverb → Limiter → Destination
Sub-bass → Limiter → Destination (direct, no effects)
Percussion → Limiter → Destination (direct, punchy)
Reverb → Analyser (for visualization)
```

## Remaining Phase 3 Features
- Phase 3.6: Multiplayer jam session (numHands: 4, treble+bass split)
- Dynamic shape internal tessellation (ShapeTessellationShader exists but untested)
- Attract mode logic (30s timer)
