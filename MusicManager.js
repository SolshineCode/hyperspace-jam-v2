import * as Tone from 'https://esm.sh/tone';

// Gesture-Driven Music Engine for Hyperspace Jam
// Every finger on both hands produces a unique, radically different sound
export class MusicManager {
    constructor() {
        // Synths
        this.padSynths = new Map();      // handId -> { synth, harmonySynth, currentRoot }
        this.activePatterns = this.padSynths; // backward compat — game.js checks .activePatterns.has(i)

        // Effects
        this.reverb = null;
        this.delay = null;
        this.chorus = null;
        this.analyser = null;

        // State tracking
        this.isStarted = false;
        this.handVolumes = new Map();
        this.fingerCooldowns = new Map();
        this.percCooldown = 0;

        this.FINGER_COOLDOWN_MS = 120;
        this.PERC_COOLDOWN_MS = 150;
        this.HAND_VELOCITY_THRESHOLD = 0.15;

        // Finger -> semitone interval mapping for synth hand melodic triggers
        this.fingerIntervals = {
            index: 0,    // root
            middle: 3,   // minor third
            ring: 7,     // perfect fifth
            pinky: 10    // minor seventh
        };

        // Extended C Minor Pentatonic scale
        this.scale = [
            'C1', 'Eb1', 'G1', 'Bb1',
            'C2', 'Eb2', 'F2', 'G2', 'Bb2',
            'C3', 'Eb3', 'F3', 'G3', 'Bb3',
            'C4', 'Eb4', 'F4', 'G4', 'Bb4',
            'C5', 'Eb5', 'F5'
        ];

        // Pad timbre presets
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

        // Previous extension tracking for both hands
        this._prevExtensions = {};
        this._prevDrumExtensions = { index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { index: 0, middle: 0, ring: 0, pinky: 0 };
    }

    async start() {
        if (this.isStarted) return;

        await Tone.start();

        // === EFFECTS CHAIN ===

        // Master limiter
        this.limiter = new Tone.Limiter(-3).toDestination();

        // Dark cavernous reverb
        this.reverb = new Tone.Reverb({
            decay: 6,
            preDelay: 0.03,
            wet: 0.35
        }).connect(this.limiter);

        // Ping-pong delay for finger synths
        this.delay = new Tone.PingPongDelay({
            delayTime: '8n.',
            feedback: 0.35,
            wet: 0.2
        }).connect(this.reverb);

        // Chorus for pad width (no Phaser — CPU savings)
        this.chorus = new Tone.Chorus({
            frequency: 2,
            delayTime: 4,
            depth: 0.7
        }).connect(this.reverb);
        this.chorus.start();

        // Lowpass filter for proximity control (pad chain)
        this.filter = new Tone.Filter(16000, 'lowpass').connect(this.chorus);

        // Analyser for visualization — taps reverb output
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.reverb.connect(this.analyser);

        // === HAND 1 FINGER SYNTHS (Synth Hand — i===0) ===

        this.fingerSynths = {};

        // INDEX: "Acid Squelch" — MonoSynth with sawtooth + filter sweep
        this.fingerSynths.index = new Tone.MonoSynth({
            oscillator: { type: 'sawtooth' },
            filter: {
                Q: 8,
                type: 'lowpass',
                rolloff: -24
            },
            envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 },
            filterEnvelope: {
                attack: 0.001,
                decay: 0.15,
                sustain: 0.05,
                release: 0.2,
                baseFrequency: 200,
                octaves: 4,
                exponent: 2
            }
        }).connect(this.delay);
        this.fingerSynths.index.volume.value = -4;

        // MIDDLE: "Laser Zap" — FMSynth with extreme modulation, fast pitch sweep
        this.fingerSynths.middle = new Tone.FMSynth({
            harmonicity: 8,
            modulationIndex: 25,
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
            modulation: { type: 'sawtooth' },
            modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }
        }).connect(this.delay);
        this.fingerSynths.middle.volume.value = -6;

