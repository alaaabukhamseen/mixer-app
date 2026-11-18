/* ==========================================================================
   AuraMixer PCM capture — AudioWorklet
   Buffers the mixed feed into small interleaved stereo chunks and sends them
   to the main thread, which posts them to the local server. The server writes
   them to a dedicated pw-play stream targeting the virtual sink. This keeps
   the Discord feed isolated from all other browser audio (no echo).
   ========================================================================== */

class PcmCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.capacity = 2048 * 2; // 2048 stereo frames, interleaved
        this.buf = new Float32Array(this.capacity);
        this.offset = 0;
        this.seq = 0;
        this.enabled = false;

        this.port.onmessage = (event) => {
            if (event.data && event.data.type === 'enable') {
                this.enabled = Boolean(event.data.value);
            } else if (event.data && event.data.type === 'reset') {
                this.seq = 0;
                this.offset = 0;
            }
        };
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input.length || !input[0]) return true;

        const left = input[0];
        const right = input[1] || input[0];

        for (let i = 0; i < left.length; i += 1) {
            this.buf[this.offset++] = left[i];
            this.buf[this.offset++] = right[i];

            if (this.offset >= this.capacity) {
                const chunk = this.buf.slice();
                this.offset = 0;
                if (this.enabled) {
                    this.port.postMessage(
                        { type: 'pcm', seq: this.seq++, chunk },
                        [chunk.buffer]
                    );
                }
            }
        }
        return true;
    }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
