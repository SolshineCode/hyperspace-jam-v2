import * as Tone from 'https://esm.sh/tone';

// Celestial Music Engine for Hyperspace Jam
export class MusicManager {
    constructor() {
        this.polySynth = null;
        this.reverb = null;
        this.delay = null;
        this.chorus = null;
        this.filter = null;
        this.analyser = null;
        this.isStarted = false;
        this.activePatterns = new Map();
        this.handVolumes = new Map();

        this.synthPresets = [
            // Preset 1: "Celestial Pluck" — crystal singing bowls in a cathedral
            {
                harmonicity: 4,
                modulationIndex: 14,
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.001,
                    decay: 0.3,
                    sustain: 0.02,
                    release: 1.5
                },
                modulation: { type: 'triangle' },
                modulationEnvelope: {
                    attack: 0.001,
                    decay: 0.15,
                    sustain: 0.1,
                    release: 0.8
                }
            },
            // Preset 2: "Deep Space Bass" — standing inside a bass speaker
            {
                harmonicity: 0.25,
                modulationIndex: 25,
                oscillator: { type: 'sawtooth' },
                envelope: {
                    attack: 0.05,
                    decay: 0.6,
                    sustain: 0.5,
                    release: 1.2
                },
                modulation: { type: 'square' },
                modulationEnvelope: {
                    attack: 0.1,
                    decay: 0.4,
                    sustain: 0.6,
                    release: 1.0
                }
            },
            // Preset 3: "Astral Choir" — ethereal angelic pad wash
            {
                harmonicity: 3,
                modulationIndex: 6,
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.5,
                    decay: 1.5,
                    sustain: 0.9,
                    release: 3.0
                },
                modulation: { type: 'sine' },
                modulationEnvelope: {
                    attack: 0.3,
                    decay: 0.8,
                    sustain: 0.7,
                    release: 2.0
                }
            }
        ];

        // C Minor Pentatonic spanning 2 octaves
        this.scaleIntervals = [-12, -9, -7, -5, -2, 0, 3, 5, 7, 10, 12];

        this.currentSynthIndex = 0;
    }

    async start() {
        if (this.isStarted) return;

        await Tone.start();

        // Cavernous reverb
        this.reverb = new Tone.Reverb({
            decay: 10,
            preDelay: 0.05,
            wet: 0.5
        }).toDestination();

        // Stereo ping-pong delay for width
        this.delay = new Tone.PingPongDelay("4n.", 0.35).connect(this.reverb);
        this.delay.wet.value = 0.25;

        // Waveform analyser
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.analyser.connect(this.delay);

        // Chorus for shimmer and stereo width
        this.chorus = new Tone.Chorus(4, 2.5, 0.5).connect(this.analyser);
        this.chorus.start();

        // Proximity low-pass filter
        this.filter = new Tone.Filter(20000, 'lowpass').connect(this.chorus);

        // PolySynth -> Filter -> Chorus -> Analyser -> PingPongDelay -> Reverb -> Destination
        this.polySynth = new Tone.PolySynth(Tone.FMSynth, {
            maxPolyphony: 16,
            ...this.synthPresets[this.currentSynthIndex]
        });
        this.polySynth.connect(this.filter);
        this.polySynth.volume.value = -6;

        this.isStarted = true;

        Tone.Transport.bpm.value = 120;
        Tone.Transport.start();

        console.log("Tone.js AudioContext started — Celestial engine ready.");
    }

    startArpeggio(handId, rootNote) {
        if (!this.polySynth || this.activePatterns.has(handId)) return;

        const chord = Tone.Frequency(rootNote).harmonize(this.scaleIntervals);
        const arpeggioNotes = chord.map(freq => Tone.Frequency(freq).toNote());

        const pattern = new Tone.Pattern((time, note) => {
            const velocity = this.handVolumes.get(handId) || 0.2;
            this.polySynth.triggerAttackRelease(note, "8n", time, velocity);
        }, arpeggioNotes, "alternateUp");

        pattern.interval = "16n";
        pattern.start(0);

        this.activePatterns.set(handId, { pattern, currentRoot: rootNote });
    }

    updateArpeggioVolume(handId, velocity) {
        if (this.polySynth && this.activePatterns.has(handId)) {
            const clampedVelocity = Math.max(0, Math.min(1, velocity));
            this.handVolumes.set(handId, clampedVelocity);
            this.polySynth.volume.value = Tone.gainToDb(clampedVelocity) - 6;
        }
    }

    updateArpeggio(handId, newRootNote) {
        const activePattern = this.activePatterns.get(handId);
        if (!this.polySynth || !activePattern || activePattern.currentRoot === newRootNote) return;

        const newChord = Tone.Frequency(newRootNote).harmonize(this.scaleIntervals);
        activePattern.pattern.values = newChord.map(freq => Tone.Frequency(freq).toNote());
        activePattern.currentRoot = newRootNote;
    }

    stopArpeggio(handId) {
        const activePattern = this.activePatterns.get(handId);
        if (activePattern) {
            activePattern.pattern.stop(0);
            activePattern.pattern.dispose();
            this.activePatterns.delete(handId);
            this.handVolumes.delete(handId);

            if (this.activePatterns.size === 0) {
                this.polySynth.volume.value = -Infinity;
            }
        }
    }

    cycleSynth() {
        if (!this.polySynth) return;

        // Stop all active arpeggios
        this.activePatterns.forEach((_, key) => this.stopArpeggio(key));

        this.polySynth.dispose();

        this.currentSynthIndex = (this.currentSynthIndex + 1) % this.synthPresets.length;
        const newPreset = this.synthPresets[this.currentSynthIndex];

        this.polySynth = new Tone.PolySynth(Tone.FMSynth, {
            maxPolyphony: 16,
            ...newPreset
        });
        this.polySynth.connect(this.filter);
        this.polySynth.volume.value = -6;

        console.log(`Switched to synth preset ${this.currentSynthIndex}: ${['Celestial Pluck', 'Deep Space Bass', 'Astral Choir'][this.currentSynthIndex]}`);
    }

    /**
     * Set proximity-based low-pass filter.
     * @param {number} value — 0 (far, clear) to 1 (close, filtered)
     */
    setProximityFilter(value) {
        if (!this.filter) return;
        const cutoff = 20000 - value * 19600;
        this.filter.frequency.rampTo(cutoff, 0.1);
    }

    /**
     * Update expressive finger controls (called per-frame from game.js)
     * @param {object} params — { middleFinger, ringFinger, pinkyFinger, handSpread }
     *   Each finger value is 0-1 (0=curled, 1=fully extended)
     *   handSpread is 0-1 (0=fingers together, 1=fingers wide apart)
     */
    updateFingerExpression(params) {
        if (!this.isStarted) return;

        const { middleFinger, ringFinger, pinkyFinger, handSpread } = params;

        // Middle finger → delay wet amount (raised = more spacey echo)
        if (this.delay) {
            this.delay.wet.value = 0.0 + middleFinger * 0.45; // 0.0-0.45
        }

        // Ring finger → reverb wet amount (raised = cavernous wash)
        if (this.reverb) {
            this.reverb.wet.value = 0.2 + ringFinger * 0.5; // 0.2-0.7
        }

        // Pinky finger → arpeggio speed (raised = faster pattern)
        const activePattern = this.activePatterns.get(0);
        if (activePattern) {
            const intervals = ["8n", "8n.", "4n.", "16n", "16n.", "32n"];
            const idx = Math.min(Math.floor(pinkyFinger * intervals.length), intervals.length - 1);
            if (activePattern.pattern.interval !== intervals[idx]) {
                activePattern.pattern.interval = intervals[idx];
            }
        }

        // Hand spread → modulation index (wider = richer, more complex timbre)
        if (this.polySynth) {
            const modIdx = 4 + handSpread * 24; // 4-28 range
            try {
                this.polySynth.set({ modulationIndex: modIdx });
            } catch (e) {
                // Some presets may not support this — silently ignore
            }
        }
    }

    getAnalyser() {
        return this.analyser;
    }
}
