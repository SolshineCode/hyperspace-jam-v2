import * as THREE from 'three';

export const tessVertexShader = `
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const tessFragmentShader = `
precision highp float;

uniform float u_time;
uniform vec2 u_vertices[4];
uniform int u_vertexCount;
uniform float u_amplitude;
uniform vec2 u_resolution;

// --- Complex arithmetic (from WaveformVisualizer) ---
vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
    float d = dot(b, b);
    return vec2(dot(a, b), a.y * b.x - a.x * b.y) / d;
}

vec2 conj(vec2 z) {
    return vec2(z.x, -z.y);
}

vec2 mobius(vec2 z, vec2 a) {
    return cdiv(z - a, vec2(1.0, 0.0) - cmul(conj(a), z));
}

float hdist(vec2 z) {
    float r = length(z);
    if (r >= 1.0) return 10.0;
    return log((1.0 + r) / (1.0 - r));
}

vec2 rot(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// --- HSV to RGB ---
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// --- Polygon winding number test ---
float crossZ(vec2 a, vec2 b) {
    return a.x * b.y - a.y * b.x;
}

bool insidePolygon(vec2 p, int count) {
    int winding = 0;
    for (int i = 0; i < 4; i++) {
        if (i >= count) break;
        int j = i + 1;
        if (j >= count) j = 0;
        vec2 vi = u_vertices[i];
        vec2 vj = u_vertices[j];
        if (vi.y <= p.y) {
            if (vj.y > p.y) {
                if (crossZ(vj - vi, p - vi) > 0.0) winding++;
            }
        } else {
            if (vj.y <= p.y) {
                if (crossZ(vj - vi, p - vi) < 0.0) winding--;
            }
        }
    }
    return winding != 0;
}

// --- Map point inside polygon to unit disk ---
vec2 mapToDisk(vec2 p, int count) {
    // Compute ctr
    vec2 ctr = vec2(0.0);
    for (int i = 0; i < 4; i++) {
        if (i >= count) break;
        ctr += u_vertices[i];
    }
    ctr /= float(count);

    // Find max distance from ctr to any vertex
    float maxDist = 0.0;
    for (int i = 0; i < 4; i++) {
        if (i >= count) break;
        float d = length(u_vertices[i] - ctr);
        if (d > maxDist) maxDist = d;
    }

    // Normalize: ctr -> origin, scale so vertices sit near disk edge
    vec2 offset = (p - ctr) / max(maxDist, 0.001);

    // Clamp to disk
    float r = length(offset);
    if (r > 0.98) offset = normalize(offset) * 0.98;

    return offset;
}

void main() {
    // Convert fragment coords to normalized [-1,1] using resolution
    vec2 ndc = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;

    // Polygon clip
    int count = u_vertexCount;
    if (!insidePolygon(ndc, count)) {
        discard;
    }

    // Map to unit disk
    vec2 diskPos = mapToDisk(ndc, count);

    float r = length(diskPos);
    if (r >= 1.0) {
        discard;
    }

    // Audio-reactive rotation
    float rotSpeed = 0.12 + 0.08 * u_amplitude;
    vec2 uv = rot(diskPos, u_time * rotSpeed);

    // Breathing scale
    float breathe = 1.0 + 0.1 * u_amplitude;
    uv *= breathe;

    if (length(uv) >= 1.0) {
        discard;
    }

    // --- {7,3} Poincare tessellation (from WaveformVisualizer) ---
    float n = 7.0;
    float angleStep = 6.283185 / n;

    float coshR = cos(3.14159265 / 3.0) / sin(3.14159265 / n);
    float sinhR = sqrt(coshR * coshR - 1.0);
    float tr = sinhR / (coshR + 1.0);

    vec2 z = uv;
    float iter = 0.0;

    for (int i = 0; i < 20; i++) {
        float ang = atan(z.y, z.x);
        float sector = floor(ang / angleStep + 0.5) * angleStep;

        z = rot(z, -sector);
        iter += abs(sector) > 0.01 ? 1.0 : 0.0;

        vec2 center = vec2(tr, 0.0);
        vec2 w = mobius(z, center);

        if (length(w) >= length(z) - 0.0001) break;
        z = w;
        iter += 1.0;
    }

    float d = hdist(z);

    // --- DMT-Chrome coloring ---
    // Pulsation: biological rhythm ~3 second cycle
    float pulsation = 0.5 + 0.5 * sin(u_time * 2.094); // 2*pi/3 ≈ 2.094 for ~3s cycle

    // Hue flows along geometry toward center
    float hueFlow = sin(iter * 0.3 + u_time * 0.1);
    // Map to: deep blue(0.6) -> purple(0.75) -> pink(0.85) -> green(0.3)
    float hue;
    if (hueFlow > 0.33) {
        hue = mix(0.6, 0.75, (hueFlow - 0.33) / 0.67); // blue -> purple
    } else if (hueFlow > -0.33) {
        hue = mix(0.75, 0.85, (0.33 - hueFlow) / 0.66); // purple -> pink
    } else {
        hue = mix(0.85, 1.3, (-0.33 - hueFlow) / 0.67); // pink -> green (via 1.0+)
    }
    hue = fract(hue);

    float sat = 0.9;
    float val = 0.7 + 0.3 * pulsation;

    vec3 color = hsv2rgb(vec3(hue, sat, val));

    // Edge flare: internal tile edges glow brighter at pulsation peaks
    float edgeLine = 1.0 - smoothstep(0.0, 0.05, abs(fract(d * 1.5) - 0.5) - 0.42);
    color += vec3(0.3, 0.2, 0.4) * edgeLine * pulsation;

    // Sector pattern for extra geometry detail
    float ang = atan(z.y, z.x);
    float sectorPattern = smoothstep(0.02, 0.05, abs(sin(ang * n * 0.5)));
    color *= 0.75 + 0.25 * sectorPattern;

    // Audio boost
    color *= 0.9 + 0.3 * u_amplitude;

    // Disk edge fade
    float diskEdge = smoothstep(0.98, 0.85, r);
    color *= diskEdge;

    color = min(color, vec3(1.0));

    gl_FragColor = vec4(color, 0.8);
}
`;

export function createTessellationMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            u_time: { value: 0 },
            u_vertices: { value: [
                new THREE.Vector2(),
                new THREE.Vector2(),
                new THREE.Vector2(),
                new THREE.Vector2()
            ]},
            u_vertexCount: { value: 3 },
            u_amplitude: { value: 0 },
            u_resolution: { value: new THREE.Vector2(1, 1) }
        },
        vertexShader: tessVertexShader,
        fragmentShader: tessFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide
    });
}
