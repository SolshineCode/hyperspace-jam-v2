import * as Tone from 'https://esm.sh/tone';

// Psychedelic EDM Synth Engine — Comprehensive Hand-Distance Control
// Each finger's distance from palm is a continuous controller
// Synth hand: melodic/tonal, Drum hand: percussive/textural
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

        this.fingerIntervals = { index: 0, middle: 3, ring: 7, pinky: 10 };

        this.scale = [
            'C1','Eb1','G1','Bb1','C2','Eb2','F2','G2','Bb2',
            'C3','Eb3','F3','G3','Bb3','C4','Eb4','F4','G4','Bb4','C5','Eb5','F5'
        ];

        this.padPresets = [
            { name: 'Ambient Sub', oscillator: { type: 'sine' }, envelope: { attack: 0.8, decay: 0.6, sustain: 0.7, release: 1.0 } },
            { name: 'Dub Growl', oscillator: { type: 'sawtooth' }, envelope: { attack: 0.3, decay: 0.5, sustain: 0.5, release: 0.8 } },
            { name: 'Dream Wash', oscillator: { type: 'triangle' }, envelope: { attack: 1.0, decay: 0.8, sustain: 0.6, release: 1.2 } },
            { name: 'Detuned Saw', oscillator: { type: 'fatsawtooth', spread: 40, count: 3 }, envelope: { attack: 0.6, decay: 0.5, sustain: 0.7, release: 1.0 } },
            { name: 'Warm Square', oscillator: { type: 'fatsquare', spread: 20, count: 3 }, envelope: { attack: 0.5, decay: 0.4, sustain: 0.6, release: 0.8 } }
        ];
        this.currentSynthIndex = 0;

        this._prevExtensions = {};
        this._prevDrumExtensions = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

        this._smoothDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDrumDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._SMOOTH_ALPHA = 0.3; // balanced: responsive but not jittery
        this._frameCount = 0; // throttle heavy updates to every 3rd frame
    }

    // Resume AudioContext if browser suspended it (called on clicks + periodically)
    async ensureAudioActive() {
        if (Tone.context.state !== 'running') {
            console.log('AudioContext suspended, resuming...');
            await Tone.context.resume();
            await Tone.start();
        }
    }

    async start() {
        if (this.isStarted) {
            // Already started — just make sure context is alive
            await this.ensureAudioActive();
            return;
        }
        await Tone.start();

        try {

        // === MASTER EFFECTS CHAIN ===
        this.limiter = new Tone.Limiter(-3).toDestination();
        this.reverb = new Tone.Reverb({ decay: 8, preDelay: 0.05, wet: 0.45 }).connect(this.limiter);
        this.delay = new Tone.PingPongDelay({ delayTime: '4n', feedback: 0.4, wet: 0.25 }).connect(this.reverb);
        this.chorus = new Tone.Chorus({ frequency: 2, delayTime: 4, depth: 0.7 }).connect(this.reverb);
        this.chorus.start();
        this.filter = new Tone.Filter(16000, 'lowpass').connect(this.chorus);
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.reverb.connect(this.analyser);

        // =====================================================================
        // SYNTH HAND — Psychedelic EDM soundboard voices
        // Thumb+Index = volume (pinch). Middle/Ring/Pinky = the instruments.
        // =====================================================================
        this.fingerSynths = {};

        // === MIDDLE (ROOT): 303 Acid Squelch ===
        // Sawtooth + high-resonance filter sweep. THE psychedelic sound.
        // Distance controls filter cutoff — close=dark, extended=screaming acid
        this._acidFilter = new Tone.Filter({
            frequency: 400, type: 'lowpass', Q: 12, rolloff: -24
        }).connect(this.delay);
        this.fingerSynths.middle = new Tone.MonoSynth({
            oscillator: { type: 'sawtooth' },
            filter: { Q: 12, type: 'lowpass', rolloff: -24 },
            envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.3 },
            filterEnvelope: {
                attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.3,
                baseFrequency: 200, octaves: 4, exponent: 2
            }
        }).connect(this._acidFilter);
        this.fingerSynths.middle.volume.value = -4;

        // === RING (5th): Goa Pluck ===
        // Square wave, fast decay, no sustain — futuristic harp.
        // Drowned in ping-pong delay so a single tap echoes across stereo field.
        this._shimmerReverb = new Tone.Reverb({ decay: 4, preDelay: 0.02, wet: 0.5 }).connect(this.limiter);
        this._pluckDelay = new Tone.PingPongDelay({
            delayTime: '16n', feedback: 0.45, wet: 0.4
        }).connect(this._shimmerReverb);
        this.fingerSynths.ring = new Tone.Synth({
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 }
        }).connect(this._pluckDelay);
        this.fingerSynths.ring.volume.value = -6;

        // === PINKY (m7): FM Laser Zap ===
        // Sine + pitch envelope + FM for metallic "pew-pew" sci-fi laser.
        // Distance controls FM depth — close=subtle, extended=full laser
        this.distortion = new Tone.Distortion({ distortion: 0, wet: 0 }).connect(this.limiter);
        this.fingerSynths.pinky = new Tone.FMSynth({
            harmonicity: 8, modulationIndex: 20,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
            modulation: { type: 'square' },
            modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 }
        }).connect(this.distortion);
        this.fingerSynths.pinky.volume.value = -2;

        // === CONTINUOUS: Acid squelch drone (always-on, distance = filter) ===
        this.middleContinuous = new Tone.Synth({
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.4, decay: 0, sustain: 1, release: 0.6 }
        }).connect(this._acidFilter);
        this.middleContinuous.volume.value = -24;

        // === CONTINUOUS: Ring pluck shimmer drone ===
        this.ringContinuous = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.8, decay: 0, sustain: 1, release: 1.0 }
        }).connect(this._shimmerReverb);
        this.ringContinuous.volume.value = -30;

        // === CONTINUOUS: Pinky sub-wobble drone ===
        this.pinkyContinuous = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.8 }
        }).connect(this.distortion);
        this.pinkyContinuous.volume.value = -30;

        // =====================================================================
        // DRUM HAND — Real drum samples, finger distance = repeat rate
        // =====================================================================
        this.drumFingerSynths = {};

        // Drum sample players — kick, hihat, clap
        this.drumPlayers = new Tone.Players({
            urls: {
                kick: 'assets/kick.wav',
                hihat: 'assets/hihat.wav',
                clap: 'assets/clap.wav'
            },
            onload: () => {
                console.log('Drum samples loaded');
                this._drumPlayersLoaded = true;
                this.drumPlayers.player('kick').volume.value = 0;
                this.drumPlayers.player('hihat').volume.value = -2;
                this.drumPlayers.player('clap').volume.value = 0;
            }
        }).connect(this.limiter);
        this._drumPlayersLoaded = false;

        // THUMB: Glitch zap trigger
        this.drumThumbSynth = new Tone.FMSynth({
            harmonicity: 6, modulationIndex: 15,
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
            modulation: { type: 'sawtooth' },
            modulationEnvelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 }
        }).connect(this.delay);
        this.drumThumbSynth.volume.value = -8;

        // Beat timers
        this._drumBeatTimers = { kick: 0, hihat: 0, clap: 0 };

        // === DEDICATED TRIGGER SYNTHS (loud, immediate, per-finger) ===
        // These fire on open/close transitions — separate from the BPM sample loop

        // Kick trigger: punchy membrane, louder than sample
        this._triggerKick = new Tone.MembraneSynth({
            pitchDecay: 0.06, octaves: 6,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 }
        }).connect(this.limiter);
        this._triggerKick.volume.value = 2;

        // Hihat trigger: bright noise burst
        this._triggerHat = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 }
        }).connect(this.limiter);
        this._triggerHat.volume.value = -2;

        // Clap trigger: layered noise with bandpass
        this._clapFilter = new Tone.Filter({ frequency: 1500, type: 'bandpass', Q: 2 }).connect(this.reverb);
        this._triggerClap = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.06 }
        }).connect(this._clapFilter);
        this._triggerClap.volume.value = 0;

        // Legacy references
        this.kickSynth = new Tone.MembraneSynth({
            pitchDecay: 0.08, octaves: 8,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 }
        }).connect(this.limiter);
        this.kickSynth.volume.value = -4;
        this.hatSynth = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 }
        }).connect(this.limiter);
        this.hatSynth.volume.value = -8;
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

        this._continuousActive = false;

        // === SHAPE BASS — epic deep bass tied to the white quadrilateral ===
        // Z-depth modulates lowpass filter + distortion (closer = darker/heavier)
        this._shapeBassFilter = new Tone.Filter({
            frequency: 800, type: 'lowpass', Q: 2, rolloff: -24
        }).connect(this.limiter);
        this._shapeBassDistortion = new Tone.Distortion({
            distortion: 0, wet: 0
        }).connect(this._shapeBassFilter);
        this._shapeBass = new Tone.Synth({
            oscillator: { type: 'fatsawtooth', spread: 15, count: 3 },
            envelope: { attack: 0.3, decay: 0, sustain: 1, release: 1.5 }
        }).connect(this._shapeBassDistortion);
        this._shapeBass.volume.value = -10;
        this._shapeBassActive = false;
        this._shapeSubBass = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.5, decay: 0, sustain: 1, release: 1.0 }
        }).connect(this.limiter);
        this._shapeSubBass.volume.value = -8;

        // Pre-allocate touch synths (no dynamic allocation = no memory leak)
        this._initTouchSynths();

        } catch(e) {
            console.error('MusicManager start() error:', e);
        }
        this.isStarted = true;
        console.log('Psychedelic EDM engine v2 ready — distance-from-palm control');
    }

    _smooth(target, key, raw) {
        target[key] += (raw - target[key]) * this._SMOOTH_ALPHA;
        return target[key];
    }

    // --- Pad Management ---

    startArpeggio(handId, rootNote, playerIndex) {
        if (!this.isStarted || this.padSynths.has(handId) || this._panicMuted) return;

        // Per-player preset: player 2 uses a different timbre
        const pIdx = playerIndex || 0;
        const presetIdx = (this.currentSynthIndex + pIdx * 2) % this.padPresets.length;
        const preset = this.padPresets[presetIdx];

        // Per-player key offset: player 2 transposed up a perfect 4th (5 semitones)
        const keyOffset = (pIdx === 0) ? 1 : Math.pow(2, 5/12); // P4 for player 2

        // Auto-chord: root + minor 3rd + perfect 5th
        const makePad = (volDb) => {
            const s = new Tone.Synth({
                oscillator: { ...preset.oscillator },
                envelope: { ...preset.envelope }
            });
            s.connect(this.filter);
            s.volume.value = volDb;
            return s;
        };

        const rootPad = makePad(-10);
        const thirdPad = makePad(-14);  // minor 3rd, slightly quieter
        const fifthPad = makePad(-13);  // perfect 5th

        const freq = Tone.Frequency(rootNote).toFrequency() * keyOffset;
        rootPad.triggerAttack(freq, Tone.now());
        thirdPad.triggerAttack(freq * Math.pow(2, 3/12), Tone.now());  // minor 3rd
        fifthPad.triggerAttack(freq * Math.pow(2, 7/12), Tone.now());  // perfect 5th

        if (this.subBass) this.subBass.triggerAttack(freq / 2, Tone.now());

        this.padSynths.set(handId, {
            synth: rootPad, thirdSynth: thirdPad, fifthSynth: fifthPad,
            currentRoot: rootNote, keyOffset, playerIndex: pIdx
        });
        this.handVolumes.set(handId, 0.2);
        this.fingerCooldowns.set(handId, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });

        // Start continuous synths
        if (!this._continuousActive) {
            this._continuousActive = true;
            try {
                this.middleContinuous.triggerAttack(freq * 1.498, Tone.now());
                this.ringContinuous.triggerAttack(freq * 2, Tone.now());
                this.pinkyContinuous.triggerAttack(freq / 2, Tone.now());
            } catch(e) {}
        }
    }

    updateArpeggio(handId, newRootNote) {
        const padData = this.padSynths.get(handId);
        if (!padData || padData.currentRoot === newRootNote) return;

        const keyOffset = padData.keyOffset || 1;
        const freq = Tone.Frequency(newRootNote).toFrequency() * keyOffset;
        padData.synth.frequency.rampTo(freq, 0.15);
        if (padData.thirdSynth) padData.thirdSynth.frequency.rampTo(freq * Math.pow(2, 3/12), 0.15);
        if (padData.fifthSynth) padData.fifthSynth.frequency.rampTo(freq * Math.pow(2, 7/12), 0.15);
        if (this.subBass) this.subBass.frequency.rampTo(freq / 2, 0.2);

        try {
            if (this.middleContinuous) this.middleContinuous.frequency.rampTo(freq * Math.pow(2, 3/12), 0.2);
            if (this.ringContinuous) this.ringContinuous.frequency.rampTo(freq * 2, 0.2);
            if (this.pinkyContinuous) this.pinkyContinuous.frequency.rampTo(freq / 2, 0.2);
        } catch(e) {}

        padData.currentRoot = newRootNote;
    }

    updateArpeggioVolume(handId, velocity) {
        const padData = this.padSynths.get(handId);
        if (!padData) return;

        const clamped = Math.max(0, Math.min(1, velocity));
        this.handVolumes.set(handId, clamped);
        const db = -30 + clamped * 26;
        padData.synth.volume.rampTo(db, 0.03);
        if (padData.thirdSynth) padData.thirdSynth.volume.rampTo(db - 4, 0.03);
        if (padData.fifthSynth) padData.fifthSynth.volume.rampTo(db - 3, 0.03);
    }

    stopArpeggio(handId) {
        const padData = this.padSynths.get(handId);
        if (padData) {
            padData.synth.triggerRelease(Tone.now());
            if (padData.thirdSynth) padData.thirdSynth.triggerRelease(Tone.now());
            if (padData.fifthSynth) padData.fifthSynth.triggerRelease(Tone.now());
            if (this.padSynths.size <= 1 && this.subBass) {
                this.subBass.triggerRelease(Tone.now());
            }

            if (this.padSynths.size <= 1) {
                this._continuousActive = false;
                try { this.middleContinuous.triggerRelease(Tone.now()); } catch(e) {}
                try { this.ringContinuous.triggerRelease(Tone.now()); } catch(e) {}
                try { this.pinkyContinuous.triggerRelease(Tone.now()); } catch(e) {}
            }

            if (!this._pendingDisposals) this._pendingDisposals = new Set();
            const synths = [padData.synth, padData.thirdSynth, padData.fifthSynth].filter(Boolean);

            // Force-dispose oldest if too many pending (prevents memory leak on hand flicker)
            if (this._pendingDisposals.size > 8) {
                const oldest = this._pendingDisposals.values().next().value;
                try { oldest.dispose(); } catch(e) {}
                this._pendingDisposals.delete(oldest);
            }

            for (const synth of synths) {
                if (!this._pendingDisposals.has(synth)) {
                    this._pendingDisposals.add(synth);
                    // Disconnect immediately to stop audio, dispose after release tail
                    try { synth.disconnect(); } catch(e) {}
                    setTimeout(() => {
                        try { synth.dispose(); } catch(e) {}
                        this._pendingDisposals.delete(synth);
                    }, 1000);
                }
            }
            this.padSynths.delete(handId);
            this.handVolumes.delete(handId);
            this.fingerCooldowns.delete(handId);
        }
    }

    // =====================================================================
    // SYNTH HAND (hand 0)
    // Thumb+Index = volume only. Middle/Ring/Pinky = continuous + triggers
    // Each finger sounds RADICALLY different via separate signal chains
    // =====================================================================

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

        const dist = gestureData.fingerDistances || gestureData.fingerExtensions || {
            thumb: 0.1, index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.1
        };

        const d = {};
        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
            d[f] = this._smooth(this._smoothDist, f, dist[f] || 0);
        }

        const rootFreq = Tone.Frequency(rootNote).toFrequency();

        // INDEX: No effect (square/volume finger — fully independent)

        const doHeavyUpdate = true; // no throttling — responsiveness > CPU savings

        // === MIDDLE (ROOT): 303 Acid Squelch ===
        // Distance = filter cutoff. Close=dark rumble, extended=screaming acid.
        if (this._acidFilter && doHeavyUpdate) {
            this._acidFilter.frequency.value = 200 + Math.pow(d.middle, 2) * 10000;
            this._acidFilter.Q.value = 6 + d.middle * 12;
        }
        if (this.fingerSynths.middle) {
            if (prevExt.middle < 0.2 && d.middle > 0.35 && (now - cooldowns.middle) > this.FINGER_COOLDOWN_MS) {
                cooldowns.middle = now;
                this.fingerSynths.middle.triggerAttackRelease(
                    Tone.Frequency(rootFreq).toNote(), '4n', Tone.now(), 0.9
                );
            }
        }
        if (this.middleContinuous && doHeavyUpdate) {
            this.middleContinuous.volume.rampTo(d.middle < 0.1 ? -Infinity : -36 + d.middle * 22, 0.03);
        }

        // === RING (5th): Goa Pluck ===
        // Distance = delay feedback + reverb wet. Close=dry tap, extended=echoing cascade
        if (this.fingerSynths.ring) {
            if (prevExt.ring < 0.2 && d.ring > 0.35 && (now - cooldowns.ring) > this.FINGER_COOLDOWN_MS) {
                cooldowns.ring = now;
                const pluckFreq = rootFreq * Math.pow(2, 7/12); // perfect 5th
                this.fingerSynths.ring.triggerAttackRelease(
                    Tone.Frequency(pluckFreq).toNote(), '16n', Tone.now(), 0.7 + d.ring * 0.3
                );
            }
        }
        if (doHeavyUpdate) {
            if (this._pluckDelay) {
                this._pluckDelay.feedback.value = 0.2 + d.ring * 0.45;
                this._pluckDelay.wet.value = 0.1 + d.ring * 0.5;
            }
            if (this._shimmerReverb) {
                this._shimmerReverb.wet.value = 0.2 + d.ring * 0.6;
            }
            if (this.ringContinuous) {
                this.ringContinuous.volume.rampTo(d.ring < 0.1 ? -Infinity : -40 + d.ring * 22, 0.03);
            }
        }

        // === PINKY (m7): FM Laser Zap ===
        // Distance = FM depth + distortion. Close=subtle ping, extended=full laser blast
        if (this.fingerSynths.pinky && doHeavyUpdate) {
            try {
                this.fingerSynths.pinky.modulationIndex.value = 2 + Math.pow(d.pinky, 1.5) * 35;
                this.fingerSynths.pinky.harmonicity.value = 4 + d.pinky * 8;
            } catch(e) {}
            if (prevExt.pinky < 0.2 && d.pinky > 0.35 && (now - cooldowns.pinky) > this.FINGER_COOLDOWN_MS) {
                cooldowns.pinky = now;
                const zapFreq = rootFreq * Math.pow(2, 10/12); // minor 7th
                this.fingerSynths.pinky.triggerAttackRelease(
                    Tone.Frequency(zapFreq).toNote(), '8n', Tone.now(), 0.9
                );
            }
        }
        if (doHeavyUpdate) {
            if (this.distortion) {
                this.distortion.distortion = Math.pow(d.pinky, 1.5) * 0.6;
                this.distortion.wet.value = d.pinky * 0.5;
            }
            if (this.pinkyContinuous) {
                this.pinkyContinuous.volume.rampTo(d.pinky < 0.1 ? -Infinity : -40 + d.pinky * 22, 0.03);
            }
        }

        // === WRIST ANGLE: Massive tonal modulation ===
        {
        // -1 = tilted left, 0 = straight up, +1 = tilted right
        // Controls: master filter cutoff, pad detune, delay time, chorus speed
        const wristAngle = gestureData.wristAngle || 0;
        const absAngle = Math.abs(wristAngle);

        // Master filter: straight up = bright (16kHz), tilted = dark (200Hz)
        if (this.filter) {
            const filterCutoff = 16000 * Math.pow(0.02, absAngle); // 16kHz → ~300Hz
            this.filter.frequency.rampTo(filterCutoff, 0.03);
        }

        // Pad detune: tilted = detuned/dissonant, up to ±100 cents
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(wristAngle * 100, 0.03);
            if (padData.thirdSynth) padData.thirdSynth.detune.rampTo(-wristAngle * 60, 0.03);
            if (padData.fifthSynth) padData.fifthSynth.detune.rampTo(wristAngle * 40, 0.03);
        });

        // Delay time shift: tilted right = longer delay, left = shorter
        if (this.delay) {
            const baseDelay = 0.2; // ~8th note
            const delayShift = baseDelay + wristAngle * 0.15; // 0.05 → 0.35
            try { this.delay.delayTime.rampTo(Math.max(0.01, delayShift), 0.03); } catch(e) {}
        }

        // Chorus speed: more tilt = faster chorus wobble
        if (this.chorus) {
            this.chorus.frequency.value = 1 + absAngle * 8; // 1→9 Hz
        }

        // Wobble LFO speed: angle adds to wobble
        if (this.wobbleLFO) {
            this.wobbleLFO.frequency.value = 0.3 + absAngle * 6;
        }

        // FM continuous: wrist angle adds extra modulation depth
        if (this.middleContinuous) {
            try {
                const angleModBoost = absAngle * 10;
                this.middleContinuous.harmonicity.value = 2 + absAngle * 4;
            } catch(e) {}
        }

        // === Hand spread → chorus depth (additive with wrist angle) ===
        const spread = gestureData.handSpread || 0;
        if (this.chorus) {
            this.chorus.depth = 0.3 + spread * 0.7;
        }

        // === DELAY: Controlled by ring (shimmer) ===
        if (this.delay) {
            this.delay.feedback.value = 0.1 + d.ring * 0.55;
            this.delay.wet.value = 0.05 + d.ring * 0.4;
        }

        // === REVERB: Controlled by combined ring+pinky ===
        if (this.reverb) {
            this.reverb.wet.value = 0.15 + Math.max(d.ring, d.pinky) * 0.5;
        }

        } // end doHeavyUpdate wrist angle block

        // Store for next frame
        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
            prevExt[f] = d[f];
        }

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

    // =====================================================================
    // DRUM HAND (hand 1)
    // Fingers held up = drum pattern active (via DrumManager labels)
    // PLUS: continuous distance-based synth percussion from MusicManager
    // Key fix: drum middle is now always-on when extended (not just triggers)
    // =====================================================================

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

        // =====================================================================
        // IMMEDIATE TRIGGERS — loud distinct sound on every finger open/close
        // Synth hits (not just samples) so each finger is unmistakable
        // =====================================================================
        const OPEN_THRESH = 0.22;
        const CLOSE_THRESH = 0.12;

        // MIDDLE: Deep boom on open, short thud on close
        if (prevExt.middle < OPEN_THRESH && d.middle >= OPEN_THRESH) {
            try {
                this._triggerKick.triggerAttackRelease('C1', '8n', Tone.now(), 1.0);
                if (this._drumPlayersLoaded) this.drumPlayers.player('kick').start(Tone.now());
            } catch(e) {}
        } else if (prevExt.middle >= OPEN_THRESH && d.middle < CLOSE_THRESH) {
            try { this._triggerKick.triggerAttackRelease('G1', '32n', Tone.now(), 0.5); } catch(e) {}
        }

        // RING: Bright tick on open, soft click on close
        if (prevExt.ring < OPEN_THRESH && d.ring >= OPEN_THRESH) {
            try {
                this._triggerHat.triggerAttackRelease('16n', Tone.now(), 1.0);
                if (this._drumPlayersLoaded) this.drumPlayers.player('hihat').start(Tone.now());
            } catch(e) {}
        } else if (prevExt.ring >= OPEN_THRESH && d.ring < CLOSE_THRESH) {
            try { this._triggerHat.triggerAttackRelease('64n', Tone.now(), 0.4); } catch(e) {}
        }

        // PINKY: Sharp clap on open, soft snap on close
        if (prevExt.pinky < OPEN_THRESH && d.pinky >= OPEN_THRESH) {
            try {
                this._triggerClap.triggerAttackRelease('8n', Tone.now(), 1.0);
                if (this._drumPlayersLoaded) this.drumPlayers.player('clap').start(Tone.now());
            } catch(e) {}
        } else if (prevExt.pinky >= OPEN_THRESH && d.pinky < CLOSE_THRESH) {
            try { this._triggerClap.triggerAttackRelease('32n', Tone.now(), 0.4); } catch(e) {}
        }

        // THUMB: Zap on open, reverse zap on close
        if (prevExt.thumb < OPEN_THRESH && d.thumb >= OPEN_THRESH) {
            const zapNote = ['C4','Eb4','G4','Bb4'][Math.floor(Math.random() * 4)];
            try { this.drumThumbSynth.triggerAttackRelease(zapNote, '32n', Tone.now(), 0.9); } catch(e) {}
        } else if (prevExt.thumb >= OPEN_THRESH && d.thumb < CLOSE_THRESH) {
            try { this.drumThumbSynth.triggerAttackRelease('C3', '64n', Tone.now(), 0.5); } catch(e) {}
        }

        // =====================================================================
        // BPM LOOP — plays while finger is held open (secondary layer)
        // Middle=KICK, Ring=HIHAT, Pinky=CLAP
        // =====================================================================

        const DEAD_ZONE = 0.25;  // higher than trigger thresh so loop starts after open
        const MIN_BPM = 20;     // very slow ambient pulse
        const MAX_BPM = 100;    // chill downtempo cap

        const distToInterval = (dist) => {
            if (dist < DEAD_ZONE) return Infinity;
            const t = (dist - DEAD_ZONE) / (1 - DEAD_ZONE);
            const bpm = MIN_BPM + Math.pow(t, 1.3) * (MAX_BPM - MIN_BPM);
            return 60000 / bpm;
        };

        if (this._drumPlayersLoaded) {
            // --- MIDDLE: KICK ---
            const kickInterval = distToInterval(d.middle);
            if (kickInterval < Infinity && (now - this._drumBeatTimers.kick) > kickInterval) {
                this._drumBeatTimers.kick = now;
                try { this.drumPlayers.player('kick').start(Tone.now()); } catch(e) {}
            }

            // --- RING: HIHAT ---
            const hihatInterval = distToInterval(d.ring);
            if (hihatInterval < Infinity && (now - this._drumBeatTimers.hihat) > hihatInterval) {
                this._drumBeatTimers.hihat = now;
                try { this.drumPlayers.player('hihat').start(Tone.now()); } catch(e) {}
            }

            // --- PINKY: CLAP ---
            const clapInterval = distToInterval(d.pinky);
            if (clapInterval < Infinity && (now - this._drumBeatTimers.clap) > clapInterval) {
                this._drumBeatTimers.clap = now;
                try { this.drumPlayers.player('clap').start(Tone.now()); } catch(e) {}
            }
        }

        // (thumb trigger handled above in immediate triggers section)

        // === WRIST ANGLE: boosts drum volume when tilted ===
        const drumWristAngle = gestureData.wristAngle || 0;
        const drumAbsAngle = Math.abs(drumWristAngle);
        if (this._drumPlayersLoaded) {
            try {
                this.drumPlayers.player('kick').volume.value = 0 + drumAbsAngle * 4;
                this.drumPlayers.player('hihat').volume.value = -2 + drumAbsAngle * 4;
                this.drumPlayers.player('clap').volume.value = 0 + drumAbsAngle * 4;
            } catch(e) {}
        }

        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
            prevExt[f] = d[f];
        }
    }

    // --- Finger Expression ---

    updateFingerExpression(params) {
        // Wrist angle now handles most modulation in updateGesture
    }

    // --- Shape Bass (white quadrilateral = epic bass) ---

    updateShapeAudio(data) {
        if (!this.isStarted || this._panicMuted) return;

        const { type, depth, area, anchorCount } = data;
        const hasShape = (type !== 'none' && anchorCount >= 2);

        // Start/stop the shape bass drone
        if (hasShape && !this._shapeBassActive) {
            this._shapeBassActive = true;
            // Bass note follows the pad root if available, else C2
            let bassNote = 'C2';
            this.padSynths.forEach(pd => {
                if (pd.currentRoot) {
                    const freq = Tone.Frequency(pd.currentRoot).toFrequency();
                    bassNote = Tone.Frequency(freq / 2).toNote(); // one octave below pad
                }
            });
            try {
                this._shapeBass.triggerAttack(bassNote, Tone.now());
                this._shapeSubBass.triggerAttack(Tone.Frequency(bassNote).toFrequency() / 2, Tone.now());
            } catch(e) {}
        } else if (!hasShape && this._shapeBassActive) {
            this._shapeBassActive = false;
            try {
                this._shapeBass.triggerRelease(Tone.now());
                this._shapeSubBass.triggerRelease(Tone.now());
            } catch(e) {}
        }

        if (!hasShape) return;

        // === Z-DEPTH MODULATION ===
        // depth is typically -0.2 (close) to 0 (far)
        // Map to 0 (far/bright) → 1 (close/dark)
        const proximity = Math.max(0, Math.min(1, (-depth - 0) / 0.15));

        // Filter: far = open (2000Hz), close = dark (100Hz)
        if (this._shapeBassFilter) {
            this._shapeBassFilter.frequency.value = 2000 - proximity * 1800;
            this._shapeBassFilter.Q.value = 1 + proximity * 6;
        }

        // Distortion: more when close
        if (this._shapeBassDistortion) {
            this._shapeBassDistortion.distortion = proximity * 0.6;
            this._shapeBassDistortion.wet.value = proximity * 0.5;
        }

        // Volume scales with shape area (bigger shape = louder bass)
        const vol = -18 + area * 14;
        try {
            this._shapeBass.volume.rampTo(vol, 0.03);
            this._shapeSubBass.volume.rampTo(vol - 4, 0.03);
        } catch(e) {}

        // === BASS BEAT PULSE — controlled by synth hand ring finger distance ===
        // Ring finger distance sets beat rate of the shape bass (0=off, 1=fast pulse)
        const ringDist = this._smoothDist.ring || 0;
        if (ringDist > 0.15 && this._shapeBassActive) {
            const beatBPM = 15 + ringDist * 85; // 15-100 BPM, ambient throb
            const beatMs = 60000 / beatBPM;
            if (!this._shapeBeatTimer) this._shapeBeatTimer = 0;
            const now = performance.now();
            if (now - this._shapeBeatTimer > beatMs) {
                this._shapeBeatTimer = now;
                // Pulse the bass volume for rhythmic throb
                try {
                    this._shapeBass.volume.rampTo(vol + 6, 0.01);
                    this._shapeBass.volume.rampTo(vol, 0.08);
                    this._shapeSubBass.volume.rampTo(vol, 0.01);
                    this._shapeSubBass.volume.rampTo(vol - 4, 0.08);
                } catch(e) {}
            }
        }

        // Track pad root for bass note following
        if (this._shapeBassActive) {
            this.padSynths.forEach(pd => {
                if (pd.currentRoot) {
                    const freq = Tone.Frequency(pd.currentRoot).toFrequency();
                    try {
                        this._shapeBass.frequency.rampTo(freq / 2, 0.1);
                        this._shapeSubBass.frequency.rampTo(freq / 4, 0.1);
                    } catch(e) {}
                }
            });
        }
    }

    // --- Finger Touch Sounds ---
    // Unique sound per finger, triggered when any two fingertips meet

    // Pre-allocate touch synths (called once during start)
    _initTouchSynths() {
        // Pre-allocated melodic pluck synths — each plays a different pentatonic note
        // Routed through delay for lush echo cascade (Goa pluck style)
        this._touchSynths = {};
        const touchDest = this._pluckDelay || this.delay || this.limiter;

        // All 5 fingers get the same pluck voice but play different notes
        const makePluck = (vol) => {
            const s = new Tone.Synth({
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.12 }
            }).connect(touchDest);
            s.volume.value = vol;
            return s;
        };

        this._touchSynths.thumb = makePluck(-4);
        this._touchSynths.index = makePluck(-4);
        this._touchSynths.middle = makePluck(-2);
        this._touchSynths.ring = makePluck(-2);
        this._touchSynths.pinky = makePluck(-4);

        // Pentatonic note per finger (C minor pentatonic, different octaves)
        this._touchNotes = {
            thumb: ['C5', 'Eb5', 'G5'],
            index: ['Bb4', 'C5', 'Eb5'],
            middle: ['G4', 'Bb4', 'C5'],
            ring: ['Eb5', 'G5', 'Bb5'],
            pinky: ['C6', 'Eb6', 'G6']
        };

        this._touchCooldown = 0;
    }

    triggerFingerTouch(finger1, finger2) {
        if (!this.isStarted || this._panicMuted || !this._touchSynths) return;

        const now = performance.now();
        if ((now - this._touchCooldown) < 100) return; // debounce
        this._touchCooldown = now;

        const fingerPriority = ['pinky', 'ring', 'middle', 'index', 'thumb'];
        const primary = fingerPriority.indexOf(finger1) < fingerPriority.indexOf(finger2) ? finger1 : finger2;

        try {
            const notes = this._touchNotes[primary];
            if (notes && this._touchSynths[primary]) {
                const note = notes[Math.floor(Math.random() * notes.length)];
                this._touchSynths[primary].triggerAttackRelease(note, '16n', Tone.now(), 0.8);
            }
        } catch(e) {}
    }

    // --- Timbre Cycling ---

    cycleSynth() {
        if (!this.isStarted) return;

        const activePads = [];
        this.padSynths.forEach((padData, handId) => {
            activePads.push({ handId, root: padData.currentRoot });
            padData.synth.triggerRelease(Tone.now());
            if (padData.thirdSynth) padData.thirdSynth.triggerRelease(Tone.now());
            if (padData.fifthSynth) padData.fifthSynth.triggerRelease(Tone.now());
            for (const s of [padData.synth, padData.thirdSynth, padData.fifthSynth].filter(Boolean)) {
                try { s.disconnect(); } catch(e) {}
                setTimeout(() => { try { s.dispose(); } catch(e) {} }, 1000);
            }
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

        try { this.middleContinuous.triggerRelease(Tone.now()); } catch(e) {}
        try { this.ringContinuous.triggerRelease(Tone.now()); } catch(e) {}
        try { this.pinkyContinuous.triggerRelease(Tone.now()); } catch(e) {}
        this._continuousActive = false;

        // Reset glitch beat timers
        this._drumBeatTimers = { kick: 0, hihat: 0, clap: 0 };
        this._shapeBeatTimer = 0;

        // Stop shape bass
        this._shapeBassActive = false;
        try { this._shapeBass.triggerRelease(Tone.now()); } catch(e) {}
        try { this._shapeSubBass.triggerRelease(Tone.now()); } catch(e) {}
        if (this._shapeBassFilter) this._shapeBassFilter.frequency.value = 800;
        if (this._shapeBassDistortion) { this._shapeBassDistortion.distortion = 0; this._shapeBassDistortion.wet.value = 0; }

        if (this.fingerSynths) {
            for (const finger of ['index', 'middle', 'ring', 'pinky']) {
                try { this.fingerSynths[finger].triggerRelease(Tone.now()); } catch(e) {}
            }
        }

        if (this.wobbleLFO) {
            this.wobbleLFO.stop();
            setTimeout(() => { try { this.wobbleLFO.start(); } catch(e) {} }, 1000);
        }

        if (this.filter) this.filter.frequency.value = 16000;
        if (this.reverb) this.reverb.wet.value = 0.35;
        if (this.delay) { this.delay.wet.value = 0.2; this.delay.feedback.value = 0.35; }
        if (this.chorus) this.chorus.depth = 0.6;
        if (this.distortion) { this.distortion.distortion = 0; this.distortion.wet.value = 0; }

        this._prevDrumExtensions = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDrumDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

        console.log('PANIC — all sound killed');
    }

    getAnalyser() {
        return this.analyser;
    }
}
