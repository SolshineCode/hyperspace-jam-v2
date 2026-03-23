export class DisplacementFilter {
    constructor(rendererCanvas, videoElement) {
        this.canvas = rendererCanvas;
        this.video = videoElement;
        this.enabled = true;
        this.time = 0;

        // Create SVG turbulence filter for real per-pixel displacement
        this._createTurbulenceSVG();
    }

    _createTurbulenceSVG() {
        // SVG filter = web equivalent of After Effects "Turbulent Displace"
        var svgNS = 'http://www.w3.org/2000/svg';
        this.svg = document.createElementNS(svgNS, 'svg');
        this.svg.setAttribute('width', '0');
        this.svg.setAttribute('height', '0');
        this.svg.style.position = 'absolute';

        var defs = document.createElementNS(svgNS, 'defs');

        // Filter for the webcam video
        var filter = document.createElementNS(svgNS, 'filter');
        filter.setAttribute('id', 'turbulence-displace');
        filter.setAttribute('x', '-10%');
        filter.setAttribute('y', '-10%');
        filter.setAttribute('width', '120%');
        filter.setAttribute('height', '120%');

        // feTurbulence = generates Perlin noise pattern
        // "Evolution" = seed, animated over time
        // "Amount" = scale parameter in feDisplacementMap
        this.turbulence = document.createElementNS(svgNS, 'feTurbulence');
        this.turbulence.setAttribute('type', 'fractalNoise');
        this.turbulence.setAttribute('baseFrequency', '0.008 0.006'); // Size (lower = larger swirls)
        this.turbulence.setAttribute('numOctaves', '3');
        this.turbulence.setAttribute('seed', '0'); // Will animate this = "Evolution"
        this.turbulence.setAttribute('result', 'noise');

        // feDisplacementMap = displaces pixels based on the noise
        this.displacement = document.createElementNS(svgNS, 'feDisplacementMap');
        this.displacement.setAttribute('in', 'SourceGraphic');
        this.displacement.setAttribute('in2', 'noise');
        this.displacement.setAttribute('scale', '12'); // Amount — subtle but visible
        this.displacement.setAttribute('xChannelSelector', 'R');
        this.displacement.setAttribute('yChannelSelector', 'G');

        filter.appendChild(this.turbulence);
        filter.appendChild(this.displacement);
        defs.appendChild(filter);

        // Second filter for the Three.js canvas (slightly different params)
        var filter2 = document.createElementNS(svgNS, 'filter');
        filter2.setAttribute('id', 'turbulence-canvas');
        filter2.setAttribute('x', '-10%');
        filter2.setAttribute('y', '-10%');
        filter2.setAttribute('width', '120%');
        filter2.setAttribute('height', '120%');

        this.turbulence2 = document.createElementNS(svgNS, 'feTurbulence');
        this.turbulence2.setAttribute('type', 'fractalNoise');
        this.turbulence2.setAttribute('baseFrequency', '0.005 0.004');
        this.turbulence2.setAttribute('numOctaves', '2');
        this.turbulence2.setAttribute('seed', '42');
        this.turbulence2.setAttribute('result', 'noise');

        this.displacement2 = document.createElementNS(svgNS, 'feDisplacementMap');
        this.displacement2.setAttribute('in', 'SourceGraphic');
        this.displacement2.setAttribute('in2', 'noise');
        this.displacement2.setAttribute('scale', '8');
        this.displacement2.setAttribute('xChannelSelector', 'R');
        this.displacement2.setAttribute('yChannelSelector', 'G');

        filter2.appendChild(this.turbulence2);
        filter2.appendChild(this.displacement2);
        defs.appendChild(filter2);

        this.svg.appendChild(defs);
        document.body.appendChild(this.svg);

        // Apply filters
        this.video.style.filter += ' url(#turbulence-displace)';
        this.canvas.style.filter = 'url(#turbulence-canvas)';
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this.canvas.style.filter = '';
            this.canvas.style.transform = '';
            this.video.style.filter = '';
            this.video.style.transform = 'scaleX(-1)';
        } else {
            this.video.style.filter = 'url(#turbulence-displace)';
            this.canvas.style.filter = 'url(#turbulence-canvas)';
        }
        console.log('Turbulence displacement: ' + (this.enabled ? 'ON' : 'OFF'));
    }

    update(amplitude) {
        if (!this.enabled) return;
        this.time += 0.016;

        // Throttle SVG DOM updates to ~10fps to prevent layout thrashing
        this._frameCount = (this._frameCount || 0) + 1;
        if (this._frameCount % 6 !== 0) return;

        var amp = Math.max(0.15, amplitude || 0);

        // Animate "Evolution" — change the noise seed over time
        var seed = Math.floor(this.time * 1.5) % 1000;
        this.turbulence.setAttribute('seed', String(seed));
        this.turbulence2.setAttribute('seed', String(seed + 500));

        // Animate "Offset Turbulence" — shift the noise pattern's base frequency
        // Subtle variation creates the "breathing" organic feel
        var freqX = 0.008 + Math.sin(this.time * 0.3) * 0.003;
        var freqY = 0.006 + Math.cos(this.time * 0.25) * 0.002;
        this.turbulence.setAttribute('baseFrequency', freqX + ' ' + freqY);

        // Audio-reactive Amount — MAX STRENGTH displacement
        var videoScale = 20 + amp * 30; // 20-50 range (always visible, big on audio)
        var canvasScale = 14 + amp * 22; // 14-36 range
        this.displacement.setAttribute('scale', String(videoScale));
        this.displacement2.setAttribute('scale', String(canvasScale));

        // Smoke/wave distortion — sinusoidal waves rippling the canvas
        var breathScale = 1.0 + 0.01 * Math.sin(this.time * 0.7);
        var waveSkewX = Math.sin(this.time * 0.4) * 0.8;
        var waveSkewY = Math.cos(this.time * 0.35) * 0.5;
        var waveX = Math.sin(this.time * 0.6) * 3;
        var waveY = Math.cos(this.time * 0.5) * 2;

        this.canvas.style.transform =
            'scale(' + breathScale + ') ' +
            'skew(' + waveSkewX + 'deg, ' + waveSkewY + 'deg) ' +
            'translate(' + waveX + 'px, ' + waveY + 'px)';
        this.video.style.transform =
            'scaleX(-1) scale(' + breathScale + ') ' +
            'skew(' + (-waveSkewX * 0.6) + 'deg, ' + (-waveSkewY * 0.6) + 'deg) ' +
            'translate(' + (-waveX * 0.5) + 'px, ' + (-waveY * 0.5) + 'px)';
    }

    dispose() {
        this.canvas.style.filter = '';
        this.canvas.style.transform = '';
        this.video.style.filter = '';
        this.video.style.transform = 'scaleX(-1)';
        if (this.svg && this.svg.parentNode) {
            this.svg.parentNode.removeChild(this.svg);
        }
    }
}
