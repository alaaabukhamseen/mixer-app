/* ==========================================================================
   AuraMixer noise gate — AudioWorklet
   Downward expander with RMS detection, attack/release smoothing and a short
   hold so word tails are not chopped. `threshold` is in dBFS (-90 … -20).
   ========================================================================== */

class NoiseGateProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'threshold',
                defaultValue: -65,
                minValue: -90,
                maxValue: -20,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor() {
        super();
        this.sampleRate = typeof globalThis.sampleRate === 'number' ? globalThis.sampleRate : 48000;

        this.attack = 0.004;   // seconds to open
        this.release = 0.16;   // seconds to close
        this.hold = 0.09;      // seconds to stay open after signal drops
        this.hysteresis = 4;   // dB below threshold before closing

        this.envelope = 0;     // smoothed mean-square level
        this.gain = 0;         // current gate gain 0…1
        this.holdCounter = 0;  // samples remaining in hold
        this.open = false;
        this.attackCoef = 1 - Math.exp(-1 / (this.attack * this.sampleRate));
        this.releaseCoef = 1 - Math.exp(-1 / (this.release * this.sampleRate));
        this.levelCoef = Math.exp(-1 / (0.012 * this.sampleRate));
        this.holdSamples = Math.max(1, Math.round(this.hold * this.sampleRate));
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const channelCount = output.length;
        const frameCount = output[0]?.length || 0;
        if (!input || input.length === 0 || frameCount === 0) {
            // No input: keep the gate closed rather than leaking a DC tail.
            for (let channel = 0; channel < channelCount; channel++) {
                output[channel].fill(0);
            }
            return true;
        }

        const threshold = parameters.threshold[0];
        const closeThreshold = threshold - this.hysteresis;
        const sourceChannels = input.length;

        for (let i = 0; i < frameCount; i++) {
            // Mean-square across channels so a quiet stereo side cannot hold
            // the gate open on its own.
            let sumSquares = 0;
            for (let channel = 0; channel < sourceChannels; channel++) {
                const sample = input[channel]?.[i] || 0;
                sumSquares += sample * sample;
            }
            const meanSquare = sumSquares / sourceChannels;
            this.envelope = meanSquare + this.levelCoef * (this.envelope - meanSquare);

            const db = 10 * Math.log10(this.envelope + 1e-12);
            if (db >= threshold) {
                this.open = true;
                this.holdCounter = this.holdSamples;
            } else if (db < closeThreshold) {
                if (this.holdCounter > 0) {
                    this.holdCounter--;
                } else {
                    this.open = false;
                }
            } else {
                // Inside the hysteresis band: keep the previous state.
                if (this.open && this.holdCounter > 0) this.holdCounter--;
            }

            const target = this.open ? 1 : 0;
            const coef = target > this.gain ? this.attackCoef : this.releaseCoef;
            this.gain += coef * (target - this.gain);
            if (this.gain < 1e-5) this.gain = 0;
            if (this.gain > 0.99995) this.gain = 1;

            for (let channel = 0; channel < channelCount; channel++) {
                const sample = input[channel]?.[i] || 0;
                output[channel][i] = sample * this.gain;
            }
        }

        return true;
    }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
