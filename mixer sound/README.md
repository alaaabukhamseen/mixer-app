# 🎙️ AuraMixer Studio — Soundboard & Live Voice Changer

A high-performance, low-latency audio mixer for Linux featuring a **Discord-style MP3 soundboard**, a **real-time live voice changer** (Man's voice, Child's voice, Deep Voice, Robot, Demon, Helium, Walkie-talkie, and more), and **native PipeWire Virtual Microphone routing** so your friends in Discord and voice games hear everything live.

---

## ⚡ Quick Start

### 1. Launch the App
In your terminal, navigate to the project directory and run:
```bash
cd "mixer sound"
./start.sh
```
This will:
1. Initialize the PipeWire **Virtual Microphone** (`Soundboard Virtual Mic`).
2. Start the local server on `http://localhost:3030`.
3. Automatically open the modern UI in your browser.

*(Or run `npm start` / `node server.js` manually if you prefer).*

---

## 🎧 Connecting to Discord (30 Seconds Setup)

1. Open **Discord** &rarr; Click the **User Settings (Gear icon)** in the bottom left.
2. Select **Voice & Video** under App Settings.
3. Under **INPUT DEVICE**, select:
   ```
   Soundboard Virtual Mic
   ```
4. Under **OUTPUT DEVICE**, keep your normal **Headphones / Speakers**.
5. **Important**: Under **Voice Processing**, turn **Noise Suppression (Krisp)** to **None / Standard**. (This prevents Discord from accidentally filtering out your sound effects).
6. In AuraMixer, click **"Hear Myself" (H)** to hear your voice and the soundboard in your headphones. Monitoring starts **off** so speakers do not feed back; use headphones when it is on.

---

## ✨ Features & Capabilities

### 1. 🔊 Discord-Style Soundboard
- **11 Preloaded Instant Sounds**:
  - 💥 **Vine Boom** (Deep sub thud)
  - 🎺 **Airhorn** (Classic MLG blast)
  - 🥁 **Ba-Dum-Tss** (Joke punchline)
  - 🗣️ **Bruh** (Classic vocal)
  - 🔔 **Discord Join** & 🚪 **Discord Leave** chimes
  - 🔧 **Metal Pipe** (Acoustic clatter)
  - 🦆 **Quack** (Cartoon squeak)
  - 🎮 **Victory Fanfare** (8-bit arpeggio)
  - 🚨 **Error Buzzer** (Game show buzzer)
  - ⚡ **Sci-Fi Laser** (Blaster sweep)
- **Add Your Own MP3s / Audio**:
  - Drag and drop any `.mp3`, `.wav`, `.ogg`, or `.webm` file directly onto the soundboard.
  - Custom sounds are saved to disk permanently in `./public/sounds/`.
- **Keyboard Hotkeys**:
  - Pre-bound to number keys `1` through `9`, `0`, and letters.
  - Click the **⌨️ icon** on any sound pad to bind any custom hotkey you want.
  - **STOP ALL Panic Key**: Press `Escape` to instantly cut off all playing sounds.

### 2. 🎛️ Real-Time Live Voice Changer
Continuous, ultra-low latency voice transformation using a custom Web Audio `AudioWorklet`:
- 🧔 **Man's Voice**: Warm chest resonance, lower formant, pitch shifted -3 semitones.
- 🧒 **Child's Voice**: Youthful high pitch (+6 semitones) and bright juvenile formant.
- 🗿 **Deep Voice / Titan**: Ultra-low sub rumble (-7 semitones) with thick saturation.
- 🐿️ **Chipmunk / Helium**: Hyper-speed cartoon squeak (+10 semitones).
- 🤖 **Robot / Cyberpunk**: Ring-modulated 55Hz carrier oscillator with bandpass telephone filter.
- 😈 **Demon / Underworld**: -9 semitones pitch shift, sub-octave distortion, and metallic feedback delay.
- 📻 **Walkie-Talkie / Radio**: Police dispatch bandpass (450Hz - 2.8kHz) with analog grit.
- 🏛️ **Cathedral / Cave**: Expansive reverberation with stereo delay.
- 👽 **Alien Extraterrestrial**: Sci-fi modulation and otherworldly resonance.
- 🎙️ **Studio Clean (Bypass)**: Crystal clear voice with broadcast noise gate.
- **Pro Fine-Tuning Rack**:
  - Pitch Shift (-14 to +14 semitones)
  - Formant / Tone (Deep to Bright)
  - Reverb & Space (0% to 100%)
  - Distortion & Drive (0% to 100%)
  - Robot Modulation Rate (0 to 120Hz)
  - Echo Delay (0ms to 600ms)

### 3. 🎚️ 4-Channel Audio Mixer Console
- **Mic In**: Adjust your physical microphone input gain.
- **Voice FX**: Adjust the level of your voice changer output.
- **Sounds**: Independent volume control for the soundboard.
- **Master**: Overall output level sent to Discord.
- **VU Meters**: Live signal level indicators.
- **Noise Gate Slider**: Suppresses room hiss, fan noise, and background sounds.
- **Real-Time Visualizer**: Switchable between Neon Oscilloscope Waveform and 36-Band Spectrum Analyzer.

---

## 🛠️ CLI & Management Commands

| Command | Description |
|---|---|
| `./start.sh` | Launch everything (Virtual mic + server + browser) |
| `./virtual-mic.sh start` | Manually start PipeWire virtual microphone |
| `./virtual-mic.sh stop` | Manually stop PipeWire virtual microphone |
| `./virtual-mic.sh status` | Check if virtual mic is active in PipeWire |
| `./virtual-mic.sh link` | Fallback: route browser audio into the virtual mic |
| `./virtual-mic.sh unlink` | Remove the browser-audio fallback links |
| `npm run generate-sounds` | Regenerate default soundboard WAV files |
| `node server.js` | Run server only |

---

## ⌨️ Default Keyboard Shortcuts
- `1` - `9`, `0`: Trigger preloaded soundboard sounds
- `Esc`: **Panic button** (Stops all playing sounds immediately)
- `M`: Toggle Microphone On/Off (Mute)
- `H`: Toggle "Hear Myself" (Headphone Monitor) On/Off

---

## 📦 Moving to Another PC

This folder is fully self-contained — copy the whole `mixer sound` folder to the other PC (or clone your repo) and run it from there. Nothing is tied to the original path.

Requirements on the new PC:
- **Linux** with **PipeWire** and WirePlumber (for the virtual mic)
- **Node.js** (v18+) — `node server.js` or `./start.sh`
- PipeWire tools: `pw-cli`, `pw-link`, `wpctl`, `pw-play`, `pw-record`
- A **Chromium-based browser** (Chrome / Brave / Edge) for per-tab audio routing

No `npm install` is needed — the app uses only Node's built-in modules. Then:
```bash
cd "mixer sound"
./start.sh
```
Select **Soundboard Virtual Mic** as the input device in your voice app, click **Start mic** in AuraMixer, and you are live.
