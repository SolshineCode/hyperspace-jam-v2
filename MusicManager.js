import * as Tone from 'https://esm.sh/tone';

// Psychedelic EDM Synth Engine — Comprehensive Hand-Distance Control
// Every finger's distance from palm continuously drives dramatic synth parameters
export class MusicManager {
    constructor() {
        this.padSynths = new Map();
        this.activePatterns = this.padSynths;

        this.reverb = null;
        this.delay = null;
        this.chorus = null;
        this.analyser = null;

        this.isStarted = false;
        this.handVolumes = new Map();
        this.fingerCooldowns = new Map();
        this.percCooldown = 0;

        this.FINGER_COOLDOWN_MS = 120;
        this.PERC_COOLDOWN_MS = 150;
        this.HAND_VELOCITY_THRESHOLD = 0.15;

        this.fingerIntervals = {
            index: 0, middle: 3, ring: 7, pinky: 10
        };

        // Extended C Minor Pentatonic
        this.scale = [
            'C1','Eb1','G1','Bb1','C2','Eb2','F2','G2','Bb2',
            'C3','Eb3','F3','G3','Bb3','C4','Eb4','F4','G4','Bb4','C5','Eb5','F5'
        ];

        this.padPresets = [
            { name: 'Hypnotic Sub', oscillator: { type: 'sine' }, envelope: { attack: 0.4, decay: 0.5, sustain: 0.6, release: 0.5 } },
            { name: 'Acid Growl', oscillator: { type: 'sawtooth' }, envelope: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.4 } },
            { name: 'Trance Wash', oscillator: { type: 'triangle' }, envelope: { attack: 0.5, decay: 0.6, sustain: 0.55, release: 0.6 } },
            { name: 'PWM Swirl', oscillator: { type: 'pwm', modulationFrequency: 0.5 }, envelope: { attack: 0.3, decay: 0.4, sustain: 0.7, release: 0.6 } },
            { name: 'Fat Square', oscillator: { type: 'fatsquare', spread: 30 }, envelope: { attack: 0.2, decay: 0.3, sustain: 0.6, release: 0.5 } }
        ];
        this.currentSynthIndex = 0;

        this._prevExtensions = {};
        this._prevDrumExtensions = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