        // RING: "Crystal Chime" — MetalSynth, bright bell
        this.fingerSynths.ring = new Tone.MetalSynth({
            harmonicity: 12,
            modulationIndex: 24,
            resonance: 3000,
            octaves: 1.5,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 }
        }).connect(this.delay);
        this.fingerSynths.ring.volume.value = -8;

        // PINKY: "Sub Drop" — MembraneSynth with long pitch decay
        this.fingerSynths.pinky = new Tone.MembraneSynth({
            pitchDecay: 0.3,
            octaves: 6,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.5 }
        }).connect(this.limiter); // sub direct — no delay/reverb muddying
        this.fingerSynths.pinky.volume.value = -2;

        // === HAND 2 FINGER SYNTHS (Drum Hand — i===1) ===

        this.drumFingerSynths = {};

        // INDEX: Kick — deep membrane hit (same as before but dedicated to drum hand)
        this.drumFingerSynths.index = new Tone.MembraneSynth({
            pitchDecay: 0.08,
            octaves: 8,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 }
        }).connect(this.limiter); // percussion direct
        this.drumFingerSynths.index.volume.value = -4;

        // MIDDLE: "Sci-Fi Riser" — noise with filter sweeping UP
        this.drumFingerSynths.middle = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.05, decay: 0.6, sustain: 0, release: 0.3 }
        });
        this._riserFilter = new Tone.AutoFilter({
            frequency: 4,
            baseFrequency: 200,
            octaves: 6,
            filter: { type: 'bandpass', Q: 2 }
        }).connect(this.delay);
        this._riserFilter.start();
        this.drumFingerSynths.middle.connect(this._riserFilter);
        this.drumFingerSynths.middle.volume.value = -8;

        // RING: "Granular Stutter" — rapid burst noise hits
        this.drumFingerSynths.ring = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 }
        }).connect(this.limiter); // percussion direct, punchy
        this.drumFingerSynths.ring.volume.value = -10;

        // PINKY: "Reverb Crash" — noise hit into massive reverb
        this._crashReverb = new Tone.Reverb({
            decay: 8,
            preDelay: 0.01,
            wet: 0.9
        }).connect(this.limiter);
        this.drumFingerSynths.pinky = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 }
        }).connect(this._crashReverb);
        this.drumFingerSynths.pinky.volume.value = -6;

        // Keep legacy references for backward compat
        this.kickSynth = this.drumFingerSynths.index;
        this.hatSynth = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 }
        }).connect(this.limiter);
        this.hatSynth.volume.value = -12;
        this.pluckSynth = { releaseAll: () => {} };

        // === SUB-BASS (always-on low foundation) ===
        this.subBass = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.3, decay: 0, sustain: 1, release: 0.8 }
        }).connect(this.limiter); // sub direct
        this.subBass.volume.value = -18;

        // Sub-bass wobble LFO
        this.wobbleLFO = new Tone.LFO({
            frequency: 0.3,
            min: -22,
            max: -12
        });
        this.wobbleLFO.connect(this.subBass.volume);
        this.wobbleLFO.start();

        this.isStarted = true;
        console.log('Psychedelic Bass EDM engine ready — 10-finger unique sounds, gesture-driven.');
    }

    // --- Pad Management (Layer 1) ---

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

        const freq = Tone.Frequency(newRootNote).toFrequency();
        padData.synth.frequency.rampTo(freq, 0.15);
        if (padData.harmonySynth) {
            padData.harmonySynth.frequency.rampTo(freq * 1.498, 0.15);
        }
        if (this.subBass) {
            this.subBass.frequency.rampTo(freq / 2, 0.2);
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
            padData.harmonySynth.volume.rampTo(db - 6, 0.1);
        }
    }

    stopArpeggio(handId) {
        const padData = this.padSynths.get(handId);
        if (padData) {
            padData.synth.triggerRelease(Tone.now());
            if (padData.harmonySynth) padData.harmonySynth.triggerRelease(Tone.now());
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

    // --- Gesture Processing: Synth Hand (hand 0) ---
    // HYBRID: triggers on curl→extend PLUS continuous modulation from extension amount
    // Every finger ALWAYS changes the sound when extended — impossible to not hear it

    updateGesture(handId, gestureData) {
        if (!this.isStarted || this._panicMuted) return;

        const { fingerStates, handVelocity, rootNote } = gestureData;

        const now = performance.now();
        const cooldowns = this.fingerCooldowns.get(handId);
        if (!cooldowns) return;

        if (!this._prevExtensions[handId]) {
            this._prevExtensions[handId] = { index: 0, middle: 0, ring: 0, pinky: 0 };
        }
        const prevExt = this._prevExtensions[handId];

        const ext = gestureData.fingerExtensions || {
            index: fingerStates.index ? 0.8 : 0.1,
            middle: fingerStates.middle ? 0.8 : 0.1,
            ring: fingerStates.ring ? 0.8 : 0.1,
            pinky: fingerStates.pinky ? 0.8 : 0.1
        };

        const rootFreq = Tone.Frequency(rootNote).toFrequency();

        // === INDEX: Acid Squelch — CONTINUOUS filter cutoff from extension ===
        if (this.fingerSynths.index) {
            try {
                const cutoff = 200 + ext.index * 4000;
                this.fingerSynths.index.filter.frequency.value = cutoff;
            } catch(e) {}
            // Trigger on curl→extend transition
            if (prevExt.index < 0.2 && ext.index > 0.35 && (now - cooldowns.index) > this.FINGER_COOLDOWN_MS) {
                cooldowns.index = now;
                this.fingerSynths.index.triggerAttackRelease(
                    Tone.Frequency(rootFreq).toNote(), '4n', Tone.now(), 0.8
                );
            }
        }

        // === MIDDLE: Laser Zap — trigger only, no continuous volume ramp ===
        if (this.fingerSynths.middle) {
            // Trigger on transition
            if (prevExt.middle < 0.2 && ext.middle > 0.35 && (now - cooldowns.middle) > this.FINGER_COOLDOWN_MS) {
                cooldowns.middle = now;
                const zapFreq = rootFreq * Math.pow(2, 3/12); // minor 3rd
                this.fingerSynths.middle.triggerAttackRelease(
                    Tone.Frequency(zapFreq).toNote(), '8n', Tone.now(), 0.9
                );
            }
        }

        // === RING: Crystal Chime — trigger only ===
        if (this.fingerSynths.ring) {
            // Trigger on transition
            if (prevExt.ring < 0.2 && ext.ring > 0.35 && (now - cooldowns.ring) > this.FINGER_COOLDOWN_MS) {
                cooldowns.ring = now;
                const chimeFreq = rootFreq * Math.pow(2, 7/12); // 5th
                this.fingerSynths.ring.triggerAttackRelease(chimeFreq, '4n', Tone.now(), 0.8);
            }
        }

        // === PINKY: Sub Drop — extension controls pitch bend depth ===
        if (this.fingerSynths.pinky) {
            // Trigger on transition — always very audible
            if (prevExt.pinky < 0.2 && ext.pinky > 0.35 && (now - cooldowns.pinky) > this.FINGER_COOLDOWN_MS) {
                cooldowns.pinky = now;
                this.fingerSynths.pinky.triggerAttackRelease('C1', '4n', Tone.now(), 0.9);
            }
        }

        // === CONTINUOUS: Delay wet amount from average finger extension ===
        try {
            const avgExt = (ext.index + ext.middle + ext.ring + ext.pinky) / 4;
            if (this.delay && isFinite(avgExt)) {
                this.delay.wet.value = 0.05 + Math.max(0, Math.min(1, avgExt)) * 0.4;
            }
        } catch(e) {}

        // Store for next frame
        prevExt.index = ext.index;
        prevExt.middle = ext.middle;
        prevExt.ring = ext.ring;
        prevExt.pinky = ext.pinky;

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

    // --- Gesture Processing: Drum Hand (hand 1) ---
    // HYBRID: triggers PLUS continuous modulation — every finger always does something

    updateDrumGesture(gestureData) {
        if (!this.isStarted || this._panicMuted) return;

        const now = performance.now();
        const prevExt = this._prevDrumExtensions;
        const cooldowns = this._drumFingerCooldowns;

        const fingerStates = gestureData.fingerStates || {};
        const ext = gestureData.fingerExtensions || {
            index: fingerStates.index ? 0.8 : 0.1,
            middle: fingerStates.middle ? 0.8 : 0.1,
            ring: fingerStates.ring ? 0.8 : 0.1,
            pinky: fingerStates.pinky ? 0.8 : 0.1
        };

        // === INDEX: Kick — trigger + continuous volume ===
        if (this.drumFingerSynths.index) {
            if (prevExt.index < 0.2 && ext.index > 0.35 && (now - cooldowns.index) > this.FINGER_COOLDOWN_MS) {
                cooldowns.index = now;
                this.drumFingerSynths.index.triggerAttackRelease('C1', '8n', Tone.now(), 0.9);
            }
        }

        // === MIDDLE: Riser — continuous: extension controls filter sweep position ===
        if (this._riserFilter) {
            this._riserFilter.baseFrequency = 100 + ext.middle * 3000;
        }
        if (this.drumFingerSynths.middle) {
            if (prevExt.middle < 0.2 && ext.middle > 0.35 && (now - cooldowns.middle) > 200) {
                cooldowns.middle = now;
                this.drumFingerSynths.middle.triggerAttackRelease('4n', Tone.now(), 0.7);
            }
        }

        // === RING: Stutter — trigger rapid hits ===
        if (this.drumFingerSynths.ring) {
            if (prevExt.ring < 0.2 && ext.ring > 0.35 && (now - cooldowns.ring) > 250) {
                cooldowns.ring = now;
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        try { this.drumFingerSynths.ring.triggerAttackRelease('64n', Tone.now(), 0.6); } catch(e) {}
                    }, i * 45);
                }
            }
        }

        // === PINKY: Reverb Crash — trigger + continuous reverb tail amount ===
        if (this._crashReverb) {
            this._crashReverb.wet.value = 0.5 + ext.pinky * 0.5;
        }
        if (this.drumFingerSynths.pinky) {
            if (prevExt.pinky < 0.2 && ext.pinky > 0.35 && (now - cooldowns.pinky) > 300) {
                cooldowns.pinky = now;
                this.drumFingerSynths.pinky.triggerAttackRelease('8n', Tone.now(), 0.8);
            }
        }

        // === CONTINUOUS: chorus depth from average drum hand extension ===
        const avgDrumExt = (ext.index + ext.middle + ext.ring + ext.pinky) / 4;
        if (this.chorus) {
            this.chorus.depth = 0.3 + avgDrumExt * 0.7;
        }

        prevExt.index = ext.index;
        prevExt.middle = ext.middle;
        prevExt.ring = ext.ring;
        prevExt.pinky = ext.pinky;
    }

    // --- Finger Expression (effects modulation) ---

    updateFingerExpression(params) {
        if (!this.isStarted) return;

        const { middleFinger, ringFinger, pinkyFinger, handSpread } = params;

        // Ring finger -> delay feedback
        if (this.delay) {
            this.delay.feedback.value = 0.15 + ringFinger * 0.45;
        }

        // Pinky -> reverb depth
        if (this.reverb) {
            this.reverb.wet.value = 0.2 + pinkyFinger * 0.4;
        }

        // Hand spread -> wobble LFO speed
        if (this.wobbleLFO) {
            this.wobbleLFO.frequency.value = 0.2 + handSpread * 6;
        }

        // Hand spread -> pad detune
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(handSpread * 40, 0.1);
            if (padData.harmonySynth) {
                padData.harmonySynth.detune.rampTo(-handSpread * 25, 0.1);
            }
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
        if (this.reverb) {
            this.reverb.wet.value = 0.3 + value * 0.3;
        }
        if (this.delay) {
            this.delay.wet.value = 0.15 + value * 0.2;
        }
        if (this.chorus) {
            this.chorus.depth = 0.4 + value * 0.4;
        }
    }

    // --- PANIC: kill ALL sound immediately ---
    panic() {
        this._panicMuted = true;
        setTimeout(() => { this._panicMuted = false; }, 1000);

        // Stop all pads
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

        // Stop sub-bass
        if (this.subBass) {
            try { this.subBass.triggerRelease(Tone.now()); } catch(e) {}
        }

        // Silence all synth hand finger synths
        if (this.fingerSynths) {
            for (const finger of ['index', 'middle', 'ring', 'pinky']) {
                try { this.fingerSynths[finger].triggerRelease(Tone.now()); } catch(e) {}
            }
        }

        // Silence all drum hand finger synths
        if (this.drumFingerSynths) {
            for (const finger of ['index', 'middle', 'ring', 'pinky']) {
                try { this.drumFingerSynths[finger].triggerRelease(Tone.now()); } catch(e) {}
            }
        }

        // Kill wobble LFO temporarily
        if (this.wobbleLFO) {
            this.wobbleLFO.stop();
            setTimeout(() => { try { this.wobbleLFO.start(); } catch(e) {} }, 1000);
        }

        // Reset filter
        if (this.filter) {
            this.filter.frequency.value = 16000;
        }

        // Reset effect wet levels
        if (this.reverb) this.reverb.wet.value = 0.35;
        if (this.delay) this.delay.wet.value = 0.2;
        if (this.chorus) this.chorus.depth = 0.6;

        // Reset drum extension tracking
        this._prevDrumExtensions = { index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { index: 0, middle: 0, ring: 0, pinky: 0 };

        console.log('PANIC — all sound killed, muted for 1 second');
    }

    getAnalyser() {
        return this.analyser;
    }
}
