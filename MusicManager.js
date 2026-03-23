import * as Tone from 'https://esm.sh/tone';

// Gesture-Driven Music Engine for Hyperspace Jam
// No clock, no metronome — all sound triggered by hand movement
export class MusicManager {
    constructor() {
        // Synths
        this.padSynths = new Map();      // handId -> Tone.Synth (sustained drone)
        this.activePatterns = this.padSynths; // backward compat — game.js checks .activePatterns.has(i)
        this.pluckSynth = null;          // shared PluckSynth for finger triggers
        this.kickSynth = null;           // MembraneSynth for downward hits
        this.hatSynth = null;            // NoiseSynth for sideways hits

        // Effects
        this.reverb = null;
        this.delay = null;
        this.chorus = null;
        this.analyser = null;

        // State tracking
        this.isStarted = false;
        this.handVolumes = new Map();
        this.fingerCooldowns = new Map(); // handId -> { index: timestamp, middle: timestamp, ... }
        this.percCooldown = 0;            // global percussion cooldown timestamp

        this.FINGER_COOLDOWN_MS = 200;
        this.PERC_COOLDOWN_MS = 150;
        this.HAND_VELOCITY_THRESHOLD = 0.15;

        // Finger -> semitone interval mapping (harmonically rich chord voicing)
        this.fingerIntervals = {
            index: 0,    // root
            middle: 3,   // minor third
            ring: 7,     // perfect fifth
            pinky: 10    // minor seventh (creates lush minor 7th chord)
        };

        // C Minor Pentatonic scale for root note mapping
        this.scale = ['C2', 'Eb2', 'F2', 'G2', 'Bb2', 'C3', 'Eb3', 'F3', 'G3', 'Bb3', 'C4', 'Eb4', 'F4'];

        // Pad timbre presets
        this.padPresets = [
            {
                name: 'Cosmic Drone',
                oscillator: { type: 'sine' },
                envelope: { attack: 0.8, decay: 0, sustain: 1, release: 2.0 }
            },
            {
                name: 'Crystal Bell',
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.3, decay: 0.1, sustain: 0.9, release: 1.5 }
            },
            {
                name: 'Deep Ocean',
                oscillator: { type: 'sawtooth' },
                envelope: { attack: 1.2, decay: 0.3, sustain: 0.8, release: 3.0 }
            }
        ];
        this.currentSynthIndex = 0;
    }

    async start() {
        if (this.isStarted) return;

        await Tone.start();

        // --- Effects Chain ---

        // Reverb (shared endpoint)
        this.reverb = new Tone.Reverb({
            decay: 8,
            preDelay: 0.04,
            wet: 0.4
        }).toDestination();

        // Delay for pluck notes -> reverb
        this.delay = new Tone.FeedbackDelay({
            delayTime: '8n.',
            feedback: 0.3,
            wet: 0.25
        }).connect(this.reverb);

        // Chorus for pad -> reverb
        this.chorus = new Tone.Chorus({
            frequency: 3,
            delayTime: 3.5,
            depth: 0.6
        }).connect(this.reverb);
        this.chorus.start();

        // Analyser for visualization (tap from reverb output)
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.reverb.connect(this.analyser);

        // --- Layer 2: Pluck Synth (warm, harmonic, overlapping notes) ---
        this.pluckSynth = new Tone.PolySynth(Tone.FMSynth, {
            maxPolyphony: 12,
            harmonicity: 2,          // octave relationship = consonant
            modulationIndex: 6,      // gentler FM = warmer tone
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.003,
                decay: 0.35,
                sustain: 0.08,
                release: 1.5          // long release = notes blend into each other
            },
            modulation: { type: 'sine' },  // sine mod = smoother harmonics
            modulationEnvelope: {
                attack: 0.005,
                decay: 0.15,
                sustain: 0.1,
                release: 0.8
            }
        });
        this.pluckSynth.connect(this.delay);
        this.pluckSynth.volume.value = -6;

        // --- Layer 3: Percussion ---
        // Kick / thump
        this.kickSynth = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 6,
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.001,
                decay: 0.3,
                sustain: 0,
                release: 0.4
            }
        }).toDestination();
        this.kickSynth.volume.value = -6;

        // Hi-hat / noise burst
        this.hatSynth = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: {
                attack: 0.001,
                decay: 0.08,
                sustain: 0,
                release: 0.03
            }
        }).toDestination();
        this.hatSynth.volume.value = -10;

        this.isStarted = true;
        console.log('Gesture-driven music engine ready — no clock, all expression.');
    }

    // --- Pad Management (Layer 1) ---

    startArpeggio(handId, rootNote) {
        if (!this.isStarted || this.padSynths.has(handId)) return;

        const preset = this.padPresets[this.currentSynthIndex];

        // Root pad voice
        const pad = new Tone.Synth({
            oscillator: { ...preset.oscillator },
            envelope: { ...preset.envelope }
        });
        pad.connect(this.chorus);
        pad.volume.value = -12;

        // Harmony voice — a perfect fifth above, quieter, for natural richness
        const harmonyPad = new Tone.Synth({
            oscillator: { ...preset.oscillator },
            envelope: { ...preset.envelope }
        });
        harmonyPad.connect(this.chorus);
        harmonyPad.volume.value = -18; // subtle, sits behind the root

        // Start sustained tones
        const freq = Tone.Frequency(rootNote).toFrequency();
        pad.triggerAttack(freq, Tone.now());
        harmonyPad.triggerAttack(freq * 1.498, Tone.now()); // ~perfect fifth (slightly detuned for shimmer)

        this.padSynths.set(handId, { synth: pad, harmonySynth: harmonyPad, currentRoot: rootNote });
        this.handVolumes.set(handId, 0.2);
        this.fingerCooldowns.set(handId, { index: 0, middle: 0, ring: 0, pinky: 0 });
    }

    updateArpeggio(handId, newRootNote) {
        const padData = this.padSynths.get(handId);
        if (!padData || padData.currentRoot === newRootNote) return;

        // Smooth portamento glide — both voices
        const freq = Tone.Frequency(newRootNote).toFrequency();
        padData.synth.frequency.rampTo(freq, 0.15);
        if (padData.harmonySynth) {
            padData.harmonySynth.frequency.rampTo(freq * 1.498, 0.15);
        }
        padData.currentRoot = newRootNote;
    }

    updateArpeggioVolume(handId, velocity) {
        const padData = this.padSynths.get(handId);
        if (!padData) return;

        const clamped = Math.max(0, Math.min(1, velocity));
        this.handVolumes.set(handId, clamped);
        const db = -30 + clamped * 26;
        padData.synth.volume.rampTo(db, 0.1);
        if (padData.harmonySynth) {
            padData.harmonySynth.volume.rampTo(db - 6, 0.1); // harmony stays quieter
        }
    }

    stopArpeggio(handId) {
        const padData = this.padSynths.get(handId);
        if (padData) {
            padData.synth.triggerRelease(Tone.now());
            if (padData.harmonySynth) padData.harmonySynth.triggerRelease(Tone.now());

            if (!this._pendingDisposals) this._pendingDisposals = new Set();
            const synths = [padData.synth, padData.harmonySynth].filter(Boolean);
            for (const synth of synths) {
                if (!this._pendingDisposals.has(synth)) {
                    this._pendingDisposals.add(synth);
                    setTimeout(() => {
                        try { synth.dispose(); } catch(e) { /* already disposed */ }
                        this._pendingDisposals.delete(synth);
                    }, 2000);
                }
            }
            this.padSynths.delete(handId);
            this.handVolumes.delete(handId);
            this.fingerCooldowns.delete(handId);
        }
    }

    // --- Gesture Processing (called per frame) ---

    updateGesture(handId, gestureData) {
        if (!this.isStarted) return;

        const {
            fingerStates,
            prevFingerStates,
            fingerVelocities,
            handVelocity,
            rootNote,
            volume
        } = gestureData;

        const now = performance.now();
        const cooldowns = this.fingerCooldowns.get(handId);
        if (!cooldowns) return;

        // --- Layer 2: Pluck notes on finger extension ---
        for (const finger of ['index', 'middle', 'ring', 'pinky']) {
            const justExtended = fingerStates[finger] && !prevFingerStates[finger];
            const offCooldown = (now - cooldowns[finger]) > this.FINGER_COOLDOWN_MS;

            if (justExtended && offCooldown) {
                cooldowns[finger] = now;

                // Calculate note: root + interval for this finger
                const rootFreq = Tone.Frequency(rootNote).toFrequency();
                const semitones = this.fingerIntervals[finger];
                const noteFreq = rootFreq * Math.pow(2, semitones / 12);
                const noteName = Tone.Frequency(noteFreq).toNote();

                // Velocity from finger movement speed
                const vel = Math.max(0.1, Math.min(0.8, (fingerVelocities[finger] || 0.3)));

                this.pluckSynth.triggerAttackRelease(noteName, '8n', Tone.now(), vel);
            }
        }

        // --- Layer 3: Percussive hits on sharp hand movement ---
        if ((now - this.percCooldown) > this.PERC_COOLDOWN_MS) {
            const vx = handVelocity?.x || 0;
            const vy = handVelocity?.y || 0;
            const magnitude = Math.sqrt(vx * vx + vy * vy);

            if (magnitude > this.HAND_VELOCITY_THRESHOLD) {
                this.percCooldown = now;

                if (vy > this.HAND_VELOCITY_THRESHOLD) {
                    // Downward movement -> kick thump
                    const intensity = Math.min(1, vy * 3);
                    this.kickSynth.triggerAttackRelease('C1', '8n', Tone.now(), intensity);
                } else if (Math.abs(vx) > this.HAND_VELOCITY_THRESHOLD) {
                    // Sideways movement -> hi-hat noise burst
                    const intensity = Math.min(1, Math.abs(vx) * 3);
                    this.hatSynth.triggerAttackRelease('16n', Tone.now(), intensity);
                }
            }
        }
    }

    // --- Finger Expression (effects modulation) ---

    updateFingerExpression(params) {
        if (!this.isStarted) return;

        const { middleFinger, ringFinger, pinkyFinger, handSpread } = params;

        // Middle finger -> reverb wet (subtle wash)
        if (this.reverb) {
            this.reverb.wet.value = 0.2 + middleFinger * 0.5;
        }

        // Ring finger -> delay feedback (echo amount)
        if (this.delay) {
            this.delay.feedback.value = 0.1 + ringFinger * 0.5;
        }

        // Pinky -> chorus rate (shimmer speed)
        if (this.chorus) {
            this.chorus.frequency.value = 1 + pinkyFinger * 8;
        }

        // Hand spread -> pad detune (wider = thicker)
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(handSpread * 30, 0.1);
        });
    }

    // --- Timbre Cycling ---

    cycleSynth() {
        if (!this.isStarted) return;

        // Store active pad states
        const activePads = [];
        this.padSynths.forEach((padData, handId) => {
            activePads.push({ handId, root: padData.currentRoot });
            padData.synth.triggerRelease(Tone.now());
            setTimeout(() => padData.synth.dispose(), 2000);
        });
        this.padSynths.clear();

        // Advance preset
        this.currentSynthIndex = (this.currentSynthIndex + 1) % this.padPresets.length;
        const preset = this.padPresets[this.currentSynthIndex];

        console.log(`Switched to pad preset ${this.currentSynthIndex}: ${preset.name}`);

        // Restart pads with new timbre
        setTimeout(() => {
            activePads.forEach(({ handId, root }) => {
                this.startArpeggio(handId, root);
            });
        }, 100);
    }

    // --- Proximity Filter ---

    setProximityFilter(value) {
        // value: 0 = far (dry/bright), 1 = close (wet/dark/filtered)
        // DRAMATIC sweep — should be very obvious
        if (this.filter) {
            // Sweep lowpass cutoff: 18000 Hz (far/bright) down to 300 Hz (close/muffled)
            var cutoff = 18000 * Math.pow(0.016, value); // exponential for musical response
            this.filter.frequency.rampTo(cutoff, 0.08);
        }
        if (this.reverb) {
            // More reverb when close (0.3 far → 0.85 close)
            this.reverb.wet.value = 0.3 + value * 0.55;
        }
        if (this.delay) {
            // More delay when close (0.1 far → 0.5 close)
            this.delay.wet.value = 0.1 + value * 0.4;
        }
        if (this.chorus) {
            this.chorus.depth = 0.2 + value * 0.8;
        }
    }

    getAnalyser() {
        return this.analyser;
    }
}
