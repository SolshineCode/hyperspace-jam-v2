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
            { name: 'Hypnotic Sub', oscillator: { type: 'sine' }, envelope: { attack: 0.4, decay: 0.5, sustain: 0.6, release: 0.5 } },
            { name: 'Acid Growl', oscillator: { type: 'sawtooth' }, envelope: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.4 } },
            { name: 'Trance Wash', oscillator: { type: 'triangle' }, envelope: { attack: 0.5, decay: 0.6, sustain: 0.55, release: 0.6 } },
            { name: 'Detuned Saw', oscillator: { type: 'fatsawtooth', spread: 40, count: 3 }, envelope: { attack: 0.3, decay: 0.4, sustain: 0.7, release: 0.6 } },
            { name: 'Fat Square', oscillator: { type: 'fatsquare', spread: 30, count: 3 }, envelope: { attack: 0.2, decay: 0.3, sustain: 0.6, release: 0.5 } }
        ];
        this.currentSynthIndex = 0;

        this._prevExtensions = {};
        this._prevDrumExtensions = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._drumFingerCooldowns = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

        this._smoothDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._smoothDrumDist = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
        this._SMOOTH_ALPHA = 0.25;
    }

    async start() {
        if (this.isStarted) return;
        await Tone.start();

        try {

        // === MASTER EFFECTS CHAIN ===
        this.limiter = new Tone.Limiter(-3).toDestination();
        this.reverb = new Tone.Reverb({ decay: 6, preDelay: 0.03, wet: 0.35 }).connect(this.limiter);
        this.delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.35, wet: 0.2 }).connect(this.reverb);
        this.chorus = new Tone.Chorus({ frequency: 2, delayTime: 4, depth: 0.7 }).connect(this.reverb);
        this.chorus.start();
        this.filter = new Tone.Filter(16000, 'lowpass').connect(this.chorus);
        this.analyser = new Tone.Analyser('waveform', 1024);
        this.reverb.connect(this.analyser);

        // =====================================================================
        // SYNTH HAND FINGER SYNTHS — each is RADICALLY different
        // Thumb+Index = volume (pinch), so only middle/ring/pinky get effects
        // =====================================================================
        this.fingerSynths = {};

        // INDEX: No synth (index is a square/volume finger — fully independent)

        // MIDDLE: Screaming Lead — FMSynth, distance = modulation chaos
        // Routed to its OWN dedicated filter chain (not shared delay)
        this._middleFilter = new Tone.Filter({ frequency: 2000, type: 'lowpass', Q: 4 }).connect(this.reverb);
        this.fingerSynths.middle = new Tone.FMSynth({
            harmonicity: 3, modulationIndex: 1,
            oscillator: { type: 'square' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 0.4 },
            modulation: { type: 'sawtooth' },
            modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.15, release: 0.15 }
        }).connect(this._middleFilter);
        this.fingerSynths.middle.volume.value = -4;

        // RING: Crystal Shimmer — MetalSynth through its OWN reverb (long tail)
        this._shimmerReverb = new Tone.Reverb({ decay: 10, preDelay: 0.05, wet: 0.8 }).connect(this.limiter);
        this.fingerSynths.ring = new Tone.MetalSynth({
            harmonicity: 12, modulationIndex: 24,
            resonance: 4000, octaves: 1.5,
            envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.4 }
        }).connect(this._shimmerReverb);
        this.fingerSynths.ring.volume.value = -6;

        // PINKY: Sub Cannon — MembraneSynth + Distortion, HUGE bass drops
        this.distortion = new Tone.Distortion({ distortion: 0, wet: 0 }).connect(this.limiter);
        this.fingerSynths.pinky = new Tone.MembraneSynth({
            pitchDecay: 0.3, octaves: 8,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 1.0, sustain: 0, release: 0.5 }
        }).connect(this.distortion);
        this.fingerSynths.pinky.volume.value = 0; // LOUD

        // === CONTINUOUS SYNTH: Middle finger FM pad (always-on, distance = chaos) ===
        this.middleContinuous = new Tone.FMSynth({
            harmonicity: 2, modulationIndex: 0.5,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.4, decay: 0, sustain: 1, release: 0.6 },
            modulation: { type: 'triangle' },
            modulationEnvelope: { attack: 0.4, decay: 0, sustain: 1, release: 0.6 }
        }).connect(this._middleFilter);
        this.middleContinuous.volume.value = -22;

        // === CONTINUOUS SYNTH: Ring finger shimmer drone ===
        this.ringContinuous = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.8, decay: 0, sustain: 1, release: 1.0 }
        }).connect(this._shimmerReverb);
        this.ringContinuous.volume.value = -30;

        // === CONTINUOUS SYNTH: Pinky sub drone ===
        this.pinkyContinuous = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.8 }
        }).connect(this.distortion);
        this.pinkyContinuous.volume.value = -30;

        // =====================================================================
        // DRUM HAND — GLITCH-HOP TEXTURES (not kick-hat-clap drum machine)
        // Pre-allocated synths, finger distance = repeat rate + character
        // =====================================================================
        this.drumFingerSynths = {};

        // MIDDLE: Glitch Blip — pitched membrane with random pitch per hit
        // Short, clicky, melodic — like Amon Tobin / Tipper glitch percussion
        this._glitchBlip = new Tone.MembraneSynth({
            pitchDecay: 0.015, octaves: 3,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 }
        }).connect(this.delay);
        this._glitchBlip.volume.value = -8;

        // RING: Filtered Grain — noise burst through resonant bandpass
        // Each hit has randomized filter freq for organic texture
        this._grainFilter = new Tone.Filter({
            frequency: 2000, type: 'bandpass', Q: 8, rolloff: -24
        }).connect(this.chorus);
        this._grainSynth = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
        }).connect(this._grainFilter);
        this._grainSynth.volume.value = -10;

        // PINKY: Textured Wash — longer noise through modulated filter + reverb
        // Evolving pad-like percussion, not a clap
        this._washReverb = new Tone.Reverb({ decay: 4, preDelay: 0.02, wet: 0.7 }).connect(this.limiter);
        this._washFilter = new Tone.Filter({
            frequency: 3000, type: 'lowpass', Q: 3
        }).connect(this._washReverb);
        this._washSynth = new Tone.NoiseSynth({
            noise: { type: 'brown' },
            envelope: { attack: 0.01, decay: 0.15, sustain: 0, release: 0.1 }
        }).connect(this._washFilter);
        this._washSynth.volume.value = -10;

        // THUMB: Glitch zap — short FM burst (not a tom)
        this.drumThumbSynth = new Tone.FMSynth({
            harmonicity: 6, modulationIndex: 15,
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
            modulation: { type: 'sawtooth' },
            modulationEnvelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 }
        }).connect(this.delay);
        this.drumThumbSynth.volume.value = -8;

        // Beat timers for glitch-hop repeat rate
        this._drumBeatTimers = { blip: 0, grain: 0, wash: 0 };
        this._drumPlayersLoaded = true; // no samples to load, all synth

        // Legacy references (for hand-velocity percussion on synth hand)
        this.kickSynth = this._glitchBlip;
        this.hatSynth = this._grainSynth;
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

        const freq = Tone.Frequency(newRootNote).toFrequency();
        padData.synth.frequency.rampTo(freq, 0.15);
        if (padData.harmonySynth) padData.harmonySynth.frequency.rampTo(freq * 1.498, 0.15);
        if (this.subBass) this.subBass.frequency.rampTo(freq / 2, 0.2);

        try {
            if (this.middleContinuous) this.middleContinuous.frequency.rampTo(freq * 1.498, 0.2);
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

            if (this.padSynths.size <= 1) {
                this._continuousActive = false;
                try { this.middleContinuous.triggerRelease(Tone.now()); } catch(e) {}
                try { this.ringContinuous.triggerRelease(Tone.now()); } catch(e) {}
                try { this.pinkyContinuous.triggerRelease(Tone.now()); } catch(e) {}
            }

            if (!this._pendingDisposals) this._pendingDisposals = new Set();
            const synths = [padData.synth, padData.harmonySynth].filter(Boolean);

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

        // === MIDDLE: Root note + FM Screamer ===
        // Distance: 0 = clean subtle tone, 1 = insane FM screech
        // This is the PRIMARY melodic finger — root note trigger + continuous FM chaos
        if (this.fingerSynths.middle) {
            try {
                this.fingerSynths.middle.modulationIndex.value = 0.5 + Math.pow(d.middle, 1.5) * 50;
                this.fingerSynths.middle.harmonicity.value = 2 + d.middle * 12;
            } catch(e) {}
            if (prevExt.middle < 0.2 && d.middle > 0.35 && (now - cooldowns.middle) > this.FINGER_COOLDOWN_MS) {
                cooldowns.middle = now;
                this.fingerSynths.middle.triggerAttackRelease(
                    Tone.Frequency(rootFreq).toNote(), '4n', Tone.now(), 0.9
                );
            }
        }
        if (this._middleFilter) {
            this._middleFilter.frequency.value = 400 + Math.pow(d.middle, 2) * 8000;
            this._middleFilter.Q.value = 2 + d.middle * 10;
        }
        if (this.middleContinuous) {
            try {
                this.middleContinuous.modulationIndex.value = 0.1 + Math.pow(d.middle, 2) * 20;
                this.middleContinuous.volume.rampTo(-30 + d.middle * 18, 0.05);
            } catch(e) {}
        }

        // === RING: Crystal Shimmer ===
        // Distance: 0 = silence, 1 = bright shimmering bells + lush reverb tail
        // Completely different from middle — metallic/bell tones through long reverb
        if (this.fingerSynths.ring) {
            if (prevExt.ring < 0.2 && d.ring > 0.35 && (now - cooldowns.ring) > this.FINGER_COOLDOWN_MS) {
                cooldowns.ring = now;
                const chimeFreq = rootFreq * Math.pow(2, 7/12);
                this.fingerSynths.ring.triggerAttackRelease(chimeFreq, '4n', Tone.now(), 0.7 + d.ring * 0.3);
            }
        }
        if (this._shimmerReverb) {
            this._shimmerReverb.wet.value = 0.3 + d.ring * 0.7;
        }
        if (this.ringContinuous) {
            // High triangle drone that swells with ring distance
            this.ringContinuous.volume.rampTo(-35 + d.ring * 20, 0.05);
        }

        // === PINKY: Sub Cannon + Distortion ===
        // Distance: 0 = clean silence, 1 = massive distorted sub bass earthquake
        // Completely different from ring — LOW and DIRTY vs ring's HIGH and CLEAN
        if (this.fingerSynths.pinky) {
            if (prevExt.pinky < 0.2 && d.pinky > 0.35 && (now - cooldowns.pinky) > this.FINGER_COOLDOWN_MS) {
                cooldowns.pinky = now;
                this.fingerSynths.pinky.triggerAttackRelease('C1', '2n', Tone.now(), 0.9);
            }
        }
        if (this.distortion) {
            this.distortion.distortion = Math.pow(d.pinky, 1.5) * 0.8;
            this.distortion.wet.value = d.pinky * 0.7;
        }
        if (this.pinkyContinuous) {
            this.pinkyContinuous.volume.rampTo(-35 + d.pinky * 22, 0.05);
        }

        // === WRIST ANGLE: Massive tonal modulation ===
        // -1 = tilted left, 0 = straight up, +1 = tilted right
        // Controls: master filter cutoff, pad detune, delay time, chorus speed
        const wristAngle = gestureData.wristAngle || 0;
        const absAngle = Math.abs(wristAngle);

        // Master filter: straight up = bright (16kHz), tilted = dark (200Hz)
        if (this.filter) {
            const filterCutoff = 16000 * Math.pow(0.02, absAngle); // 16kHz → ~300Hz
            this.filter.frequency.rampTo(filterCutoff, 0.1);
        }

        // Pad detune: tilted = detuned/dissonant, up to ±100 cents
        this.padSynths.forEach(padData => {
            padData.synth.detune.rampTo(wristAngle * 100, 0.1);
            if (padData.harmonySynth) padData.harmonySynth.detune.rampTo(-wristAngle * 80, 0.1);
        });

        // Delay time shift: tilted right = longer delay, left = shorter
        if (this.delay) {
            const baseDelay = 0.2; // ~8th note
            const delayShift = baseDelay + wristAngle * 0.15; // 0.05 → 0.35
            try { this.delay.delayTime.rampTo(Math.max(0.01, delayShift), 0.1); } catch(e) {}
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
        // GLITCH-HOP TEXTURES — finger distance = repeat rate + character
        // Slower BPM range, randomized params per hit, organic not mechanical
        // Middle=blip, Ring=grain, Pinky=wash, Thumb=zap trigger
        // =====================================================================

        const DEAD_ZONE = 0.12;
        const MIN_BPM = 50;   // slow groove
        const MAX_BPM = 180;  // glitch-hop fast, not machine-gun

        const distToInterval = (dist) => {
            if (dist < DEAD_ZONE) return Infinity;
            const t = (dist - DEAD_ZONE) / (1 - DEAD_ZONE);
            const bpm = MIN_BPM + Math.pow(t, 1.5) * (MAX_BPM - MIN_BPM); // exponential curve
            return 60000 / bpm;
        };

        // Random helper
        const rnd = (min, max) => min + Math.random() * (max - min);

        // --- MIDDLE: Glitch Blip — random pitch each hit, melodic texture ---
        const blipInterval = distToInterval(d.middle);
        if (blipInterval < Infinity && (now - this._drumBeatTimers.blip) > blipInterval) {
            this._drumBeatTimers.blip = now;
            try {
                // Random pitch from a pentatonic set, octave varies with distance
                const baseNotes = [60, 63, 65, 67, 70, 72, 75, 77]; // C minor pentatonic MIDI
                const note = baseNotes[Math.floor(Math.random() * baseNotes.length)];
                const octaveShift = Math.floor(d.middle * 3) * 12; // higher octaves when extended
                const freq = Tone.Frequency(note + octaveShift, 'midi').toFrequency();
                this._glitchBlip.triggerAttackRelease(freq, '64n', Tone.now(), 0.5 + d.middle * 0.4);
            } catch(e) {}
        }

        // --- RING: Filtered Grain — random filter freq, organic texture ---
        const grainInterval = distToInterval(d.ring);
        if (grainInterval < Infinity && (now - this._drumBeatTimers.grain) > grainInterval) {
            this._drumBeatTimers.grain = now;
            try {
                // Randomize filter frequency each hit for organic character
                this._grainFilter.frequency.value = rnd(800, 6000 + d.ring * 8000);
                this._grainFilter.Q.value = rnd(4, 15);
                this._grainSynth.triggerAttackRelease('64n', Tone.now(), 0.4 + d.ring * 0.4);
            } catch(e) {}
        }

        // --- PINKY: Textured Wash — evolving filtered noise, not clappy ---
        const washInterval = distToInterval(d.pinky);
        if (washInterval < Infinity && (now - this._drumBeatTimers.wash) > washInterval) {
            this._drumBeatTimers.wash = now;
            try {
                // Sweep filter with each hit, randomized
                this._washFilter.frequency.value = rnd(500, 4000 + d.pinky * 5000);
                this._washSynth.triggerAttackRelease('16n', Tone.now(), 0.3 + d.pinky * 0.4);
            } catch(e) {}
        }

        // --- THUMB: Glitch zap on extend ---
        if (this.drumThumbSynth) {
            if (prevExt.thumb < 0.2 && d.thumb > 0.35 && (now - (cooldowns.thumb || 0)) > 200) {
                cooldowns.thumb = now;
                const zapNote = ['C4','E4','G4','Bb4'][Math.floor(Math.random() * 4)];
                try {
                    this.drumThumbSynth.triggerAttackRelease(zapNote, '64n', Tone.now(), 0.7);
                } catch(e) {}
            }
        }

        // === WRIST ANGLE: shifts glitch character ===
        const drumWristAngle = gestureData.wristAngle || 0;
        const drumAbsAngle = Math.abs(drumWristAngle);
        // Tilt darkens the grain filter and lengthens wash
        if (this._grainFilter) {
            this._grainFilter.frequency.value *= (1 - drumAbsAngle * 0.5);
        }
        if (this._washFilter) {
            this._washFilter.Q.value = 2 + drumAbsAngle * 8;
        }

        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
            prevExt[f] = d[f];
        }
    }

    // --- Finger Expression ---

    updateFingerExpression(params) {
        // Wrist angle now handles most modulation in updateGesture
    }

    // --- Finger Touch Sounds ---
    // Unique sound per finger, triggered when any two fingertips meet

    // Pre-allocate touch synths (called once during start)
    _initTouchSynths() {
        // Pre-allocated synths — NO dynamic allocation, NO memory leak
        this._touchSynths = {};

        // Thumb: Water drip
        this._touchSynths.thumb = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 }
        }).connect(this.reverb || this.limiter);
        this._touchSynths.thumb.volume.value = -6;

        // Index: Bubble pop
        this._touchSynths.index = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }
        }).connect(this._shimmerReverb || this.reverb || this.limiter);
        this._touchSynths.index.volume.value = -4;

        // Middle: Sparkle
        this._touchSynths.middle = new Tone.MetalSynth({
            harmonicity: 8, modulationIndex: 16,
            resonance: 5000, octaves: 0.5,
            envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.15 }
        }).connect(this._shimmerReverb || this.reverb || this.limiter);
        this._touchSynths.middle.volume.value = -8;

        // Ring: Glass chime
        this._touchSynths.ring = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 }
        }).connect(this._shimmerReverb || this.reverb || this.limiter);
        this._touchSynths.ring.volume.value = -4;

        // Pinky: Zap spark
        this._touchSynths.pinky = new Tone.FMSynth({
            harmonicity: 12, modulationIndex: 30,
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 },
            modulation: { type: 'sawtooth' },
            modulationEnvelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
        }).connect(this.delay || this.limiter);
        this._touchSynths.pinky.volume.value = -6;

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
            switch (primary) {
                case 'thumb':
                    this._touchSynths.thumb.triggerAttackRelease('G5', '32n', Tone.now(), 0.7);
                    break;
                case 'index':
                    this._touchSynths.index.triggerAttackRelease('C5', '64n', Tone.now(), 0.8);
                    break;
                case 'middle':
                    this._touchSynths.middle.triggerAttackRelease('32n', Tone.now(), 0.6);
                    break;
                case 'ring': {
                    const chimeNote = ['E6', 'G6', 'B6', 'D7'][Math.floor(Math.random() * 4)];
                    this._touchSynths.ring.triggerAttackRelease(chimeNote, '16n', Tone.now(), 0.7);
                    break;
                }
                case 'pinky':
                    this._touchSynths.pinky.triggerAttackRelease('A5', '64n', Tone.now(), 0.9);
                    break;
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
            if (padData.harmonySynth) padData.harmonySynth.triggerRelease(Tone.now());
            try { padData.synth.disconnect(); } catch(e) {}
            try { if (padData.harmonySynth) padData.harmonySynth.disconnect(); } catch(e) {}
            setTimeout(() => {
                try { padData.synth.dispose(); } catch(e) {}
                try { if (padData.harmonySynth) padData.harmonySynth.dispose(); } catch(e) {}
            }, 1000);
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
        this._drumBeatTimers = { blip: 0, grain: 0, wash: 0 };

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
