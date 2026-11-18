// generate-sounds.js - Generates preloaded soundboard WAV files
const fs = require('fs');
const path = require('path');

const soundsDir = path.join(__dirname, 'public', 'sounds');
if (!fs.existsSync(soundsDir)) {
    fs.mkdirSync(soundsDir, { recursive: true });
}

function createWavHeader(numChannels, sampleRate, numFrames) {
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34); // BitsPerSample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
}

function writeWav(filename, sampleRate, samples) {
    const header = createWavHeader(1, sampleRate, samples.length);
    const dataBuffer = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
        // Clamp -1.0 to 1.0 and convert to 16-bit PCM
        const s = Math.max(-1.0, Math.min(1.0, samples[i]));
        const val = s < 0 ? s * 32768 : s * 32767;
        dataBuffer.writeInt16LE(Math.floor(val), i * 2);
    }
    const fullBuffer = Buffer.concat([header, dataBuffer]);
    fs.writeFileSync(path.join(soundsDir, filename), fullBuffer);
    console.log(`Generated: ${filename} (${(samples.length / sampleRate).toFixed(2)}s)`);
}

const SR = 44100;

// 1. Vine Boom: Punchy sub-bass drop with low-pass distortion and long decay
{
    const duration = 2.2;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-t * 2.8);
        const pitch = 95 * Math.exp(-t * 6.0) + 38;
        const sub = Math.sin(2 * Math.PI * pitch * t);
        const harmonic = 0.3 * Math.sin(4 * Math.PI * pitch * t) * Math.exp(-t * 8);
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 25) * 0.4;
        let s = (sub + harmonic + noise) * env * 1.5;
        // Soft clipping
        s = Math.tanh(s * 1.8);
        samples[i] = s * 0.9;
    }
    writeWav('vine-boom.wav', SR, samples);
}

// 2. Airhorn: Classic MLG 3-tone layered brass blast
{
    const blastDuration = 0.16;
    const gap = 0.05;
    const totalDuration = (blastDuration * 4) + (gap * 3) + 0.5;
    const N = Math.floor(SR * totalDuration);
    const samples = new Float32Array(N);

    const blasts = [
        { start: 0.0, len: 0.14 },
        { start: 0.18, len: 0.14 },
        { start: 0.36, len: 0.14 },
        { start: 0.54, len: 0.45 }
    ];

    const baseFreqs = [466.16, 587.33, 698.46, 932.33]; // Bb chord tones

    for (let i = 0; i < N; i++) {
        const t = i / SR;
        let s = 0;
        for (const blast of blasts) {
            if (t >= blast.start && t < blast.start + blast.len) {
                const bt = t - blast.start;
                const env = Math.min(bt / 0.015, 1) * Math.pow(1 - (bt / blast.len), 0.3);
                for (let k = 0; k < baseFreqs.length; k++) {
                    const f = baseFreqs[k];
                    // Pulse / brass wave
                    const square = Math.sin(2 * Math.PI * f * t) > 0 ? 0.3 : -0.3;
                    const saw = ((bt * f) % 1.0) * 0.4 - 0.2;
                    s += (square + saw) * env * 0.35;
                }
            }
        }
        samples[i] = Math.tanh(s) * 0.85;
    }
    writeWav('airhorn.wav', SR, samples);
}

// 3. Ba-Dum-Tss: Drum kit joke punchline
{
    const duration = 2.0;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);

    // Hits: Kick (0.0), Snare (0.28), Cymbal Crash (0.62)
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        let s = 0;

        // "Ba" (Tom/Kick 1 at 0.0s)
        if (t >= 0.0 && t < 0.25) {
            const bt = t;
            const env = Math.exp(-bt * 18);
            const f = 140 * Math.exp(-bt * 25) + 60;
            s += Math.sin(2 * Math.PI * f * bt) * env * 0.8;
        }

        // "Dum" (Tom/Snare at 0.28s)
        if (t >= 0.28 && t < 0.58) {
            const bt = t - 0.28;
            const env = Math.exp(-bt * 15);
            const f = 160 * Math.exp(-bt * 20) + 75;
            s += Math.sin(2 * Math.PI * f * bt) * env * 0.85;
        }

        // "Tss" (Crash Cymbal at 0.60s)
        if (t >= 0.60) {
            const bt = t - 0.60;
            const env = Math.exp(-bt * 3.5);
            // High frequency metallic noise
            const noise = (Math.random() * 2 - 1);
            const metallic = Math.sin(2 * Math.PI * 4200 * bt) * 0.3 + Math.sin(2 * Math.PI * 6700 * bt) * 0.2;
            s += (noise * 0.7 + metallic) * env * 0.65;
        }

        samples[i] = Math.tanh(s) * 0.85;
    }
    writeWav('badumtss.wav', SR, samples);
}

// 4. Discord User Join Chime (Melodic two-tone ping)
{
    const duration = 1.2;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    // Tone 1: E5 (659Hz) at 0.0s, Tone 2: G#5 (830Hz) at 0.15s
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        let s = 0;
        if (t >= 0.0) {
            const env1 = Math.exp(-t * 6.5);
            s += (Math.sin(2 * Math.PI * 659.25 * t) + 0.3 * Math.sin(2 * Math.PI * 1318.5 * t)) * env1 * 0.45;
        }
        if (t >= 0.15) {
            const t2 = t - 0.15;
            const env2 = Math.exp(-t2 * 4.5);
            s += (Math.sin(2 * Math.PI * 830.61 * t2) + 0.3 * Math.sin(2 * Math.PI * 1661.2 * t2)) * env2 * 0.55;
        }
        samples[i] = Math.tanh(s) * 0.85;
    }
    writeWav('discord-join.wav', SR, samples);
}

