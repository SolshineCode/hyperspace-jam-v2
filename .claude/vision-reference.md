# Hyperspace Jam — Vision Reference: Dynamic Geometric Shapes with Internal Hyperbolic Tessellation

## Source
Instagram reel: https://www.instagram.com/reel/DTYN4uwCtuG/
Described by video analysis agent 2026-03-22.

## Core Interaction Model

### Dynamic Anchor Points
- **Pinch gesture** (thumb + index touching) = single anchor point
- **2 anchors** = line (two parallel lines connecting points)
- **3 anchors** = triangle
- **4 anchors** = quadrilateral
- System smoothly transitions between states as anchors are added/removed

### Anchor Sources
- Thumb tip (landmark 4)
- Index tip (landmark 8)
- Middle tip (landmark 12)
- Pinch = thumb+index merged into one point
- Both hands can contribute anchors simultaneously

### Shape Rendering (Layer 1: Wireframe)
- **Nodes**: Small hollow white squares with solid white dot center
- **Edges**: Crisp solid white lines connecting nodes
- **Z-depth**: Line thickness and node size scale inversely with distance from camera
  - Close to camera = thick lines, large nodes
  - Far from camera = thin lines, small nodes
- No physics/gravity — pure tension between tracked points

## Internal Visualization (Layer 2: Hyperbolic Geometry)

### When a closed shape forms (held > ~0.2s):
- Internal space fills with **Poincaré disk tessellation**
- Central focal point inside the shape
- Tessellating shapes get smaller and denser toward edges (hyperbolic compression)
- Pattern dynamically re-tessellates as shape morphs with finger movement

### Shape-specific tessellations:
- **Line**: 1D hyperbolic waves and interference rings between parallel lines
- **Triangle**: Triangle-based Poincaré tessellation with central singularity
- **Quadrilateral**: Quad-based tiling (e.g., {4,5} non-Euclidean tiling)

### Dynamic behavior:
- Pattern scales and re-tessellates in real-time as fingers move
- Stretching fingers = tessellation scales, colors intensify
- Collapsing shape = reverse singularity wink-out effect

## Psychedelic Coloring (Layer 3: DMT-Chrome)

### Color palette:
- Deep blues, electric purples, neon pinks, vibrant greens
- Iridescent shifting between colors (not static)
- Colors flow along curved non-Euclidean geometry toward focal point

### Effects:
- Biological pulsation rhythm (edges flare brighter at peaks)
- Fractal particles drift from nodes during transitions
- Maximum stretch = most intense iridescence
- Close to camera = overwhelming magenta/turquoise flares

## Audio Hooks
- Shape proximity to camera → distortion/low-pass filter
- Close = distorted/filtered, far = clear
- Pattern complexity peak synced with audio distortion peak
- Pulsation rhythm could sync with beat

## Multiplayer Jam Session (3+ hands detected)

### Core Concept
When MediaPipe detects more than 2 hands, the system enters **multiplayer jam mode**. Each player pair gets distinct musical roles that complement each other — not just duplicates.

### Player Role Assignment
- **Player 1 (hands 0-1)**: Treble / Lead — higher octave range (C3-C6), brighter synth presets, faster arpeggio patterns
- **Player 2 (hands 2-3)**: Bass / Foundation — lower octave range (C1-C3), deeper presets (Acid Bass, sub-sine), slower patterns, heavier reverb
- Could also split as: melodic vs rhythmic, or arp vs pad

### Musical Separation Strategy
- Each player pair routes through its own PolySynth instance with distinct preset
- Separate effects chains (Player 1: bright delay, Player 2: deep reverb)
- Octave offset so they naturally harmonize rather than clash
- Same scale (C Minor Pentatonic) but different registers = instant musical compatibility
- BPM is shared — both players lock to the same Transport clock

### Visual Differentiation
- Player 1 mandala/geometry: cyan + magenta palette
- Player 2 mandala/geometry: gold + green palette
- Internal Poincaré tessellations use different {P,Q} tilings per player
- Inter-player geometry: lines connecting across players' hands create larger mandala structures

### Detection Logic
- MediaPipe HandLandmarker already supports `numHands: 4`
- Hands 0-1 = Player 1, Hands 2-3 = Player 2
- If only 2 hands detected, single-player mode (current behavior)
- If 3-4 hands detected, split into two players automatically
- UI indicator shows "JAM SESSION" when multiplayer is active

### Scaling Considerations
- 4 hands = 84 landmarks at 30fps — still performant
- Two separate PolySynth instances may need careful volume balancing
- Master bus limiter (-2dB) protects speakers regardless of player count

## Implementation Priority for Hyperspace Jam
1. Pinch detection → merge thumb+index into single anchor
2. Dynamic shape state (line → triangle → quad) based on active anchors
3. Internal Poincaré tessellation shader filling the shape geometry
4. DMT-chrome iridescent color flow
5. Z-depth line thickness + node size scaling
6. Audio filter modulation from shape proximity
7. Pulsation and particle effects
8. **Multiplayer jam session** — detect 3-4 hands, split into treble+bass roles
