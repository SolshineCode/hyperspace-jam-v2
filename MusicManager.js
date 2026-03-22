import * as Tone from 'https://esm.sh/tone';

// EDM/Psychedelic Music Engine for Hyperspace Jam
export class MusicManager {
    constructor() {
        this.polySynth = null;
        this.reverb = null;
        this.delay = null;
        this.analyser = null;
        this.isStarted = false;
        this.activePatterns = new Map();
        this.handVolumes = new Map();

        this.synthPresets = [
            // Preset 1: "Hyperspace Pluck" — crystalline sparkly pluck with reverb tail
            {
                harmonicity: 3,
                modulationIndex: 18,
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.005,
                    decay: 0.15,
                    sustain: 0.05,
                    release: 0.5
                },
                modulation: { type: 'square' },
                modulationEnvelope: {
                    attack: 0.01,
                    decay: 0.1,
                    sustain: 0.2,
                    release: 0.3
                }
            },
            // Preset 2: "Acid Bass" — deep squelchy acid-style bass
            {
                harmonicity: 0.5,
                modulationIndex: 20,
                oscillator: { type: 'sawtooth' },
                envelope: {
                    attack: 0.02,
                    decay: 0.4,
                    sustain: 0.3,
                    release: 0.8
                },
                modulation: { type: 'square' },
                modulationEnvelope: {
                    attack: 0.05,
                    decay: 0.3,
                    sustain: 0.4,
                    release: 0.6
                }
            },
            // Preset 3: "Ethereal Pad" — lush ambient wash
            {
                harmonicity: 2,
                modulationIndex: 2,
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.3,
                    decay: 1.0,
                    sustain: 0.8,
                    release: 2.0
                },
                modulation: { type: 'sine' },
                modulationEnvelope: {
                    attack: 0.2,
                    decay: 0.5,
                    sustain: 0.8,
                    release: 1.5
                }
            }
        ];

        this.currentSynthIndex = 0;
    }

    async start() {
        if (this.isStarted) return;

        await Tone.start();

        // Cavernous reverb
        this.reverb = new Tone.Reverb({
            decay: 8,
            preDelay: 0.01,
            wet: 0.6
        }).toDestination();

        // Dotted eighth note ping-pong delay, chained after reverb for spacier sound
        this.delay = new Tone.FeedbackDelay("8n.", 0.4).connect(this.reverb);
        this.delay.wet.value = 0.3;

        // Waveform analyser
        this.analyser = new Tone.Analyser('waveform', 1024);

        // Synth -> analyser -> delay -> reverb -> destination
        this.polySynth = new Tone.PolySynth(Tone.FMSynth, this.synthPresets[this.currentSynthIndex]);
        this.polySynth.connect(this.analyser);
        this.analyser.connect(this.delay);

        this.polySynth.volume.value = 0;
        this.isStarted = true;

        Tone.Transport.bpm.value = 128;
        Tone.Transport.start();

        console.log("Tone.js AudioContext started — EDM/Psychedelic engine ready.");
    }

    startArpeggio(handId, rootNote) {
        if (!this.polySynth || this.activePatterns.has(handId)) return;

        // C Minor Pentatonic scale intervals
        const chord = Tone.Frequency(rootNote).harmonize([0, 3, 5, 7, 10, 12]);
        const arpeggioNotes = chord.map(freq => Tone.Frequency(freq).toNote());

        const pattern = new Tone.Pattern((time, note) => {
            const velocity = this.handVolumes.get(handId) || 0.2;
            this.polySynth.triggerAttackRelease(note, "16n", time, velocity);
        }, arpeggioNotes, "upDown");

        pattern.interval = "16n";
        pattern.start(0);

        this.activePatterns.set(handId, { pattern, currentRoot: rootNote });
    }

    updateArpeggioVolume(handId, velocity) {
        if (this.polySynth && this.activePatterns.has(handId)) {
            const clampedVelocity = Math.max(0, Math.min(1, velocity));
            this.handVolumes.set(handId, clampedVelocity);
            this.polySynth.volume.value = Tone.gainToDb(clampedVelocity);
        }
    }

    updateArpeggio(handId, newRootNote) {
        const activePattern = this.activePatterns.get(handId);
        if (!this.polySynth || !activePattern || activePattern.currentRoot === newRootNote) return;

        const newChord = Tone.Frequency(newRootNote).harmonize([0, 3, 5, 7, 10, 12]);
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

        this.polySynth = new Tone.PolySynth(Tone.FMSynth, newPreset);
        this.polySynth.connect(this.analyser);
        this.polySynth.volume.value = 0;

        console.log(`Switched to synth preset ${this.currentSynthIndex}: ${['Hyperspace Pluck', 'Acid Bass', 'Ethereal Pad'][this.currentSynthIndex]}`);
    }

    getAnalyser() {
        return this.analyser;
    }
}