// 5. Discord User Leave Chime (Descending two-tone ping)
{
    const duration = 1.2;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        let s = 0;
        if (t >= 0.0) {
            const env1 = Math.exp(-t * 6.0);
            s += (Math.sin(2 * Math.PI * 830.61 * t) + 0.3 * Math.sin(2 * Math.PI * 1661.2 * t)) * env1 * 0.5;
        }
        if (t >= 0.15) {
            const t2 = t - 0.15;
            const env2 = Math.exp(-t2 * 4.5);
            s += (Math.sin(2 * Math.PI * 554.37 * t2) + 0.3 * Math.sin(2 * Math.PI * 1108.7 * t2)) * env2 * 0.55;
        }
        samples[i] = Math.tanh(s) * 0.85;
    }
    writeWav('discord-leave.wav', SR, samples);
}

// 6. Metal Pipe (Resonant clattering acoustic clang)
{
    const duration = 2.5;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    const resonances = [520, 890, 1340, 1920, 2670, 3450];
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        let s = 0;
        const transient = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.7;
        for (let r = 0; r < resonances.length; r++) {
            const freq = resonances[r] + (Math.sin(t * 12) * 5);
            const decay = 2.0 + r * 1.2;
            s += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * decay) * (0.5 / (r + 1));
        }
        // Small secondary bounce at 0.18s
        if (t > 0.18) {
            const t2 = t - 0.18;
            s += Math.sin(2 * Math.PI * 1100 * t2) * Math.exp(-t2 * 12) * 0.35;
        }
        samples[i] = Math.tanh((s + transient) * 1.6) * 0.85;
    }
    writeWav('metal-pipe.wav', SR, samples);
}

// 7. Bruh (Low vocal formant simulation)
{
    const duration = 0.85;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.sin(Math.PI * Math.min(t / 0.75, 1.0));
        // Pitch falls from 115Hz to 85Hz
        const pitch = 115 - (t * 38);
        const f1 = 450; // formant 1 "uh"
        const f2 = 900; // formant 2
        const voice = Math.sin(2 * Math.PI * pitch * t);
        const formants = Math.sin(2 * Math.PI * f1 * t) * 0.4 + Math.sin(2 * Math.PI * f2 * t) * 0.25;
        let s = (voice * 0.5 + formants) * env;
        samples[i] = Math.tanh(s * 1.5) * 0.9;
    }
    writeWav('bruh.wav', SR, samples);
}

// 8. Quack (Squeaky cartoon duck)
{
    const duration = 0.6;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-t * 5.0) * Math.sin(Math.PI * Math.min(t / 0.05, 1));
        const pitch = 280 + Math.sin(2 * Math.PI * 35 * t) * 40 - (t * 120);
        // Nasal formants at 750Hz and 1800Hz
        const wave = ((t * pitch) % 1.0) * 2 - 1;
        const nasal = Math.sin(2 * Math.PI * 850 * t) * 0.5 + Math.sin(2 * Math.PI * 1750 * t) * 0.3;
        let s = (wave * 0.4 + nasal) * env;
        samples[i] = Math.tanh(s * 1.8) * 0.85;
    }
    writeWav('quack.wav', SR, samples);
}

// 9. Victory Fanfare (8-bit celebratory arpeggio)
{
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
    const noteLen = 0.09;
    const totalDuration = (notes.length * noteLen) + 0.6;
    const N = Math.floor(SR * totalDuration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        let s = 0;
        const noteIdx = Math.min(Math.floor(t / noteLen), notes.length - 1);
        const noteTime = t - (noteIdx * noteLen);
        const freq = notes[noteIdx];
        const isLast = noteIdx === notes.length - 1;
        const env = isLast ? Math.exp(-noteTime * 2.5) : Math.pow(1 - (noteTime / noteLen), 0.5);
        // 8-bit square wave with slight vibrato
        const vibrato = Math.sin(2 * Math.PI * 6 * t) * 4;
        const square = Math.sin(2 * Math.PI * (freq + vibrato) * t) > 0 ? 0.35 : -0.35;
        const square2 = Math.sin(4 * Math.PI * (freq + vibrato) * t) > 0 ? 0.15 : -0.15;
        s = (square + square2) * env;
        samples[i] = s * 0.8;
    }
    writeWav('victory.wav', SR, samples);
}

// 10. Buzzer (Harsh game-show error buzz)
{
    const duration = 0.9;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-t * 2.2);
        // Low dissonant saw / square
        const s1 = Math.sin(2 * Math.PI * 85 * t) > 0 ? 0.4 : -0.4;
        const s2 = Math.sin(2 * Math.PI * 122 * t) > 0 ? 0.4 : -0.4;
        samples[i] = (s1 + s2) * env * 0.85;
    }
    writeWav('buzzer.wav', SR, samples);
}

// 11. Laser (Sci-Fi blaster sweep)
{
    const duration = 0.55;
    const N = Math.floor(SR * duration);
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-t * 7.5);
        // Rapid pitch sweep from 2400Hz down to 80Hz
        const f = 2400 * Math.exp(-t * 18) + 80;
        const s = Math.sin(2 * Math.PI * f * t);
        samples[i] = s * env * 0.85;
    }
    writeWav('laser.wav', SR, samples);
}

console.log('All 11 soundboard sounds generated successfully!');
