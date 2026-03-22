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

## Implementation Priority for Hyperspace Jam
1. Pinch detection → merge thumb+index into single anchor
2. Dynamic shape state (line → triangle → quad) based on active anchors
3. Internal Poincaré tessellation shader filling the shape geometry
4. DMT-chrome iridescent color flow
5. Z-depth line thickness + node size scaling
6. Audio filter modulation from shape proximity
7. Pulsation and particle effects
