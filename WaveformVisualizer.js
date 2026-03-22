import * as THREE from 'three';

const vertexShader = `
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float u_time;
uniform float u_amplitude;
uniform vec2 u_resolution;
uniform vec3 u_color;

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

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    float breathe = 1.0 + 0.15 * u_amplitude;
    uv *= 1.1 * breathe;

    float r = length(uv);

    if (r >= 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float rotSpeed = 0.08 + 0.05 * u_amplitude;
    uv = rot(uv, u_time * rotSpeed);

    float n = 7.0;
    float angleStep = 6.283185 / n;

    float coshR = cos(3.14159265 / 3.0) / sin(3.14159265 / n);
    float sinhR = sqrt(coshR * coshR - 1.0);
    float tr = sinhR / (coshR + 1.0);

    vec2 z = uv;
    float iter = 0.0;

    for (int i = 0; i < 40; i++) {
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

    // Color palette: deep purples, teals, magentas — psychedelic but dark
    float t = mod(iter * 0.1 + u_time * 0.02, 1.0);
    vec3 col1 = vec3(0.03, 0.01, 0.08); // deep purple-black
    vec3 col2 = vec3(0.02, 0.10, 0.15); // dark teal
    vec3 col3 = vec3(0.12, 0.02, 0.10); // dark magenta

    vec3 color = mix(col1, col2, sin(iter * 0.7 + u_time * 0.1) * 0.5 + 0.5);
    color = mix(color, col3, sin(iter * 1.1 - u_time * 0.15) * 0.5 + 0.5);

    // Tint toward the hand-gesture color
    float satBoost = 0.3 + 0.2 * u_amplitude;
    color = mix(color, u_color * 0.15, satBoost * 0.3);

    // Edge highlights with glow from amplitude
    float edgeLine = 1.0 - smoothstep(0.0, 0.04 - 0.02 * u_amplitude, abs(fract(d * 1.5) - 0.5) - 0.45);
    color += vec3(0.06, 0.08, 0.14) * edgeLine * (1.0 + u_amplitude);

    // Sector pattern
    float ang = atan(z.y, z.x);
    float sectorPattern = smoothstep(0.02, 0.04, abs(sin(ang * n * 0.5)));
    color *= 0.7 + 0.3 * sectorPattern;

    // Audio reactive brightness
    color *= 0.8 + 0.25 * u_amplitude;

    // Disk edge fade
    float diskEdge = smoothstep(0.98, 0.92, r);
    color *= diskEdge;

    color = min(color, vec3(1.0));

    gl_FragColor = vec4(color, 0.45);
}
`;

export class WaveformVisualizer {
    constructor(scene, analyser, canvasWidth, canvasHeight) {
        this.scene = scene;
        this.analyser = analyser;
        this.mesh = null;
        this.clock = new THREE.Clock();
        this.currentColor = new THREE.Color('#7B4394');
        this.targetColor = new THREE.Color('#7B4394');

        this.uniforms = {
            u_time: { value: 0.0 },
            u_amplitude: { value: 0.0 },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
            u_color: { value: this.currentColor }
        };

        this._createVisualizer();
    }

    _createVisualizer() {
        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            transparent: true,
            depthWrite: false,
            depthTest: false
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.renderOrder = -1;
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
    }

    update() {
        if (!this.analyser || !this.mesh) return;

        // Interpolate color
        this.currentColor.lerp(this.targetColor, 0.05);

        // Update time
        this.uniforms.u_time.value = this.clock.getElapsedTime();

        // Compute RMS amplitude from analyser
        var waveformData = this.analyser.getValue();
        var sum = 0;
        for (var i = 0; i < waveformData.length; i++) {
            sum += waveformData[i] * waveformData[i];
        }
        var amplitude = Math.sqrt(sum / waveformData.length);
        this.uniforms.u_amplitude.value = amplitude;
    }

    updateColor(newColor) {
        this.targetColor.set(newColor);
    }

    updatePosition(canvasWidth, canvasHeight) {
        this.uniforms.u_resolution.value.set(canvasWidth, canvasHeight);
    }

    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
        }
    }
}
