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

        // Extended C Minor Pentatonic — super bassy low end, modest highs
        this.scale = [
            'C1', 'Eb1', 'G1', 'Bb1',
            'C2', 'Eb2', 'F2', 'G2', 'Bb2',
            'C3', 'Eb3', 'F3', 'G3', 'Bb3',
            'C4', 'Eb4', 'F4', 'G4', 'Bb4',
            'C5', 'Eb5', 'F5'
        ];

        // Pad timbre presets — psychedelic bass EDM
        this.padPresets = [
            {
                name: 'Hypnotic Sub',
                oscillator: { type: 'sine' },
                envelope: { attack: 0.4, decay: 0.5, sustain: 0.6, release: 0.5 }
            },
            {
                name: 'Acid Growl',
                oscillator: { type: 'sawtooth' },
                envelope: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.4 }
            },
            {
                name: 'Trance Wash',
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.5, decay: 0.6, sustain: 0.55, release: 0.6 }
            }
        ];
        this.currentSynthIndex = 0;
    }

    async start() {
        if (this.isStarted) return;

        await Tone.start();

        // === EFFECTS CHAIN: Psychedelic Bass EDM ===

        // Master limiter — protect speakers from bass peaks
        this.limiter = new Tone.Limiter(-3).toDestination();

        // Dark cavernous reverb
        this.reverb = new Tone.Reverb({
            decay: 6,
            preDelay: 0.03,
            wet: 0.35
        }).connect(this.limiter);

        // Ping-pong delay for hypnotic echoes
        this.delay = new Tone.PingPongDelay({
            delayTime: '8n.',
            feedback: 0.35,
            wet: 0.2
        }).connect(this.reverb);

        // Phaser for psychedelic swirl on pad
        this.phaser = new Tone.Phaser({
            frequency: 0.4,
            octaves: 3,
            baseFrequency: 400
        }).connect(this.reverb);

        // Chorus for width
        this.chorus = new Tone.Chorus({
            frequency: 2,
            delayTime: 4,
            depth: 0.7
        }).connect(this.phaser);
        this.chorus.start();

        // Lowpass filter for proximity control
        this.filter = new Tone.Filter(16000, 'lowpass').connect(this.chorus);

        // Analyser for visualization
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.reverb.connect(this.analyser);

        // === LAYER 2: Psychedelic Lead Pluck ===
        this.pluckSynth = new Tone.PolySynth(Tone.FMSynth, {
            maxPolyphony: 8,
            harmonicity: 2,
            modulationIndex: 3,
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.005,
                decay: 0.3,
                sustain: 0.02,
                release: 0.6
            },
            modulation: { type: 'sine' },
            modulationEnvelope: {
                attack: 0.005,
                decay: 0.2,
                sustain: 0.08,
                release: 1.0
            }
        });
        this.pluckSynth.connect(this.delay);
        this.pluckSynth.volume.value = -8;

        // === LAYER 3: Sub-Bass (always-on low foundation) ===
        this.subBass = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.3, decay: 0, sustain: 1, release: 0.8 }
        }).connect(this.limiter);  // sub goes direct — no effects muddying it
        this.subBass.volume.value = -18;

        // Sub-bass wobble LFO — gentle psychedelic pulse (not aggressive dubstep)
        this.wobbleLFO = new Tone.LFO({
            frequency: 0.3,
            min: -22,
            max: -12     // narrower range = less buzzy
        });
        this.wobbleLFO.connect(this.subBass.volume);
        this.wobbleLFO.start();

        // === LAYER 4: Heavy Percussion ===
        // Deep bass kick — heavy, with pitch sweep
        this.kickSynth = new Tone.MembraneSynth({
            pitchDecay: 0.08,
            octaves: 8,
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.001,
                decay: 0.5,
                sustain: 0,
                release: 0.5
            }
        }).connect(this.limiter);
        this.kickSynth.volume.value = -4;

        // Hi-hat — filtered noise burst
        this.hatSynth = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: {
                attack: 0.001,
                decay: 0.06,
                sustain: 0,
                release: 0.02
            }
        }).connect(this.limiter);
        this.hatSynth.volume.value = -12;

        this.isStarted = true;
        console.log('Psychedelic Bass EDM engine ready — gesture-driven, no clock.');
    }

    // --- Pad Management (Layer 1) ---

    startArpeggio(handId, rootNote) {
        if (!this.isStarted || this.padSynths.has(handId)) return;

        const preset = this.padPresets[this.currentSynthIndex];

        // Root pad voice — goes through filter → chorus → phaser → reverb
        const pad = new Tone.Synth({
            oscillator: { ...preset.oscillator },
            envelope: { ...preset.envelope }
        });
        pad.connect(this.filter);
        pad.volume.value = -10;

        // Harmony voice — detuned fifth for thick psychedelic texture
        const harmonyPad = new Tone.Synth({
            oscillator: { ...preset.oscillator },
            envelope: { ...preset.envelope }
        });
        harmonyPad.connect(this.filter);
        harmonyPad.volume.value = -16;

        // Start sustained tones
        const freq = Tone.Frequency(rootNote).toFrequency();
        pad.triggerAttack(freq, Tone.now());
        harmonyPad.triggerAttack(freq * 1.498, Tone.now());

        // Also trigger sub-bass at the root (one octave below for weight)
        if (this.subBass) {
            this.subBass.triggerAttack(freq / 2, Tone.now());
        }

        this.padSynths.set(handId, { synth: pad, harmonySynth: harmonyPad, currentRoot: rootNote });
        this.handVolumes.set(handId, 0.2);
        this.fingerCooldowns.set(handId, { index: 0, middle: 0, ring: 0, pinky: 0 });
    }

    updateArpeggio(handId, newRootNote) {
        const padData = this.padSynths.get(handId);
        if (!padData || padData.currentRoot === newRootNote) return;

        // Smooth portamento glide — all voices
        const freq = Tone.Frequency(newRootNote).toFrequency();
        padData.synth.frequency.rampTo(freq, 0.15);
        if (padData.harmonySynth) {
            padData.harmonySynth.frequency.rampTo(freq * 1.498, 0.15);
        }
        if (this.subBass) {
            this.subBass.frequency.rampTo(freq / 2, 0.2); // sub glides slower for weight
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
            // Release sub-bass when last pad stops
            if (this.padSynths.size <= 1 && this.subBass) {
                this.subBass.triggerRelease(Tone.now());
            }

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

        // Middle finger → phaser intensity (psychedelic swirl)
        if (this.phaser) {
            this.phaser.wet.value = 0.2 + middleFinger * 0.6;
        }

        // Ring finger → delay feedback (echo intensity)
        if (this.delay) {
            this.delay.feedback.value = 0.15 + ringFinger * 0.45;
        }

        // Pinky → reverb depth (space size)
        if (this.reverb) {
            this.reverb.wet.value = 0.2 + pinkyFinger * 0.4;
        }

        // Hand spread → wobble LFO speed (wider = faster wobble = aggressive bass)
        if (this.wobbleLFO) {
            this.wobbleLFO.frequency.value = 0.2 + handSpread * 6; // 0.2Hz slow → 6.2Hz fast wobble
        }

        // Hand spread also → pad detune (wider = thicker, more detuned)
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(handSpread * 40, 0.1);
            if (padData.harmonySynth) {
                padData.harmonySynth.detune.rampTo(-handSpread * 25, 0.1); // opposite detune = wide stereo
            }
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
        // value: 0 = far (dry/bright), 1 = close (wet/warm)
        // Gentle, musical sweep — noticeable but not harsh
        if (this.filter) {
            // Sweep lowpass: 16000 Hz (far) down to 1200 Hz (close) — not as extreme
            var cutoff = 16000 * Math.pow(0.075, value);
            this.filter.frequency.rampTo(cutoff, 0.2); // slower ramp = smoother
        }
        if (this.reverb) {
            this.reverb.wet.value = 0.3 + value * 0.3; // 0.3-0.6 (was 0.3-0.85)
        }
        if (this.delay) {
            this.delay.wet.value = 0.15 + value * 0.2; // 0.15-0.35 (was 0.1-0.5)
        }
        if (this.chorus) {
            this.chorus.depth = 0.4 + value * 0.4;
        }
    }

    // --- PANIC: kill ALL sound immediately ---
    panic() {
        // Stop all pads
        this.padSynths.forEach((padData, handId) => {
            try { padData.synth.triggerRelease(Tone.now()); } catch(e) {}
            try { if (padData.harmonySynth) padData.harmonySynth.triggerRelease(Tone.now()); } catch(e) {}
            setTimeout(() => {
                try { padData.synth.dispose(); } catch(e) {}
                try { if (padData.harmonySynth) padData.harmonySynth.dispose(); } catch(e) {}
            }, 500);
        });
        this.padSynths.clear();
        this.handVolumes.clear();
        this.fingerCooldowns.clear();

        // Stop sub-bass
        if (this.subBass) {
            try { this.subBass.triggerRelease(Tone.now()); } catch(e) {}
        }

        // Release all pluck notes
        if (this.pluckSynth) {
            try { this.pluckSynth.releaseAll(Tone.now()); } catch(e) {}
        }

        // Reset filter to open
        if (this.filter) {
            this.filter.frequency.value = 16000;
        }

        console.log('PANIC — all sound killed');
    }

    getAnalyser() {
        return this.analyser;
    }
}
