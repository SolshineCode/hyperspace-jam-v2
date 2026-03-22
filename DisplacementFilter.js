export class DisplacementFilter {
    constructor(rendererCanvas, videoElement) {
        this.canvas = rendererCanvas;
        this.video = videoElement;
        this.enabled = false;
        this.time = 0;
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            // Reset transforms
            this.canvas.style.transform = '';
            this.video.style.transform = 'scaleX(-1)'; // Restore original mirror
        }
    }

    update(amplitude, handPositions) {
        if (!this.enabled) return;
        this.time += 0.016; // ~60fps

        // Barrel distortion via CSS perspective + scale oscillation
        var breathScale = 1.0 + 0.015 * Math.sin(this.time * 1.5);
        var ampScale = 1.0 + amplitude * 0.03;
        var totalScale = breathScale * ampScale;

        // Chromatic aberration simulation: slight RGB offset via text-shadow-like effect
        // (CSS can't do true chromatic aberration, but we can do skew + hue shift)
        var skewX = Math.sin(this.time * 0.7) * amplitude * 0.5;
        var skewY = Math.cos(this.time * 0.9) * amplitude * 0.3;

        // Wave distortion
        var waveX = Math.sin(this.time * 2.0) * amplitude * 2;
        var waveY = Math.cos(this.time * 1.7) * amplitude * 1.5;

        // Apply to Three.js canvas (the overlay)
        this.canvas.style.transform =
            'scale(' + totalScale + ') ' +
            'skew(' + skewX + 'deg, ' + skewY + 'deg) ' +
            'translate(' + waveX + 'px, ' + waveY + 'px)';

        // Apply matching distortion to video (keeps them aligned)
        this.video.style.transform =
            'scaleX(-1) ' + // Keep mirror
            'scale(' + totalScale + ') ' +
            'skew(' + (-skewX * 0.5) + 'deg, ' + (-skewY * 0.5) + 'deg) ' +
            'translate(' + (waveX * 0.5) + 'px, ' + (waveY * 0.5) + 'px)';

        // Also modulate the video's hue rotation faster when amplitude is high
        // (This enhances the existing psychedelic hue rotation)
    }

    dispose() {
        this.canvas.style.transform = '';
        this.video.style.transform = 'scaleX(-1)';
    }
}
