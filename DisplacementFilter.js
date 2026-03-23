export class DisplacementFilter {
    constructor(rendererCanvas, videoElement) {
        this.canvas = rendererCanvas;
        this.video = videoElement;
        this.enabled = true; // ON by default — trippy from the start
        this.time = 0;
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this.canvas.style.transform = '';
            this.video.style.transform = 'scaleX(-1)';
        }
        console.log('Displacement filter: ' + (this.enabled ? 'ON' : 'OFF'));
    }

    update(amplitude) {
        if (!this.enabled) return;
        this.time += 0.016;

        // Use a minimum baseline so effects are visible even without loud audio
        var amp = Math.max(0.3, amplitude || 0);

        // Breathing scale — always visible, boosted by audio
        var breathScale = 1.0 + 0.03 * Math.sin(this.time * 1.2);
        var ampScale = 1.0 + amp * 0.04;
        var totalScale = breathScale * ampScale;

        // Wobble skew — trippy warping
        var skewX = Math.sin(this.time * 0.7) * (1.0 + amp * 3.0);
        var skewY = Math.cos(this.time * 0.9) * (0.6 + amp * 2.0);

        // Wave translation — scene drifts
        var waveX = Math.sin(this.time * 1.3) * (2.0 + amp * 6.0);
        var waveY = Math.cos(this.time * 1.0) * (1.5 + amp * 4.0);

        // Three.js canvas
        this.canvas.style.transform =
            'scale(' + totalScale + ') ' +
            'skew(' + skewX + 'deg, ' + skewY + 'deg) ' +
            'translate(' + waveX + 'px, ' + waveY + 'px)';

        // Video (matching but inverted skew for trippy desync)
        this.video.style.transform =
            'scaleX(-1) ' +
            'scale(' + totalScale + ') ' +
            'skew(' + (-skewX * 0.7) + 'deg, ' + (-skewY * 0.7) + 'deg) ' +
            'translate(' + (waveX * 0.6) + 'px, ' + (waveY * 0.6) + 'px)';
    }

    dispose() {
        this.canvas.style.transform = '';
        this.video.style.transform = 'scaleX(-1)';
    }
}