        // Smoothed finger distances for continuous control (prevents jitter)
        this._smoothDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDrumDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._SMOOTH_ALPHA = 0.25; // smoothing factor
    }

    async start() {
        if (this.isStarted) return;
        await Tone.start();

        // === MASTER EFFECTS CHAIN ===
        this.limiter = new Tone.Limiter(-3).toDestination();

        // Dark reverb
        this.reverb = new Tone.Reverb({ decay: 6, preDelay: 0.03, wet: 0.35 }).connect(this.limiter);

        // Ping-pong delay
        this.delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.35, wet: 0.2 }).connect(this.reverb);

        // Chorus
        this.chorus = new Tone.Chorus({ frequency: 2, delayTime: 4, depth: 0.7 }).connect(this.reverb);
        this.chorus.start();

        // Master proximity filter
        this.filter = new Tone.Filter(16000, 'lowpass').connect(this.chorus);

        // Analyser for visualization
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.reverb.connect(this.analyser);

        // NOTE: Thumb + Index are volume control (pinch) — no continuous effects on them

        // === INDEX: Acid Squelch — continuously pitched, filter sweeps with distance ===
        this.fingerSynths = {};
        this.fingerSynths.index = new Tone.MonoSynth({
            oscillator: { type: 'sawtooth' },
            filter: { Q: 8, type: 'lowpass', rolloff: -24 },
            envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.3 },
            filterEnvelope: {
                attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.2,
                baseFrequency: 200, octaves: 4, exponent: 2
            }
        }).connect(this.delay);
        this.fingerSynths.index.volume.value = -4;

        // === MIDDLE: FM Chaos — distance controls modulation index (clean → insane) ===
        this.fingerSynths.middle = new Tone.FMSynth({
            harmonicity: 3,
            modulationIndex: 1,
            oscillator: { type: 'square' },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.3 },
            modulation: { type: 'sawtooth' },
            modulationEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.1 }
        }).connect(this.delay);
        this.fingerSynths.middle.volume.value = -6;

        // === RING: Shimmer Delay — distance controls delay time + feedback (tight → infinite) ===
        this.fingerSynths.ring = new Tone.MetalSynth({
            harmonicity: 12, modulationIndex: 24,
            resonance: 3000, octaves: 1.5,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 }
        }).connect(this.delay);
        this.fingerSynths.ring.volume.value = -8;

        // === PINKY: Sub Drop + Bitcrusher — distance controls crush depth ===
        this.bitcrusher = new Tone.BitCrusher({ bits: 16 }).connect(this.limiter);
        this.fingerSynths.pinky = new Tone.MembraneSynth({
            pitchDecay: 0.3, octaves: 6,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.5 }
        }).connect(this.bitcrusher);
        this.fingerSynths.pinky.volume.value = -2;

        // === CONTINUOUS SYNTHS (always sounding when hand present) ===
        // Only on middle/ring/pinky — NOT thumb/index (those are volume fingers)

        // Middle continuous: FM pad that gets chaotic with distance
        this.middleContinuous = new Tone.FMSynth({
            harmonicity: 2, modulationIndex: 0.5,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.4, decay: 0, sustain: 1, release: 0.6 },
            modulation: { type: 'triangle' },
            modulationEnvelope: { attack: 0.4, decay: 0, sustain: 1, release: 0.6 }
        }).connect(this.chorus);
        this.middleContinuous.volume.value = -20;

        // === DRUM HAND SYNTHS (hand 1) ===
        this.drumFingerSynths = {};

        // Index: Kick
        this.drumFingerSynths.index = new Tone.MembraneSynth({
            pitchDecay: 0.08, octaves: 8,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 }
        }).connect(this.limiter);
        this.drumFingerSynths.index.volume.value = -4;

        // Middle: Sci-Fi Riser
        this.drumFingerSynths.middle = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.05, decay: 0.6, sustain: 0, release: 0.3 }
        });
        this._riserFilter = new Tone.AutoFilter({
            frequency: 4, baseFrequency: 200, octaves: 6,
            filter: { type: 'bandpass', Q: 2 }
        }).connect(this.delay);
        this._riserFilter.start();
        this.drumFingerSynths.middle.connect(this._riserFilter);
        this.drumFingerSynths.middle.volume.value = -8;

        // Ring: Granular Stutter
        this.drumFingerSynths.ring = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 }
        }).connect(this.limiter);
        this.drumFingerSynths.ring.volume.value = -10;

        // Pinky: Reverb Crash
        this._crashReverb = new Tone.Reverb({ decay: 8, preDelay: 0.01, wet: 0.9 }).connect(this.limiter);
        this.drumFingerSynths.pinky = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 }
        }).connect(this._crashReverb);
        this.drumFingerSynths.pinky.volume.value = -6;

        // Thumb: Drum hand thumb = tempo wobble synth
        this.drumThumbSynth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.2 }
        }).connect(this.limiter);
        this.drumThumbSynth.volume.value = -10;

        // Legacy references
        this.kickSynth = this.drumFingerSynths.index;
        this.hatSynth = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 }
        }).connect(this.limiter);
        this.hatSynth.volume.value = -12;
        this.pluckSynth = { releaseAll: () => {} };

        // === SUB-BASS ===
        this.subBass = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.3, decay: 0, sustain: 1, release: 0.8 }
        }).connect(this.limiter);
        this.subBass.volume.value = -18;

        this.wobbleLFO = new Tone.LFO({ frequency: 0.3, min: -22, max: -12 });
        this.wobbleLFO.connect(this.subBass.volume);
        this.wobbleLFO.start();

        // Track continuous synth state
        this._continuousActive = false;

        this.isStarted = true;
        console.log('Psychedelic EDM engine v2 ready — 10-finger distance-from-palm control');
    }

    // --- Smoothing helper ---
    _smooth(target, key, raw) {
        target[key] += (raw - target[key]) * this._SMOOTH_ALPHA;
        return target[key];
    }

    // --- Pad Management ---

    startArpeggio(handId, rootNote) {
        if (!this.isStarted || this.padSynths.has(handId) || this._panicMuted) return;

        const preset = this.padPresets[this.currentSynthIndex];
        const pad = new Tone.Synth({
            oscillator: { ...preset.oscillator },
            envelope: { ...preset.envelope }
        });
        pad.connect(this.filter);
        pad.volume.value = -10;

        const harmonyPad = new Tone.Synth({
            oscillator: { ...preset.oscillator },
            envelope: { ...preset.envelope }
        });
        harmonyPad.connect(this.filter);
        harmonyPad.volume.value = -16;

        const freq = Tone.Frequency(rootNote).toFrequency();
        pad.triggerAttack(freq, Tone.now());
        harmonyPad.triggerAttack(freq * 1.498, Tone.now());

        if (this.subBass) this.subBass.triggerAttack(freq / 2, Tone.now());

        this.padSynths.set(handId, { synth: pad, harmonySynth: harmonyPad, currentRoot: rootNote });
        this.handVolumes.set(handId, 0.2);
        this.fingerCooldowns.set(handId, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });

        // Start continuous synths (middle only — thumb/index are volume fingers)
        if (!this._continuousActive) {
            this._continuousActive = true;
            try {
                this.middleContinuous.triggerAttack(freq * 1.498, Tone.now());
            } catch(e) {}
        }
    }

    updateArpeggio(handId, newRootNote) {
        const padData = this.padSynths.get(handId);
        if (!padData || padData.currentRoot === newRootNote) return;

        const freq = Tone.Frequency(newRootNote).toFrequency();
        padData.synth.frequency.rampTo(freq, 0.15);
        if (padData.harmonySynth) padData.harmonySynth.frequency.rampTo(freq * 1.498, 0.15);
        if (this.subBass) this.subBass.frequency.rampTo(freq / 2, 0.2);

        // Update continuous synth to track root
        try {
            if (this.middleContinuous) this.middleContinuous.frequency.rampTo(freq * 1.498, 0.2);
        } catch(e) {}

        padData.currentRoot = newRootNote;
    }

    updateArpeggioVolume(handId, velocity) {
        const padData = this.padSynths.get(handId);
        if (!padData) return;

        const clamped = Math.max(0, Math.min(1, velocity));
        this.handVolumes.set(handId, clamped);
        const db = -30 + clamped * 26;
        padData.synth.volume.rampTo(db, 0.1);
        if (padData.harmonySynth) padData.harmonySynth.volume.rampTo(db - 6, 0.1);
    }

    stopArpeggio(handId) {
        const padData = this.padSynths.get(handId);
        if (padData) {
            padData.synth.triggerRelease(Tone.now());
            if (padData.harmonySynth) padData.harmonySynth.triggerRelease(Tone.now());
            if (this.padSynths.size <= 1 && this.subBass) {
                this.subBass.triggerRelease(Tone.now());
            }

            // Release continuous synths
            if (this.padSynths.size <= 1) {
                this._continuousActive = false;
                try { this.middleContinuous.triggerRelease(Tone.now()); } catch(e) {}
            }

            if (!this._pendingDisposals) this._pendingDisposals = new Set();
            const synths = [padData.synth, padData.harmonySynth].filter(Boolean);
            for (const synth of synths) {
                if (!this._pendingDisposals.has(synth)) {
                    this._pendingDisposals.add(synth);
                    setTimeout(() => {
                        try { synth.dispose(); } catch(e) {}
                        this._pendingDisposals.delete(synth);
                    }, 2000);
                }
            }
            this.padSynths.delete(handId);
            this.handVolumes.delete(handId);
            this.fingerCooldowns.delete(handId);
        }
    }

    // --- SYNTH HAND (hand 0): Comprehensive Distance-from-Palm Control ---
    // Each finger's distance ratio (0=curled to palm, 1=fully extended) CONTINUOUSLY
    // drives dramatic parameter changes. Triggers still fire on transitions.

    updateGesture(handId, gestureData) {
        if (!this.isStarted || this._panicMuted) return;

        const { fingerStates, handVelocity, rootNote } = gestureData;
        const now = performance.now();
        const cooldowns = this.fingerCooldowns.get(handId);
        if (!cooldowns) return;

        if (!this._prevExtensions[handId]) {
            this._prevExtensions[handId] = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        }
        const prevExt = this._prevExtensions[handId];

        // Use fingerDistances (Euclidean from palm) as primary control, fall back to extensions
        const dist = gestureData.fingerDistances || gestureData.fingerExtensions || {
            thumb: 0.1, index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.1
        };

        // Smooth all distances to prevent jitter
        const d = {};
        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
            d[f] = this._smooth(this._smoothDist, f, dist[f] || 0);
        }

        const rootFreq = Tone.Frequency(rootNote).toFrequency();

        // ====================================================================
        // THUMB + INDEX: These are the VOLUME CONTROL fingers (pinch distance)
        // Do NOT assign continuous effects here — they'd be forced on whenever
        // volume is up. Only trigger one-shots on curl→extend transitions.
        // ====================================================================

        // INDEX: Acid Squelch — trigger only (no continuous filter tied to distance)
        if (this.fingerSynths.index) {
            if (prevExt.index < 0.2 && d.index > 0.35 && (now - cooldowns.index) > this.FINGER_COOLDOWN_MS) {
                cooldowns.index = now;
                this.fingerSynths.index.triggerAttackRelease(
                    Tone.Frequency(rootFreq).toNote(), '4n', Tone.now(), 0.8
                );
            }
        }

        // ====================================================================
        // MIDDLE: FM Chaos — Distance = modulation index (0.5→40)
        // Close = clean tone, extended = insane FM screeching
        // ====================================================================
        if (this.fingerSynths.middle) {
            try {
                this.fingerSynths.middle.modulationIndex.value = 0.5 + Math.pow(d.middle, 2) * 40;
                this.fingerSynths.middle.harmonicity.value = 2 + d.middle * 10;
            } catch(e) {}

            if (prevExt.middle < 0.2 && d.middle > 0.35 && (now - cooldowns.middle) > this.FINGER_COOLDOWN_MS) {
                cooldowns.middle = now;
                const zapFreq = rootFreq * Math.pow(2, 3/12);
                this.fingerSynths.middle.triggerAttackRelease(
                    Tone.Frequency(zapFreq).toNote(), '8n', Tone.now(), 0.9
                );
            }
        }
        // Continuous FM pad
        if (this.middleContinuous) {
            try {
                this.middleContinuous.modulationIndex.value = 0.2 + Math.pow(d.middle, 2) * 15;
                this.middleContinuous.volume.rampTo(-28 + d.middle * 14, 0.05);
            } catch(e) {}
        }

        // ====================================================================
        // RING: Shimmer/Delay — Distance = delay feedback + time warping
        // Close = dry/tight, extended = infinite echoing shimmer
        // ====================================================================
        if (this.fingerSynths.ring) {
            if (prevExt.ring < 0.2 && d.ring > 0.35 && (now - cooldowns.ring) > this.FINGER_COOLDOWN_MS) {
                cooldowns.ring = now;
                const chimeFreq = rootFreq * Math.pow(2, 7/12);
                this.fingerSynths.ring.triggerAttackRelease(chimeFreq, '4n', Tone.now(), 0.8);
            }
        }
        if (this.delay) {
            this.delay.feedback.value = 0.1 + d.ring * 0.65;
            this.delay.wet.value = 0.05 + d.ring * 0.5;
            // Modulate delay time subtly for chorus-like shimmer
            try {
                const delayMod = 0.15 + d.ring * 0.15; // 8th note dotted range
                this.delay.delayTime.value = delayMod;
            } catch(e) {}
        }

        // ====================================================================
        // PINKY: Sub Drop + Bitcrusher — Distance = crush bits + reverb intensity
        // Close = clean sub, extended = destroyed/crushed + massive reverb
        // ====================================================================
        if (this.fingerSynths.pinky) {
            if (prevExt.pinky < 0.2 && d.pinky > 0.35 && (now - cooldowns.pinky) > this.FINGER_COOLDOWN_MS) {
                cooldowns.pinky = now;
                this.fingerSynths.pinky.triggerAttackRelease('C1', '4n', Tone.now(), 0.9);
            }
        }
        if (this.bitcrusher) {
            // 16 bits (clean) → 2 bits (destroyed)
            this.bitcrusher.bits.value = Math.max(2, Math.round(16 - d.pinky * 14));
        }
        if (this.reverb) {
            this.reverb.wet.value = 0.15 + d.pinky * 0.55;
        }

        // ====================================================================
        // COMBINED: Hand spread → chorus + detuning + wobble speed
        // ====================================================================
        const spread = gestureData.handSpread || 0;
        if (this.chorus) {
            this.chorus.depth = 0.3 + spread * 0.7;
            this.chorus.frequency.value = 1 + spread * 4;
        }
        if (this.wobbleLFO) {
            this.wobbleLFO.frequency.value = 0.2 + spread * 8;
        }
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(spread * 50, 0.1);
            if (padData.harmonySynth) padData.harmonySynth.detune.rampTo(-spread * 30, 0.1);
        });

        // Store for next frame
        prevExt.thumb = d.thumb;
        prevExt.index = d.index;
        prevExt.middle = d.middle;
        prevExt.ring = d.ring;
        prevExt.pinky = d.pinky;

        // Percussive hits on sharp hand movement
        if ((now - this.percCooldown) > this.PERC_COOLDOWN_MS) {
            const vx = handVelocity?.x || 0;
            const vy = handVelocity?.y || 0;
            const magnitude = Math.sqrt(vx * vx + vy * vy);
            if (magnitude > this.HAND_VELOCITY_THRESHOLD) {
                this.percCooldown = now;
                if (vy > this.HAND_VELOCITY_THRESHOLD) {
                    this.kickSynth.triggerAttackRelease('C1', '8n', Tone.now(), Math.min(1, vy * 3));
                } else if (Math.abs(vx) > this.HAND_VELOCITY_THRESHOLD) {
                    this.hatSynth.triggerAttackRelease('16n', Tone.now(), Math.min(1, Math.abs(vx) * 3));
                }
            }
        }
    }

    // --- DRUM HAND (hand 1): Distance-from-Palm Control ---

    updateDrumGesture(gestureData) {
        if (!this.isStarted || this._panicMuted) return;

        const now = performance.now();
        const prevExt = this._prevDrumExtensions;
        const cooldowns = this._drumFingerCooldowns;

        const dist = gestureData.fingerDistances || gestureData.fingerExtensions || {
            thumb: 0.1, index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.1
        };

        const d = {};
        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
            d[f] = this._smooth(this._smoothDrumDist, f, dist[f] || 0);
        }

        // THUMB: Tempo wobble — distance triggers rhythmic tom hits at varying pitch
        if (this.drumThumbSynth) {
            if (prevExt.thumb < 0.2 && d.thumb > 0.35 && (now - (cooldowns.thumb || 0)) > 200) {
                cooldowns.thumb = now;
                const pitch = 60 + d.thumb * 200; // Hz
                this.drumThumbSynth.triggerAttackRelease(pitch, '16n', Tone.now(), 0.7);
            }
        }

        // INDEX: Kick — distance controls pitch decay depth
        if (this.drumFingerSynths.index) {
            try {
                this.drumFingerSynths.index.pitchDecay = 0.02 + d.index * 0.2;
                this.drumFingerSynths.index.octaves = 4 + d.index * 6;
            } catch(e) {}
            if (prevExt.index < 0.2 && d.index > 0.35 && (now - cooldowns.index) > this.FINGER_COOLDOWN_MS) {
                cooldowns.index = now;
                this.drumFingerSynths.index.triggerAttackRelease('C1', '8n', Tone.now(), 0.9);
            }
        }

        // MIDDLE: Riser — distance = filter sweep position
        if (this._riserFilter) {
            this._riserFilter.baseFrequency = 100 + d.middle * 4000;
            this._riserFilter.octaves = 2 + d.middle * 6;
        }
        if (this.drumFingerSynths.middle) {
            if (prevExt.middle < 0.2 && d.middle > 0.35 && (now - cooldowns.middle) > 200) {
                cooldowns.middle = now;
                this.drumFingerSynths.middle.triggerAttackRelease('4n', Tone.now(), 0.7);
            }
        }

        // RING: Stutter — distance controls burst count and speed
        if (this.drumFingerSynths.ring) {
            if (prevExt.ring < 0.2 && d.ring > 0.35 && (now - cooldowns.ring) > 250) {
                cooldowns.ring = now;
                const burstCount = Math.round(2 + d.ring * 8); // 2→10 hits
                const burstSpeed = Math.max(15, 60 - d.ring * 40); // ms between hits
                for (let j = 0; j < burstCount; j++) {
                    setTimeout(() => {
                        try { this.drumFingerSynths.ring.triggerAttackRelease('64n', Tone.now(), 0.6); } catch(e) {}
                    }, j * burstSpeed);
                }
            }
        }

        // PINKY: Reverb Crash — distance = reverb size + wet
        if (this._crashReverb) {
            this._crashReverb.wet.value = 0.3 + d.pinky * 0.7;
        }
        if (this.drumFingerSynths.pinky) {
            if (prevExt.pinky < 0.2 && d.pinky > 0.35 && (now - cooldowns.pinky) > 300) {
                cooldowns.pinky = now;
                this.drumFingerSynths.pinky.triggerAttackRelease('8n', Tone.now(), 0.8);
            }
        }

        // CONTINUOUS: chorus from average drum distance
        const avgDist = (d.index + d.middle + d.ring + d.pinky) / 4;
        if (this.chorus) {
            this.chorus.depth = 0.3 + avgDist * 0.7;
        }

        prevExt.thumb = d.thumb;
        prevExt.index = d.index;
        prevExt.middle = d.middle;
        prevExt.ring = d.ring;
        prevExt.pinky = d.pinky;
    }

    // --- Finger Expression (legacy + enhanced) ---

    updateFingerExpression(params) {
        if (!this.isStarted) return;

        const { fingerDistances, middleFinger, ringFinger, pinkyFinger, handSpread } = params;

        // Hand spread → wobble LFO speed + pad detune
        if (this.wobbleLFO) {
            this.wobbleLFO.frequency.value = 0.2 + handSpread * 6;
        }
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(handSpread * 40, 0.1);
            if (padData.harmonySynth) padData.harmonySynth.detune.rampTo(-handSpread * 25, 0.1);
        });
    }

    // --- Timbre Cycling ---

    cycleSynth() {
        if (!this.isStarted) return;

        const activePads = [];
        this.padSynths.forEach((padData, handId) => {
            activePads.push({ handId, root: padData.currentRoot });
            padData.synth.triggerRelease(Tone.now());
            setTimeout(() => padData.synth.dispose(), 2000);
        });
        this.padSynths.clear();

        this.currentSynthIndex = (this.currentSynthIndex + 1) % this.padPresets.length;
        const preset = this.padPresets[this.currentSynthIndex];

        console.log(`Switched to pad preset ${this.currentSynthIndex}: ${preset.name}`);

        setTimeout(() => {
            activePads.forEach(({ handId, root }) => {
                this.startArpeggio(handId, root);
            });
        }, 100);
    }

    // --- Proximity Filter ---

    setProximityFilter(value) {
        if (this.filter) {
            const cutoff = 16000 * Math.pow(0.075, value);
            this.filter.frequency.rampTo(cutoff, 0.2);
        }
        if (this.reverb) this.reverb.wet.value = 0.3 + value * 0.3;
        if (this.delay) this.delay.wet.value = 0.15 + value * 0.2;
        if (this.chorus) this.chorus.depth = 0.4 + value * 0.4;
    }

    // --- PANIC ---

    panic() {
        this._panicMuted = true;
        setTimeout(() => { this._panicMuted = false; }, 1000);

        this.padSynths.forEach((padData) => {
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

        if (this.subBass) try { this.subBass.triggerRelease(Tone.now()); } catch(e) {}

        // Release continuous synths
        try { this.middleContinuous.triggerRelease(Tone.now()); } catch(e) {}
        this._continuousActive = false;

        if (this.fingerSynths) {
            for (const finger of ['index', 'middle', 'ring', 'pinky']) {
                try { this.fingerSynths[finger].triggerRelease(Tone.now()); } catch(e) {}
            }
        }
        if (this.drumFingerSynths) {
            for (const finger of ['index', 'middle', 'ring', 'pinky']) {
                try { this.drumFingerSynths[finger].triggerRelease(Tone.now()); } catch(e) {}
            }
        }

        if (this.wobbleLFO) {
            this.wobbleLFO.stop();
            setTimeout(() => { try { this.wobbleLFO.start(); } catch(e) {} }, 1000);
        }

        if (this.filter) this.filter.frequency.value = 16000;
        if (this.reverb) this.reverb.wet.value = 0.35;
        if (this.delay) this.delay.wet.value = 0.2;
        if (this.chorus) this.chorus.depth = 0.6;
        if (this.bitcrusher) this.bitcrusher.bits.value = 16;

        this._prevDrumExtensions = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDrumDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

        console.log('PANIC — all sound killed, muted for 1 second');
    }

    getAnalyser() {
        return this.analyser;
    }
}
