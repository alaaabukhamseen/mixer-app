/* ==========================================================================
   AuraMixer Studio — app engine
   Native Web Audio · PipeWire virtual mic · Soundboard & voice changer
   ========================================================================== */
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    const PREFS_KEY = 'auramixer.prefs.v1';
    const KEYS_KEY = 'auramixer.keybinds.v1';

    const MAX_FILE_BYTES = 28 * 1024 * 1024;
    const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|webm|flac)$/i;
    const MINUS = '\u2212';

    // PipeWire nodes created by virtual-mic.sh. The source must never be used as
    // this app's microphone input, otherwise the mix is re-processed in a loop.
    const VIRTUAL_SINK_LABEL = /soundboard\s*&\s*voice changer|soundboard sink/i;
    const VIRTUAL_ANY_LABEL = /soundboard\s*&\s*voice changer|soundboard virtual mic|discord soundboard virtual mic|virtual mic/i;

    const DEFAULT_SOUNDS = [
        { name: 'Vine Boom', file: 'vine-boom.wav', icon: '💥', key: '1' },
        { name: 'Airhorn', file: 'airhorn.wav', icon: '🎺', key: '2' },
        { name: 'Ba-Dum-Tss', file: 'badumtss.wav', icon: '🥁', key: '3' },
        { name: 'Bruh', file: 'bruh.wav', icon: '🗣️', key: '4' },
        { name: 'Discord Join', file: 'discord-join.wav', icon: '🔔', key: '5' },
        { name: 'Discord Leave', file: 'discord-leave.wav', icon: '🚪', key: '6' },
        { name: 'Metal Pipe', file: 'metal-pipe.wav', icon: '🔧', key: '7' },
        { name: 'Quack Duck', file: 'quack.wav', icon: '🦆', key: '8' },
        { name: 'Victory Fanfare', file: 'victory.wav', icon: '🎮', key: '9' },
        { name: 'Error Buzzer', file: 'buzzer.wav', icon: '🚨', key: '0' },
        { name: 'Sci-Fi Laser', file: 'laser.wav', icon: '⚡', key: 'L' }
    ];

    const CUSTOM_ICONS = ['🎵', '🎶', '🔊', '📣', '🎉', '😂', '💬', '🪄', '🎸', '📢', '🎬', '🐸'];

    const VOICE_CHARACTERS = [
        {
            id: 'normal', name: 'Normal voice', desc: '100% natural, untouched microphone',
            icon: '🎙️', tag: '0 st', params: { pitch: 0, tone: 0 }
        },
        {
            id: 'man', name: "Man's voice", desc: 'Warm chest resonance, natural low end',
            icon: '🧔', tag: '−2.5 st', params: { pitch: -2.5, tone: -3 }
        },
        {
            id: 'child', name: "Child's voice", desc: 'Bright and youthful without the squeak',
            icon: '🧒', tag: '+3.5 st', params: { pitch: 3.5, tone: 3 }
        },
        {
            id: 'deep', name: 'Deep baritone', desc: 'Deep, crisp and authoritative',
            icon: '🗿', tag: '−4.5 st', params: { pitch: -4.5, tone: -5 }
        },
        {
            id: 'woman', name: "Woman's voice", desc: 'Smooth tone with bright upper mids',
            icon: '👩', tag: '+2.5 st', params: { pitch: 2.5, tone: 2 }
        },
        {
            id: 'chipmunk', name: 'High pitch', desc: 'Playful cartoon high pitch',
            icon: '🐿️', tag: '+5.5 st', params: { pitch: 5.5, tone: 4 }
        }
    ];

    const RESERVED_KEYS = new Set([
        'Escape', 'Tab', 'Enter', ' ', 'Spacebar', 'Backspace', 'Delete',
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Home', 'End',
        'PageUp', 'PageDown', 'M', 'H', '/'
    ]);

    const DEFAULTS = {
        micId: '',
        outputId: '',
        monitorId: '',
        echoCancel: true,
        monitor: false,
        gate: -65,
        viz: 'bars',
        faders: { mic: 1, voice: 1, soundboard: 1, master: 1 },
        voice: 'normal',
        basePitch: 0,
        baseTone: 0,
        fx: {
            reverb: 0, echo: 0, drive: 0, robot: 0,
            radio: false, demon: false, cave: false
        }
    };

    const state = {
        ctx: null,
        micStream: null,
        micSource: null,
        micActive: false,
        micBusy: false,
        monitorActive: false,
        fallbackMode: false,
        virtualMicActive: false,
        vmBusy: false,
        vmOffline: false,
        routeOk: false,
        routeWarned: false,
        pitchReady: false,
        gateReady: false,
        captureReady: false,
        vmFeedActive: false,
        vizMode: 'bars',
        vizSignalAt: 0,
        lastVizIdle: null,
        prefs: null,
        keybinds: {},
        sounds: [],
        playing: new Map(),
        loading: new Set(),
        keybindTarget: null,
        modals: [],
        lastFocus: null,
        meterLevels: { mic: 0, voice: 0, soundboard: 0, master: 0 },
        meterBufs: new Map(),
        uploadBusy: false,
        soundCache: new Map(),
        audioInitPromise: null,
        waveCache: new Map(),
        durationCache: new Map(),
        decodeContext: null,
        filter: 'all',
        dragId: null,
        editTarget: null,
        editDraft: null,
        trash: [],
        trashLoading: false,
        monitorRouted: false,
        monitorOverride: false,
        monitorWarned: false,
        devices: { inputs: [], outputs: [] },
        micDeviceId: ''
    };

    // Audio nodes -----------------------------------------------------------------
    const nodes = {
        gate: null,
        micGain: null,
        highPass: null,
        lowShelf: null,
        peak: null,
        highShelf: null,
        pitch: null,
        shaper: null,
        ringMod: null,
        ringDepth: null,
        ringOsc: null,
        radioHP: null,
        radioLP: null,
        voiceBus: null,
        soundboardBus: null,
        master: null,
        monitor: null,
        delay: null,
        feedback: null,
        delayWet: null,
        convolver: null,
        reverbWet: null,
        streamDest: null,
        limiter: null,
        monitorDest: null,
        monitorEl: null,
        analysers: { mic: null, voice: null, soundboard: null, master: null }
    };

    // DOM -------------------------------------------------------------------------
    const el = {
        virtualMicPill: $('virtualMicPill'),
        virtualMicStatusText: $('virtualMicStatusText'),
        btnDiscordGuide: $('btnDiscordGuide'),
        btnMicToggle: $('btnMicToggle'),
        micIcon: $('micIcon'),
        micText: $('micText'),
        btnMonitorToggle: $('btnMonitorToggle'),
        monitorText: $('monitorText'),
        btnStopAll: $('btnStopAll'),
        engineChip: $('engineChip'),
        btnRouteAudio: $('btnRouteAudio'),

        faderMic: $('faderMic'),
        faderVoice: $('faderVoice'),
        faderSoundboard: $('faderSoundboard'),
        faderMaster: $('faderMaster'),
        valMic: $('valMic'),
        valVoice: $('valVoice'),
        valSoundboard: $('valSoundboard'),
        valMaster: $('valMaster'),
        vuMic: $('vuMic'),
        vuVoice: $('vuVoice'),
        vuSoundboard: $('vuSoundboard'),
        vuMaster: $('vuMaster'),

        canvas: $('audioVisualizer'),
        vizIdle: $('vizIdle'),
        vizLiveDot: $('vizLiveDot'),
        btnVisWave: $('btnVisWave'),
        btnVisBars: $('btnVisBars'),

        toggleEchoCancel: $('toggleEchoCancel'),
        noiseGateSlider: $('noiseGateSlider'),
        noiseGateVal: $('noiseGateVal'),
        selectMicDevice: $('selectMicDevice'),
        selectOutputDevice: $('selectOutputDevice'),
        selectMonitorDevice: $('selectMonitorDevice'),
        monitorRouteStatus: $('monitorRouteStatus'),
        monitorDeviceHint: $('monitorDeviceHint'),
        routeStatus: $('routeStatus'),

        activePresetTag: $('activePresetTag'),
        btnClearEffects: $('btnClearEffects'),
        activeVoiceAvatar: $('activeVoiceAvatar'),
        activeVoiceName: $('activeVoiceName'),
        activeVoiceDesc: $('activeVoiceDesc'),
        btnResetVoice: $('btnResetVoice'),
        presetsGrid: $('presetsGrid'),
        effectsStatusBadge: $('effectsStatusBadge'),
        btnFxRobot: $('btnFxRobot'),
        btnFxRadio: $('btnFxRadio'),
        btnFxDemon: $('btnFxDemon'),
        btnFxCave: $('btnFxCave'),
        sliderPitch: $('sliderPitch'),
        sliderTone: $('sliderTone'),
        sliderReverb: $('sliderReverb'),
        sliderEcho: $('sliderEcho'),
        sliderDrive: $('sliderDrive'),
        sliderRobot: $('sliderRobot'),
        labelPitch: $('labelPitch'),
        labelTone: $('labelTone'),
        labelReverb: $('labelReverb'),
        labelEcho: $('labelEcho'),
        labelDrive: $('labelDrive'),
        labelRobot: $('labelRobot'),

        soundboardGrid: $('soundboardGrid'),
        soundSearch: $('soundSearch'),
        soundFilters: $('soundFilters'),
        soundDropzone: $('soundDropzone'),
        soundFileInput: $('soundFileInput'),
        btnOpenUpload: $('btnOpenUpload'),
        btnOpenTrash: $('btnOpenTrash'),
        trashCount: $('trashCount'),
        soundCountBadge: $('soundCountBadge'),
        soundEmpty: $('soundEmpty'),

        soundEditModal: $('soundEditModal'),
        soundEditSubtitle: $('soundEditSubtitle'),
        editSoundName: $('editSoundName'),
        editSoundIcon: $('editSoundIcon'),
        editSoundFolder: $('editSoundFolder'),
        editSoundTags: $('editSoundTags'),
        folderOptions: $('folderOptions'),
        editWaveform: $('editWaveform'),
        editDuration: $('editDuration'),
        editVolume: $('editVolume'),
        editVolumeVal: $('editVolumeVal'),
        editTrimStart: $('editTrimStart'),
        editTrimStartVal: $('editTrimStartVal'),
        editTrimEnd: $('editTrimEnd'),
        editTrimEndVal: $('editTrimEndVal'),
        editTrimEndOn: $('editTrimEndOn'),
        editFadeIn: $('editFadeIn'),
        editFadeInVal: $('editFadeInVal'),
        editFadeOut: $('editFadeOut'),
        editFadeOutVal: $('editFadeOutVal'),
        editLoop: $('editLoop'),
        editFavorite: $('editFavorite'),
        btnPreviewSound: $('btnPreviewSound'),
        btnSaveSound: $('btnSaveSound'),

        trashModal: $('trashModal'),
        trashList: $('trashList'),
        btnEmptyTrash: $('btnEmptyTrash'),

        discordModal: $('discordModal'),
        virtualMicModalStatus: $('virtualMicModalStatus'),
        btnStartVirtualMicModal: $('btnStartVirtualMicModal'),
        btnBrowserLink: $('btnBrowserLink'),

        keybindModal: $('keybindModal'),
        keySoundName: $('keySoundName'),
        keyPromptBox: $('keyPromptBox'),
        keybindError: $('keybindError'),
        btnClearKeybind: $('btnClearKeybind'),

        toastStack: $('toastStack')
    };

    const ctx2d = el.canvas.getContext('2d');
    const ICONS = {
        mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
        micOff: '<path d="M9 9v3a3 3 0 0 0 4.6 2.5"/><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 10.7 6.2"/><path d="M12 18v3"/><path d="M8.5 21h7"/><path d="m3 3 18 18"/>'
    };

    // -----------------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------------

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function debounce(fn, delay) {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function loadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const value = JSON.parse(raw);
            return value && typeof value === 'object' ? value : fallback;
        } catch {
            return fallback;
        }
    }

    function loadPrefs() {
        const saved = loadJson(PREFS_KEY, {});
        const prefs = {
            ...DEFAULTS,
            ...saved,
            faders: { ...DEFAULTS.faders, ...(saved.faders || {}) },
            fx: { ...DEFAULTS.fx, ...(saved.fx || {}) }
        };
        prefs.gate = clamp(Number(prefs.gate) || -65, -90, -20);
        prefs.basePitch = clamp(Number(prefs.basePitch) || 0, -12, 12);
        prefs.baseTone = clamp(Number(prefs.baseTone) || 0, -8, 8);
        Object.keys(DEFAULTS.faders).forEach((name) => {
            const v = Number(prefs.faders[name]);
            prefs.faders[name] = Number.isFinite(v) ? clamp(v, 0, 2) : 1;
        });
        ['reverb', 'echo', 'drive', 'robot'].forEach((name) => {
            const limits = { reverb: [0, 100], echo: [0, 500], drive: [0, 100], robot: [0, 100] };
            const v = Number(prefs.fx[name]);
            prefs.fx[name] = Number.isFinite(v) ? clamp(v, limits[name][0], limits[name][1]) : 0;
        });
        prefs.echoCancel = prefs.echoCancel !== false;
        prefs.monitor = prefs.monitor !== false;
        if (!VOICE_CHARACTERS.some((c) => c.id === prefs.voice) && prefs.voice !== 'custom') {
            prefs.voice = 'normal';
        }
        if (!['bars', 'wave'].includes(prefs.viz)) prefs.viz = 'bars';
        return prefs;
    }

    const savePrefs = debounce(() => {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
        } catch { /* storage may be unavailable */ }
    }, 180);

    const saveKeybinds = debounce(() => {
        try {
            localStorage.setItem(KEYS_KEY, JSON.stringify(state.keybinds));
        } catch { /* storage may be unavailable */ }
    }, 120);

    function fmtPercent(value) {
        return `${Math.round(value * 100)}%`;
    }

    function fmtDb(value) {
        return `${value < 0 ? MINUS : ''}${Math.abs(Math.round(value))} dB`;
    }

    function fmtSigned(value, suffix = '') {
        if (value > 0) return `+${value}${suffix}`;
        if (value < 0) return `${MINUS}${Math.abs(value)}${suffix}`;
        return `0${suffix}`;
    }

    function updateRangeFill(input) {
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        const value = Number(input.value) || 0;
        const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
        input.style.setProperty('--fill', `${clamp(pct, 0, 100)}%`);
    }

    function hashString(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        }
        return hash;
    }

    function iconForSound(name) {
        return CUSTOM_ICONS[hashString(name) % CUSTOM_ICONS.length];
    }

    // -----------------------------------------------------------------------------
    // Toasts
    // -----------------------------------------------------------------------------

    function toast(message, type = 'info', timeout = 3800, action = null) {
        if (!message) return;
        const icons = { success: '✓', error: '!', warn: '!', info: 'i' };
        const item = document.createElement('div');
        item.className = `toast toast-${type}`;
        item.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[type] || 'i'}</span><span class="toast-message"></span>`;
        item.querySelector('.toast-message').textContent = message;
        el.toastStack.appendChild(item);

        while (el.toastStack.children.length > 4) {
            el.toastStack.firstElementChild.remove();
        }

        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            item.classList.add('is-leaving');
            setTimeout(() => item.remove(), 220);
        };
        const timer = setTimeout(remove, timeout);
        item.addEventListener('click', () => {
            clearTimeout(timer);
            remove();
        });

        if (action && action.label && typeof action.onClick === 'function') {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'toast-action';
            button.textContent = action.label;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                clearTimeout(timer);
                remove();
                action.onClick();
            });
            item.appendChild(button);
        }
    }

    // -----------------------------------------------------------------------------
    // Modals
    // -----------------------------------------------------------------------------

    function openModal(modal, focusTarget = null) {
        if (!modal || modal.classList.contains('is-open')) return;
        state.lastFocus = document.activeElement;
        if (state.modals.length === 0) document.body.classList.add('modal-open');
        state.modals.push(modal);
        modal.classList.add('is-open');
        const target = focusTarget || modal.querySelector('[data-autofocus], .modal-close, button, select, input');
        if (target) {
            requestAnimationFrame(() => target.focus({ preventScroll: true }));
        }
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('is-open');
        state.modals = state.modals.filter((item) => item !== modal);
        if (state.modals.length === 0) {
            document.body.classList.remove('modal-open');
            if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
                state.lastFocus.focus({ preventScroll: true });
            }
            state.lastFocus = null;
        }
    }

    function setupModals() {
        $$('.modal-backdrop').forEach((backdrop) => {
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) {
                    closeModal(backdrop);
                    if (backdrop === el.keybindModal) closeKeybindModal();
                }
            });
        });

        $$('[data-close]').forEach((button) => {
            button.addEventListener('click', () => {
                const modal = $(button.dataset.close);
                closeModal(modal);
                if (modal === el.keybindModal) closeKeybindModal();
            });
        });

        el.btnCloseModalBtn?.addEventListener('click', () => closeModal(el.discordModal));
    }

    // -----------------------------------------------------------------------------
    // API + virtual mic state
    // -----------------------------------------------------------------------------

    async function api(path, options = {}) {
        const opts = { ...options, headers: { ...(options.headers || {}) } };
        if (opts.body && typeof opts.body !== 'string') {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        const response = await fetch(path, opts);
        let payload = null;
        try {
            payload = await response.json();
        } catch { /* non-json response */ }
        if (!response.ok) {
            throw new Error((payload && payload.error) || `Request failed (${response.status})`);
        }
        return payload || {};
    }

    function setRouteStatus(kind, text) {
        if (!el.routeStatus) return;
        el.routeStatus.className = `route-status ${kind}`;
        const dot = document.createElement('span');
        dot.className = 'route-dot';
        el.routeStatus.replaceChildren(dot, document.createTextNode(text));
    }

    function updateVirtualMicUI() {
        const pill = el.virtualMicPill;
        pill.classList.remove('is-checking', 'is-active', 'is-inactive');

        let text = 'Virtual mic off';
        if (state.vmBusy) {
            pill.classList.add('is-checking');
            text = state.virtualMicActive ? 'Stopping virtual mic…' : 'Starting virtual mic…';
        } else if (state.vmOffline) {
            pill.classList.add('is-inactive');
            text = 'Server offline';
        } else if (state.virtualMicActive) {
            pill.classList.add('is-active');
            text = 'Virtual mic active';
        } else {
            pill.classList.add('is-inactive');
            text = 'Virtual mic off';
        }
        el.virtualMicStatusText.textContent = text;
        pill.setAttribute('aria-pressed', String(state.virtualMicActive));
        pill.title = state.virtualMicActive
            ? 'Virtual microphone is running — select “Soundboard Virtual Mic” as input in any app'
            : 'Virtual microphone is stopped — click to start';

        if (el.virtualMicModalStatus) {
            el.virtualMicModalStatus.classList.remove('is-active', 'is-inactive');
            el.virtualMicModalStatus.classList.add(state.virtualMicActive ? 'is-active' : 'is-inactive');
            const copy = el.virtualMicModalStatus.querySelector('span:last-child');
            if (copy) {
                copy.textContent = state.virtualMicActive
                    ? 'Running — select “Soundboard Virtual Mic” as input in any app'
                    : state.vmBusy
                        ? 'Working on the PipeWire loopback…'
                        : 'Not running — enable it below, then pick it in any app';
            }
        }

        if (el.btnStartVirtualMicModal) {
            el.btnStartVirtualMicModal.disabled = state.virtualMicActive || state.vmBusy;
            el.btnStartVirtualMicModal.textContent = state.virtualMicActive
                ? 'Virtual mic running'
                : state.vmBusy
                    ? 'Working…'
                    : 'Enable virtual mic';
        }

        if (!state.virtualMicActive) {
            setRouteStatus('is-off', 'Virtual mic off');
        }
    }

    async function checkVirtualMicStatus() {
        try {
            const data = await api('/api/status');
            const wasActive = state.virtualMicActive;
            state.vmOffline = false;
            state.virtualMicActive = Boolean(data.active);
            updateVirtualMicUI();
            if (state.virtualMicActive && !wasActive) {
                await routeStreamToSink(true);
            }
            if (!state.virtualMicActive) {
                if (state.routeOk) routeStreamToSink();
                else setRouteStatus('is-off', 'Virtual mic off');
            }
            return true;
        } catch {
            state.vmOffline = true;
            state.virtualMicActive = false;
            updateVirtualMicUI();
            setRouteStatus('is-off', 'Server offline');
            return false;
        }
    }

    async function setVirtualMic(on, opts = {}) {
        if (state.vmBusy || on === state.virtualMicActive) return state.virtualMicActive;
        state.vmBusy = true;
        updateVirtualMicUI();
        try {
            await api(`/api/virtual-mic/${on ? 'start' : 'stop'}`, { method: 'POST' });
            state.vmBusy = false;
            await checkVirtualMicStatus();
            if (!opts.silent) {
                toast(on ? 'Virtual microphone is running.' : 'Virtual microphone stopped.', on ? 'success' : 'info');
            }
            if (on) await routeStreamToSink();
            await refreshDevices();
            return state.virtualMicActive;
        } catch (error) {
            state.vmBusy = false;
            updateVirtualMicUI();
            toast(error.message || 'Could not change the virtual microphone.', 'error', 5200);
            await checkVirtualMicStatus();
            return state.virtualMicActive;
        }
    }

    function toggleVirtualMic() {
        return setVirtualMic(!state.virtualMicActive);
    }

    // -----------------------------------------------------------------------------
    // Discord feed routing
    // -----------------------------------------------------------------------------

    function outputLabelForId(id) {
        if (!id) {
            const defaultDevice = state.devices.outputs.find((device) => device.deviceId === 'default');
            return defaultDevice?.label || 'System default output';
        }
        const device = state.devices.outputs.find((entry) => entry.deviceId === id);
        if (device?.label) return device.label;
        const option = Array.from(el.selectMonitorDevice?.options || []).find((item) => item.value === id);
        return option ? option.textContent.replace(/ · .*$/, '') : 'Selected output';
    }

    function monitorRisk() {
        const label = outputLabelForId(state.prefs.monitorId);
        if (/headphone|headset|earbud|earphone|airpod|bluetooth|wireless/i.test(label)) return 'headphones';
        if (/speaker|built-in|analog|line out|hdmi|display|monitor|television|\btv\b|internal/i.test(label)) return 'speakers';
        return 'unknown';
    }

    function ensureMonitorElement() {
        if (!state.ctx || !nodes.monitorDest) return null;
        if (nodes.monitorEl) return nodes.monitorEl;

        const audio = document.createElement('audio');
        audio.srcObject = nodes.monitorDest.stream;
        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        audio.setAttribute('aria-hidden', 'true');
        audio.style.display = 'none';
        audio.addEventListener('error', () => {
            state.monitorRouted = false;
            syncMonitorDeviceUI();
        });
        document.body.appendChild(audio);
        nodes.monitorEl = audio;
        return audio;
    }

    function syncMonitorDeviceUI() {
        if (!el.selectMonitorDevice) return;
        const risk = monitorRisk();
        const label = outputLabelForId(state.prefs.monitorId);
        const shortLabel = risk === 'speakers' ? 'Speakers' : risk === 'headphones' ? 'Headphones' : label === 'System default output' ? 'System default' : 'Selected';
        el.monitorRouteStatus.className = `route-status ${
            state.monitorActive ? (risk === 'speakers' ? 'is-warn' : 'is-ok') : 'is-off'
        }`;
        el.monitorRouteStatus.replaceChildren(
            Object.assign(document.createElement('span'), { className: 'route-dot' }),
            document.createTextNode(shortLabel)
        );
        el.monitorRouteStatus.title = label;
        el.monitorDeviceHint.textContent = risk === 'speakers'
            ? 'This output looks like speakers. “Hear myself” warns and stays muted until you confirm.'
            : '“Hear myself” plays here, separate from the virtual mic feed. Headphones recommended.';
    }

    async function applyMonitorRoute() {
        if (!state.ctx || !nodes.monitor) return false;
        const audio = ensureMonitorElement();
        if (!audio) return false;

        if (typeof audio.setSinkId === 'function') {
            try {
                try { nodes.monitor.disconnect(nodes.monitorDest); } catch { /* not connected */ }
                nodes.monitor.connect(nodes.monitorDest);
                await audio.setSinkId(state.prefs.monitorId || '');
                if (audio.paused) await audio.play();
                state.monitorRouted = true;
                state.monitorWarned = false;
                syncMonitorDeviceUI();
                return true;
            } catch (error) {
                // The saved device may have been unplugged. Fall back to the default once.
                if (state.prefs.monitorId) {
                    state.prefs.monitorId = '';
                    savePrefs();
                    try {
                        await audio.setSinkId('');
                        if (audio.paused) await audio.play();
                        state.monitorRouted = true;
                        syncMonitorDeviceUI();
                        toast('That monitor device is gone. Using the system default output.', 'warn', 4200);
                        return true;
                    } catch { /* fall through */ }
                }
            }
        }

        // No per-element routing support: use the graph destination directly.
        try { nodes.monitor.disconnect(nodes.monitorDest); } catch { /* not connected */ }
        nodes.monitor.connect(state.ctx.destination);
        state.monitorRouted = false;
        syncMonitorDeviceUI();
        if (!state.monitorWarned) {
            state.monitorWarned = true;
            toast('This browser cannot pick a separate monitor device. “Hear myself” will use the system default output.', 'warn', 6000);
        }
        return false;
    }

    // PCM chunks must reach the server in order; parallel fetches can arrive
    // out of order and produce glitches. Send sequentially with a small queue.
    const pcmQueue = [];
    let pcmSending = false;

    async function flushPcmQueue() {
        if (pcmSending) return;
        pcmSending = true;
        while (pcmQueue.length && state.vmFeedActive) {
            const item = pcmQueue.shift();
            try {
                await fetch(`/api/feed/chunk?seq=${item.seq}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: item.pcm.buffer
                });
            } catch { /* feed will recover on the next chunk */ }
        }
        pcmSending = false;
    }

    // Convert a Float32 PCM chunk to 16-bit PCM and queue it for the isolated
    // feed endpoint. The server writes it to a dedicated pw-play stream that
    // targets the virtual sink.
    function handlePcmMessage(event) {
        const data = event.data;
        if (!data || data.type !== 'pcm' || !state.vmFeedActive) return;
        const floats = data.chunk;
        const pcm = new Int16Array(floats.length);
        for (let i = 0; i < floats.length; i += 1) {
            let sample = floats[i];
            if (sample < -1) sample = -1;
            else if (sample > 1) sample = 1;
            pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        // Never let the queue grow unbounded — drop the oldest chunk instead
        // of falling further and further behind real time.
        if (pcmQueue.length >= 4) pcmQueue.shift();
        pcmQueue.push({ seq: data.seq, pcm });
        flushPcmQueue();
    }

    // Route ONLY the app's mixed feed into the virtual sink. The PCM worklet
    // posts the mix to the server, which writes it to a dedicated pw-play
    // stream. No browser-wide capture is used, so other apps' audio (e.g. a
    // friend speaking in Discord) can never echo back into the mic.
    async function routeStreamToSink(force = false) {
        if (!state.ctx || !nodes.capture) {
            setRouteStatus('is-off', 'Not routed');
            return false;
        }
        if (state.ctx.state !== 'running') {
            try { await state.ctx.resume(); } catch { /* ignore */ }
        }

        if (!state.virtualMicActive) {
            state.vmFeedActive = false;
            pcmQueue.length = 0;
            nodes.capture.port.postMessage({ type: 'enable', value: false });
            api('/api/feed/stop', { method: 'POST' }).catch(() => {});
            state.routeOk = false;
            state.fallbackMode = false;
            setRouteStatus('is-off', 'Virtual mic off');
            return false;
        }

        try {
            await api('/api/feed/start', { method: 'POST' });
            nodes.capture.port.postMessage({ type: 'enable', value: true });
            state.vmFeedActive = true;
            state.routeOk = true;
            state.fallbackMode = false;
            setRouteStatus('is-ok', 'Routed to virtual mic');
            return true;
        } catch (error) {
            console.warn('Audio feed failed:', error);
            state.vmFeedActive = false;
            state.routeOk = false;
            setRouteStatus('is-warn', 'Feed failed');
            return false;
        }
    }

    async function toggleBrowserFallback() {
        try {
            await routeStreamToSink(true);
            if (state.routeOk) {
                toast('Audio feed reconnected. The virtual mic now carries the app mix.', 'success', 3200);
            } else {
                toast('Could not reach the virtual mic. Start it first, then press a sound and try again.', 'error', 4500);
            }
        } catch (error) {
            toast(error.message || 'Could not reconnect the audio feed.', 'error', 4500);
        }
    }

    // -----------------------------------------------------------------------------
    // Audio engine
    // -----------------------------------------------------------------------------

    function ensureAudio() {
        if (state.ctx) {
            if (state.ctx.state !== 'running') {
                state.ctx.resume().catch(() => {});
            }
            updateEngineUI();
            return Promise.resolve(state.ctx);
        }
        if (state.audioInitPromise) return state.audioInitPromise;
        state.audioInitPromise = initAudioEngine().catch((error) => {
            state.audioInitPromise = null;
            state.ctx = null;
            toast(error.message || 'Audio could not be started.', 'error', 5200);
            throw error;
        });
        return state.audioInitPromise;
    }

    function makeDistortionCurve(amount) {
        const k = Math.max(0, amount);
        const samples = 44100;
        const curve = new Float32Array(samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    function makeReverbImpulse(context, seconds = 1.9, decay = 3.1) {
        const rate = context.sampleRate;
        const length = Math.floor(rate * seconds);
        const impulse = context.createBuffer(2, length, rate);
        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const envelope = Math.pow(1 - i / length, decay);
                const early = i < rate * 0.08 ? (Math.random() * 2 - 1) * 0.35 : 1;
                data[i] = (Math.random() * 2 - 1) * envelope * early;
            }
        }
        return impulse;
    }

    async function initAudioEngine() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('This browser does not support the Web Audio API.');
        }

        const context = new AudioContextClass({ latencyHint: 'interactive' });
        state.ctx = context;

        const warnings = [];

        try {
            await context.audioWorklet.addModule('pitch-shifter-processor.js');
            nodes.pitch = new AudioWorkletNode(context, 'pitch-shifter-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });
            state.pitchReady = true;
        } catch (error) {
            console.warn('Pitch shifter worklet unavailable:', error);
            warnings.push('pitch shifter');
        }

        try {
            await context.audioWorklet.addModule('noise-gate-processor.js');
            nodes.gate = new AudioWorkletNode(context, 'noise-gate-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });
            state.gateReady = true;
        } catch (error) {
            console.warn('Noise gate worklet unavailable:', error);
            nodes.gate = context.createGain();
            warnings.push('noise gate');
        }

        // Isolated feed: capture the final mix as PCM and stream it to the
        // server, which writes it to the virtual sink via pw-play.
        try {
            await context.audioWorklet.addModule('pcm-capture-processor.js');
            nodes.capture = new AudioWorkletNode(context, 'pcm-capture-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });
            nodes.capture.port.onmessage = handlePcmMessage;
            state.captureReady = true;
        } catch (error) {
            console.warn('PCM capture worklet unavailable:', error);
            warnings.push('isolated mic feed');
        }

        const gain = (value = 1) => {
            const node = context.createGain();
            node.gain.value = value;
            return node;
        };
        const analyser = () => {
            const node = context.createAnalyser();
            node.fftSize = 512;
            node.smoothingTimeConstant = 0.72;
            return node;
        };
        const filter = (type, frequency, gainValue = 0, q = 1) => {
            const node = context.createBiquadFilter();
            node.type = type;
            node.frequency.value = frequency;
            node.gain.value = gainValue;
            if ('Q' in node) node.Q.value = q;
            return node;
        };

        nodes.micGain = gain(state.prefs.faders.mic);
        nodes.voiceBus = gain(state.prefs.faders.voice);
        nodes.soundboardBus = gain(state.prefs.faders.soundboard);
        nodes.master = gain(state.prefs.faders.master);
        nodes.monitor = gain(state.monitorActive ? 1 : 0);

        nodes.highPass = filter('highpass', 50);
        nodes.lowShelf = filter('lowshelf', 150);
        nodes.peak = filter('peaking', 2600, 0, 1);
        nodes.highShelf = filter('highshelf', 6500);

        nodes.shaper = context.createWaveShaper();
        nodes.shaper.oversample = '4x';
        nodes.shaper.curve = null;

        nodes.ringMod = gain(1);
        nodes.ringDepth = gain(0);
        nodes.ringOsc = context.createOscillator();
        nodes.ringOsc.type = 'sine';
        nodes.ringOsc.frequency.value = 55;
        nodes.ringOsc.connect(nodes.ringDepth);
        nodes.ringDepth.connect(nodes.ringMod.gain);
        nodes.ringOsc.start();

        nodes.radioHP = filter('highpass', 20);
        nodes.radioLP = filter('lowpass', 20000);

        nodes.delay = context.createDelay(1.2);
        nodes.delay.delayTime.value = 0.24;
        nodes.feedback = gain(0.32);
        nodes.delayWet = gain(0);
        nodes.delay.connect(nodes.feedback);
        nodes.feedback.connect(nodes.delay);
        nodes.delay.connect(nodes.delayWet);

        nodes.convolver = context.createConvolver();
        nodes.convolver.normalize = true;
        nodes.convolver.buffer = makeReverbImpulse(context);
        nodes.reverbWet = gain(0);

        nodes.streamDest = context.createMediaStreamDestination();
        nodes.monitorDest = context.createMediaStreamDestination();

        // Hard safety limiter: mic + soundboard can exceed 0 dBFS and clip.
        nodes.limiter = context.createDynamicsCompressor();
        nodes.limiter.threshold.value = -3;
        nodes.limiter.knee.value = 0;
        nodes.limiter.ratio.value = 20;
        nodes.limiter.attack.value = 0.002;
        nodes.limiter.release.value = 0.12;

        nodes.analysers.mic = analyser();
        nodes.analysers.voice = analyser();
        nodes.analysers.soundboard = analyser();
        nodes.analysers.master = analyser();

        // Mic chain: source -> gate -> mic gain -> EQ -> pitch -> drive -> robot -> radio
        nodes.gate.connect(nodes.micGain);
        nodes.micGain.connect(nodes.highPass);
        nodes.highPass.connect(nodes.lowShelf);
        nodes.lowShelf.connect(nodes.peak);
        nodes.peak.connect(nodes.highShelf);

        let tail = nodes.highShelf;
        if (nodes.pitch) {
            tail.connect(nodes.pitch);
            tail = nodes.pitch;
        }
        tail.connect(nodes.shaper);
        tail = nodes.shaper;
        tail.connect(nodes.ringMod);
        tail = nodes.ringMod;
        tail.connect(nodes.radioHP);
        nodes.radioHP.connect(nodes.radioLP);
        tail = nodes.radioLP;

        // Dry voice + isolated effect sends
        tail.connect(nodes.voiceBus);
        tail.connect(nodes.delay);
        tail.connect(nodes.convolver);
        nodes.delayWet.connect(nodes.voiceBus);
        nodes.convolver.connect(nodes.reverbWet);
        nodes.reverbWet.connect(nodes.voiceBus);

        // Output buses. Master is the isolated Discord feed (sent only to the
        // virtual sink). Local pad audio and the optional "Hear myself" monitor
        // stay on the normal output, where they can never echo back to Discord.
        nodes.voiceBus.connect(nodes.master);
        nodes.voiceBus.connect(nodes.monitor);
        nodes.soundboardBus.connect(nodes.master);
        nodes.soundboardBus.connect(nodes.monitor);
        nodes.monitor.connect(nodes.monitorDest);
        nodes.master.connect(nodes.limiter);
        nodes.limiter.connect(nodes.streamDest);

        // Local copy of the soundboard so pads are audible to the person
        // pressing them. Voice is deliberately excluded here — it reaches the
        // local speakers only through the explicit monitor toggle.
        nodes.soundboardBus.connect(context.destination);

        // Tap the final mix into the PCM capture worklet. A zero-gain path to
        // the destination keeps the worklet pulled by the audio graph.
        if (nodes.capture) {
            nodes.limiter.connect(nodes.capture);
            const silentSink = context.createGain();
            silentSink.gain.value = 0;
            nodes.capture.connect(silentSink);
            silentSink.connect(context.destination);
        }

        // Meter taps
        nodes.micGain.connect(nodes.analysers.mic);
        nodes.voiceBus.connect(nodes.analysers.voice);
        nodes.soundboardBus.connect(nodes.analysers.soundboard);
        nodes.master.connect(nodes.analysers.master);

        state.meterBufs.clear();
        Object.entries(nodes.analysers).forEach(([name, node]) => {
            if (node) state.meterBufs.set(name, new Uint8Array(node.fftSize));
        });

        applyAllAudioSettings();
        syncGateUI();
        context.addEventListener('statechange', updateEngineUI);

        if (context.state === 'suspended') {
            try { await context.resume(); } catch { /* next gesture resumes */ }
        }

        if (warnings.length) {
            toast(`${warnings.join(' and ')} unavailable in this browser. Other features still work.`, 'warn', 6000);
        }

        updateEngineUI();
        routeStreamToSink();
        applyMonitorRoute().catch(() => {});
        return context;
    }

    function updateEngineUI() {
        if (!el.engineChip) return;
        let text = 'Standby';
        let live = false;
        if (state.ctx) {
            if (state.micActive) {
                text = 'Mic live';
                live = true;
            } else if (state.playing.size > 0) {
                text = 'Playing';
                live = true;
            } else {
                text = 'Audio ready';
            }
        }
        el.engineChip.innerHTML = `<span class="chip-dot"></span>${text}`;
        el.engineChip.classList.toggle('is-live', live);
    }

    function applyAllAudioSettings() {
        if (!state.ctx) return;
        const p = state.prefs;
        const now = state.ctx.currentTime;
        nodes.micGain.gain.setValueAtTime(p.faders.mic, now);
        nodes.voiceBus.gain.setValueAtTime(p.faders.voice, now);
        nodes.soundboardBus.gain.setValueAtTime(p.faders.soundboard, now);
        nodes.master.gain.setValueAtTime(p.faders.master, now);
        nodes.monitor.gain.setValueAtTime(state.monitorActive ? 1 : 0, now);
        applyGate(p.gate);
        applyVoiceAudio();
        applyFxAudio();
    }

    // -----------------------------------------------------------------------------
    // Microphone + monitoring
    // -----------------------------------------------------------------------------

    function updateMicUI(mode = state.micBusy ? 'starting' : state.micActive ? 'on' : 'off') {
        el.btnMicToggle.classList.toggle('is-live', mode === 'on');
        el.btnMicToggle.disabled = mode === 'starting';
        el.btnMicToggle.setAttribute('aria-pressed', String(mode === 'on'));
        if (mode === 'starting') {
            el.micText.textContent = 'Starting…';
        } else if (mode === 'on') {
            el.micText.textContent = 'Mute mic';
        } else {
            el.micText.textContent = 'Start mic';
        }
        updateEngineUI();
    }

    async function startMicrophone(opts = {}) {
        if (state.micBusy || state.micActive) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            toast('Microphone access is unavailable. Open the app over localhost and allow mic permission.', 'error', 6000);
            return;
        }

        state.micBusy = true;
        updateMicUI('starting');

        try {
            await ensureAudio();

            // Never capture the app's own virtual source: it already contains the
            // full mix, so feeding it through the voice chain loops the effects
            // over everything and howls.
            if (state.prefs.micId) {
                try {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const chosen = devices.find((device) =>
                        device.kind === 'audioinput' && device.deviceId === state.prefs.micId);
                    if (chosen && VIRTUAL_ANY_LABEL.test(chosen.label)) {
                        state.prefs.micId = '';
                        savePrefs();
                        await refreshDevices();
                        toast('“Soundboard Virtual Mic” cannot be the microphone input — it would loop the mix back into itself. Using the system microphone instead.', 'warn', 7000);
                    }
                } catch { /* labels unavailable: fall through */ }
            }

            const constraints = {
                audio: {
                    deviceId: state.prefs.micId ? { exact: state.prefs.micId } : undefined,
                    channelCount: 1,
                    echoCancellation: state.prefs.echoCancel,
                    noiseSuppression: state.prefs.echoCancel,
                    autoGainControl: false,
                    latency: 0
                }
            };

            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (error) {
                // A saved device may be unplugged or renamed. Retry once on the
                // system default before giving up, so the mic still works.
                if (state.prefs.micId && (error.name === 'NotFoundError' ||
                    error.name === 'OverconstrainedError' || error.name === 'NotReadableError')) {
                    state.prefs.micId = '';
                    savePrefs();
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            channelCount: 1,
                            echoCancellation: state.prefs.echoCancel,
                            noiseSuppression: state.prefs.echoCancel,
                            autoGainControl: false,
                            latency: 0
                        }
                    });
                    toast('Saved microphone was unavailable. Using the system default microphone.', 'warn', 4200);
                } else {
                    throw error;
                }
            }

            // Replace the previous stream only after the new one succeeds.
            if (state.micSource) {
                try { state.micSource.disconnect(); } catch { /* ignore */ }
                state.micSource = null;
            }
            if (state.micStream) {
                state.micStream.getTracks().forEach((track) => track.stop());
            }

            state.micStream = stream;
            state.micSource = state.ctx.createMediaStreamSource(stream);
            state.micSource.connect(nodes.gate);
            state.micActive = true;
            state.micBusy = false;
            const liveTrack = stream.getAudioTracks()[0];
            state.micDeviceId = liveTrack?.getSettings?.().deviceId || '';

            // Ensure the mixed audio actually plays into the virtual sink.
            if (state.ctx.state !== 'running') await state.ctx.resume();
            if (liveTrack) {
                liveTrack.addEventListener('ended', () => {
                    if (!state.micStream || !state.micStream.getAudioTracks().includes(liveTrack)) return;
                    stopMicrophone({ silent: true });
                    toast('Microphone disconnected. Reconnect it, then start the mic again.', 'warn', 6000);
                    refreshDevices();
                });
            }
            updateMicUI('on');
            updateEngineUI();

            await refreshDevices();
            await ensureVirtualMicRunning();
            await routeStreamToSink();

            const track = stream.getAudioTracks()[0];
            if (!opts.silent) {
                const label = track?.label ? `Microphone live: ${track.label}` : 'Microphone is live.';
                if (state.monitorActive) {
                    toast(`${label} · monitoring on`, 'success');
                } else {
                    el.btnMonitorToggle.classList.add('is-hint');
                    toast(`${label} · click “Hear myself” (H) to listen`, 'success', 5200);
                }
            }
        } catch (error) {
            state.micBusy = false;
            if (state.micActive) {
                updateMicUI('on');
            } else {
                updateMicUI('off');
            }
            let message = error.message || 'Could not start the microphone.';
            if (error.name === 'NotAllowedError') {
                message = 'Microphone permission was denied. Allow it in the browser site settings and try again.';
            } else if (error.name === 'NotFoundError') {
                message = 'No microphone was found. Connect one and try again.';
            } else if (error.name === 'NotReadableError') {
                message = 'The microphone is busy in another app. Close it there and try again.';
            }
            toast(message, 'error', 6000);
        }
    }

    function stopMicrophone(opts = {}) {
        if (state.micStream) {
            state.micStream.getTracks().forEach((track) => track.stop());
            state.micStream = null;
        }
        if (state.micSource) {
            try { state.micSource.disconnect(); } catch { /* ignore */ }
            state.micSource = null;
        }
        state.micActive = false;
        state.micBusy = false;
        state.micDeviceId = '';
        state.meterLevels.mic = 0;
        el.btnMonitorToggle.classList.remove('is-hint');
        if (el.vuMic) el.vuMic.style.height = '0%';
        updateMicUI('off');
        updateEngineUI();
        if (!opts.silent) toast('Microphone muted.', 'info', 2400);
    }

    async function restartMicrophone() {
        if (!state.micActive) return;
        const label = el.micText.textContent;
        stopMicrophone({ silent: true });
        await startMicrophone({ silent: true });
        if (state.micActive) toast('Microphone settings applied.', 'success', 2600);
        void label;
    }

    async function ensureVirtualMicRunning() {
        if (state.virtualMicActive || state.vmBusy) return;
        const active = await setVirtualMic(true, { silent: true });
        if (active) toast('Virtual mic started automatically.', 'info', 2600);
    }

    function updateMonitorUI() {
        el.btnMonitorToggle.setAttribute('aria-pressed', String(state.monitorActive));
        el.monitorText.textContent = state.monitorActive ? 'ON' : 'OFF';
        el.btnMonitorToggle.title = state.monitorActive
            ? 'Stop hearing your own microphone (H)'
            : 'Listen to your own microphone in headphones (H)';
        syncMonitorDeviceUI();
    }

    async function setMonitor(on, opts = {}) {
        const next = Boolean(on);

        // Feedback guard: do not open the monitor on an output that looks like speakers
        // unless the user explicitly overrides the warning.
        if (next && !opts.force && !state.monitorOverride && monitorRisk() === 'speakers') {
            state.monitorActive = false;
            updateMonitorUI();
            toast('That output looks like speakers, so monitoring is staying muted to avoid feedback. Use headphones, or enable anyway.', 'warn', 8000, {
                label: 'Enable anyway',
                onClick: () => {
                    state.monitorOverride = true;
                    setMonitor(true, { force: true });
                }
            });
            return;
        }
        if (next && opts.force) state.monitorOverride = true;

        state.monitorActive = next;
        el.btnMonitorToggle.classList.remove('is-hint');
        if (opts.persist !== false) {
            state.prefs.monitor = next;
            savePrefs();
        }
        updateMonitorUI();

        if (next) {
            try {
                await ensureAudio();
            } catch {
                state.monitorActive = false;
                updateMonitorUI();
                return;
            }
            await applyMonitorRoute();
        }

        if (nodes.monitor && state.ctx) {
            nodes.monitor.gain.setTargetAtTime(state.monitorActive ? 1 : 0, state.ctx.currentTime, 0.02);
        }
        if (!opts.silent && !opts.quiet) {
            toast(state.monitorActive ? 'Monitoring on — use headphones.' : 'Monitoring off.', state.monitorActive ? 'warn' : 'info', 2600);
        }
    }

    // -----------------------------------------------------------------------------
    // Mixer faders + noise gate
    // -----------------------------------------------------------------------------

    const FADER_META = {
        mic: { input: 'faderMic', output: 'valMic', node: () => nodes.micGain },
        voice: { input: 'faderVoice', output: 'valVoice', node: () => nodes.voiceBus },
        soundboard: { input: 'faderSoundboard', output: 'valSoundboard', node: () => nodes.soundboardBus },
        master: { input: 'faderMaster', output: 'valMaster', node: () => nodes.master }
    };

    function syncFaderUI(name) {
        const meta = FADER_META[name];
        if (!meta) return;
        const input = $(meta.input);
        const output = $(meta.output);
        const value = state.prefs.faders[name];
        input.value = value;
        updateRangeFill(input);
        output.textContent = fmtPercent(value);
    }

    function setFader(name, value) {
        const meta = FADER_META[name];
        if (!meta) return;
        const gainValue = clamp(Number(value) || 0, 0, 2);
        state.prefs.faders[name] = gainValue;
        const node = meta.node();
        if (node && state.ctx) {
            node.gain.setTargetAtTime(gainValue, state.ctx.currentTime, 0.015);
        }
        syncFaderUI(name);
        savePrefs();
    }

    function applyGate(value) {
        if (!nodes.gate || !state.ctx) return;
        const param = nodes.gate.parameters?.get('threshold');
        if (param) {
            param.setValueAtTime(value, state.ctx.currentTime);
        }
    }

    function syncGateUI() {
        el.noiseGateSlider.value = state.prefs.gate;
        el.noiseGateVal.textContent = fmtDb(state.prefs.gate);
        updateRangeFill(el.noiseGateSlider);
        el.noiseGateSlider.disabled = !state.gateReady && Boolean(state.ctx);
    }

    function setGate(value) {
        const db = clamp(Number(value) || -65, -90, -20);
        state.prefs.gate = db;
        applyGate(db);
        syncGateUI();
        savePrefs();
    }

    // -----------------------------------------------------------------------------
    // Voice characters
    // -----------------------------------------------------------------------------

    function toneLabel(value) {
        if (value === 0) return 'Neutral';
        return value > 0 ? `Bright +${value}` : `Deep ${MINUS}${Math.abs(value)}`;
    }

    function applyPitch(value) {
        if (!nodes.pitch || !state.ctx) return;
        const param = nodes.pitch.parameters?.get('pitch');
        if (param) param.setTargetAtTime(value, state.ctx.currentTime, 0.02);
    }

    function applyTone(value) {
        if (!state.ctx || !nodes.lowShelf) return;
        const now = state.ctx.currentTime;
        let low = 0;
        let presence = 0;
        let highPass = 50;
        let highShelf = 0;
        if (value < 0) {
            low = Math.abs(value) * 1.5;
            presence = value * 0.8;
        } else if (value > 0) {
            low = -value * 1.2;
            presence = value * 1.2;
            highPass = 90 + value * 12;
            highShelf = value * 0.6;
        }
        nodes.lowShelf.gain.setTargetAtTime(low, now, 0.03);
        nodes.peak.gain.setTargetAtTime(presence, now, 0.03);
        nodes.highPass.frequency.setTargetAtTime(highPass, now, 0.03);
        nodes.highShelf.gain.setTargetAtTime(highShelf, now, 0.03);
    }

    function applyVoiceAudio() {
        applyPitch(state.prefs.basePitch);
        applyTone(state.prefs.baseTone);
    }

    function updateVoiceHero() {
        const p = state.prefs;
        const char = VOICE_CHARACTERS.find((item) => item.id === p.voice);
        if (char) {
            el.activeVoiceAvatar.textContent = char.icon;
            el.activeVoiceName.textContent = char.name;
            el.activeVoiceDesc.textContent = char.desc;
            el.activePresetTag.textContent = char.name;
            el.activePresetTag.className = `badge ${p.voice === 'normal' ? 'badge-green' : 'badge-cyan'}`;
        } else {
            el.activeVoiceAvatar.textContent = '🎚️';
            el.activeVoiceName.textContent = 'Custom voice';
            el.activeVoiceDesc.textContent = `${fmtSigned(p.basePitch, ' st')} pitch · ${toneLabel(p.baseTone)}`;
            el.activePresetTag.textContent = 'Custom voice';
            el.activePresetTag.className = 'badge badge-cyan';
        }

        $$('.preset-card', el.presetsGrid).forEach((card) => {
            const active = card.dataset.id === p.voice;
            card.classList.toggle('is-active', active);
            card.setAttribute('aria-selected', String(active));
        });
    }

    function syncVoiceControls() {
        const p = state.prefs;
        el.sliderPitch.value = p.basePitch;
        el.sliderTone.value = p.baseTone;
        el.labelPitch.textContent = fmtSigned(p.basePitch, ' st');
        el.labelTone.textContent = toneLabel(p.baseTone);
        updateRangeFill(el.sliderPitch);
        updateRangeFill(el.sliderTone);
        updateVoiceHero();
        applyVoiceAudio();
    }

    function renderVoiceCards() {
        el.presetsGrid.replaceChildren();
        VOICE_CHARACTERS.forEach((char) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'preset-card';
            card.dataset.id = char.id;
            card.setAttribute('role', 'option');
            card.setAttribute('aria-selected', 'false');
            card.innerHTML = `
                <span class="preset-tag">${char.tag}</span>
                <span class="preset-icon" aria-hidden="true">${char.icon}</span>
                <span class="preset-title">${char.name}</span>
                <span class="preset-desc">${char.desc}</span>
            `;
            card.addEventListener('click', () => selectCharacter(char.id));
            el.presetsGrid.appendChild(card);
        });
    }

    function selectCharacter(id) {
        const char = VOICE_CHARACTERS.find((item) => item.id === id);
        if (!char) return;
        clearAllEffects({ silent: true });
        state.prefs.voice = id;
        state.prefs.basePitch = char.params.pitch;
        state.prefs.baseTone = char.params.tone;
        syncVoiceControls();
        savePrefs();
    }

    function markCustomVoice() {
        state.prefs.voice = 'custom';
        savePrefs();
        updateVoiceHero();
    }

    // -----------------------------------------------------------------------------
    // Effect rack
    // -----------------------------------------------------------------------------

    function applyFxAudio() {
        if (!state.ctx || !nodes.shaper) return;
        const p = state.prefs.fx;
        const now = state.ctx.currentTime;
        const smooth = 0.03;

        nodes.reverbWet.gain.setTargetAtTime((p.reverb / 100) * 0.9, now, smooth);
        if (p.echo > 0) {
            nodes.delay.delayTime.setTargetAtTime(p.echo / 1000, now, 0.05);
            nodes.delayWet.gain.setTargetAtTime(0.48, now, smooth);
        } else {
            nodes.delayWet.gain.setTargetAtTime(0, now, smooth);
        }
        nodes.shaper.curve = p.drive > 0 ? makeDistortionCurve(p.drive * 0.9) : null;

        if (p.robot > 0) {
            nodes.ringOsc.frequency.setTargetAtTime(Math.max(20, p.robot), now, smooth);
            nodes.ringMod.gain.setTargetAtTime(0.15, now, smooth);
            nodes.ringDepth.gain.setTargetAtTime(0.85, now, smooth);
        } else {
            nodes.ringMod.gain.setTargetAtTime(1, now, smooth);
            nodes.ringDepth.gain.setTargetAtTime(0, now, smooth);
        }

        nodes.radioHP.frequency.setTargetAtTime(p.radio ? 420 : 20, now, smooth);
        nodes.radioLP.frequency.setTargetAtTime(p.radio ? 2800 : 20000, now, smooth);
    }

    function updateFxBadge() {
        const p = state.prefs.fx;
        const active = [];
        if (p.robot > 0) active.push('Robot');
        if (p.radio) active.push('Radio');
        if (p.demon) active.push('Demon');
        if (p.cave) active.push('Cave');
        if (p.reverb > 0) active.push('Reverb');
        if (p.echo > 0) active.push('Echo');
        if (p.drive > 0) active.push('Drive');

        if (active.length === 0) {
            el.effectsStatusBadge.textContent = 'Dry';
            el.effectsStatusBadge.className = 'badge badge-green';
        } else {
            el.effectsStatusBadge.textContent = active.join(' + ');
            el.effectsStatusBadge.className = p.demon ? 'badge badge-red' : 'badge badge-cyan';
        }
    }

    function syncFxControls() {
        const p = state.prefs.fx;
        el.sliderReverb.value = p.reverb;
        el.sliderEcho.value = p.echo;
        el.sliderDrive.value = p.drive;
        el.sliderRobot.value = p.robot;
        el.labelReverb.textContent = `${Math.round(p.reverb)}%`;
        el.labelEcho.textContent = `${Math.round(p.echo)} ms`;
        el.labelDrive.textContent = `${Math.round(p.drive)}%`;
        el.labelRobot.textContent = `${Math.round(p.robot)} Hz`;
        [el.sliderReverb, el.sliderEcho, el.sliderDrive, el.sliderRobot].forEach(updateRangeFill);

        el.btnFxRobot.setAttribute('aria-pressed', String(p.robot > 0));
        el.btnFxRadio.setAttribute('aria-pressed', String(p.radio));
        el.btnFxDemon.setAttribute('aria-pressed', String(p.demon));
        el.btnFxCave.setAttribute('aria-pressed', String(p.cave));

        updateFxBadge();
        applyFxAudio();
    }

    function toggleRobotFx() {
        const p = state.prefs.fx;
        p.robot = p.robot > 0 ? 0 : 55;
        savePrefs();
        syncFxControls();
    }

    function toggleRadioFx() {
        const p = state.prefs.fx;
        if (p.radio) {
            p.radio = false;
            if (p.drive === 45) p.drive = 0;
        } else {
            p.radio = true;
            if (p.drive === 0) p.drive = 45;
        }
        savePrefs();
        syncFxControls();
    }

    function toggleDemonFx() {
        const p = state.prefs.fx;
        if (p.demon) {
            p.demon = false;
            state.prefs.basePitch = clamp(state.prefs.basePitch + 4, -12, 12);
        } else {
            p.demon = true;
            state.prefs.basePitch = clamp(state.prefs.basePitch - 4, -12, 12);
            if (p.drive === 0) p.drive = 50;
        }
        savePrefs();
        syncFxControls();
        syncVoiceControls();
    }

    function toggleCaveFx() {
        const p = state.prefs.fx;
        if (p.cave) {
            p.cave = false;
            if (p.reverb === 70) p.reverb = 0;
            if (p.echo === 240) p.echo = 0;
        } else {
            p.cave = true;
            if (p.reverb === 0) p.reverb = 70;
            if (p.echo === 0) p.echo = 240;
        }
        savePrefs();
        syncFxControls();
    }

    function clearAllEffects(opts = {}) {
        const p = state.prefs;
        const fx = p.fx;
        if (fx.demon) p.basePitch = clamp(p.basePitch + 4, -12, 12);
        fx.reverb = 0;
        fx.echo = 0;
        fx.drive = 0;
        fx.robot = 0;
        fx.radio = false;
        fx.demon = false;
        fx.cave = false;
        savePrefs();
        syncFxControls();
        syncVoiceControls();
        if (!opts.silent) toast('Effects cleared.', 'info', 2000);
    }

    // -----------------------------------------------------------------------------
    // Audio devices
    // -----------------------------------------------------------------------------

    async function refreshDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        let devices = [];
        try {
            devices = await navigator.mediaDevices.enumerateDevices();
        } catch {
            return;
        }

        const inputs = devices.filter((device) => device.kind === 'audioinput' &&
            !VIRTUAL_ANY_LABEL.test(device.label));
        const outputs = devices.filter((device) => device.kind === 'audiooutput');
        state.devices = { inputs, outputs };

        const micSelect = el.selectMicDevice;
        const outputSelect = el.selectOutputDevice;
        const oldMic = micSelect.value;
        const oldOutput = outputSelect.value;

        micSelect.replaceChildren(new Option('System default microphone', ''));
        inputs.forEach((device, index) => {
            const label = device.label || `Microphone ${index + 1}`;
            micSelect.appendChild(new Option(label, device.deviceId));
        });

        outputSelect.replaceChildren(new Option('Auto — Soundboard sink', ''));
        outputs.forEach((device, index) => {
            const isSink = /soundboard|voice changer|virtual mic/i.test(device.label);
            const label = `${device.label || `Output ${index + 1}`}${isSink ? ' · Virtual mic' : ''}`;
            outputSelect.appendChild(new Option(label, device.deviceId));
        });

        // Populate monitor device select with real outputs only — monitoring into
        // the virtual sink would feed the mix back into the microphone.
        const monitorSelect = el.selectMonitorDevice;
        if (monitorSelect) {
            monitorSelect.replaceChildren(new Option('System default output', ''));
            outputs.filter((device) => !VIRTUAL_SINK_LABEL.test(device.label)).forEach((device, index) => {
                const label = device.label || `Output ${index + 1}`;
                monitorSelect.appendChild(new Option(label, device.deviceId));
            });
            monitorSelect.value = state.prefs.monitorId && outputs.some((d) => d.deviceId === state.prefs.monitorId)
                ? state.prefs.monitorId
                : '';
            if (!state.prefs.monitorId) monitorSelect.value = '';
        }

        // Preserve the user's selection when possible, otherwise keep prefs for later.
        micSelect.value = state.prefs.micId && inputs.some((d) => d.deviceId === state.prefs.micId)
            ? state.prefs.micId
            : '';
        outputSelect.value = state.prefs.outputId && outputs.some((d) => d.deviceId === state.prefs.outputId)
            ? state.prefs.outputId
            : '';

        // If nothing was selected before, leave the selects on default.
        if (!state.prefs.micId) micSelect.value = '';
        if (!state.prefs.outputId) outputSelect.value = '';
        void oldMic;
        void oldOutput;

        if (state.virtualMicActive) {
            routeStreamToSink();
        }
    }

    // -----------------------------------------------------------------------------
    // Soundboard
    // -----------------------------------------------------------------------------

    function defaultKeyFor(file) {
        const def = DEFAULT_SOUNDS.find((item) => item.file === file);
        return def ? def.key : '';
    }

    function keyFor(sound) {
        if (Object.prototype.hasOwnProperty.call(state.keybinds, sound.id)) {
            return state.keybinds[sound.id];
        }
        return defaultKeyFor(sound.file);
    }

    function assignKeys() {
        const used = new Set();
        state.sounds.forEach((sound) => {
            let key = keyFor(sound);
            if (!key || used.has(key)) key = '';
            sound.key = key;
            if (key) used.add(key);
        });
    }

    async function loadSounds() {
        try {
            const data = await api('/api/sounds');
            const list = Array.isArray(data.sounds) ? data.sounds : [];
            state.sounds = list.map((item) => {
                const def = DEFAULT_SOUNDS.find((entry) => entry.file === item.filename);
                const name = def ? def.name : (item.name || item.filename);
                return {
                    id: item.id || item.filename,
                    file: item.filename,
                    name,
                    url: item.url || `/sounds/${encodeURIComponent(item.filename)}`,
                    icon: def ? def.icon : iconForSound(name),
                    custom: !def,
                    key: '',
                    folder: item.folder || '',
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    favorite: Boolean(item.favorite),
                    volume: item.volume != null ? Math.round(item.volume * 100) : 100,
                    loop: Boolean(item.loop)
                };
            });
        } catch (error) {
            console.warn('Could not load sounds:', error);
            state.sounds = DEFAULT_SOUNDS.map((item) => ({
                id: item.file,
                file: item.file,
                name: item.name,
                url: `/sounds/${encodeURIComponent(item.file)}`,
                icon: item.icon,
                custom: false,
                key: '',
                folder: '',
                tags: [],
                favorite: false,
                volume: 100,
                loop: false
            }));
            toast('Could not load the soundboard from the server. Using built-in names.', 'warn', 4500);
        }
        assignKeys();
        renderFilterBar();
        renderSoundboard();
        updateEngineUI();
    }

    function getPad(id) {
        return Array.from(el.soundboardGrid.children).find((pad) => pad.dataset.id === id) || null;
    }

    function updatePadPlaying(id, playing) {
        const pad = getPad(id);
        if (!pad) return;
        pad.classList.toggle('is-playing', playing);
        pad.classList.remove('is-loading');
        if (!playing) {
            const bar = pad.querySelector('.progress-line');
            if (bar) bar.style.width = '0%';
        }
    }

    function createPad(sound) {
        const pad = document.createElement('div');
        pad.className = 'sound-pad';
        if (state.playing.has(sound.id)) pad.classList.add('is-playing');
        if (state.loading.has(sound.id)) pad.classList.add('is-loading');
        if (sound.favorite) pad.classList.add('is-favorite');
        pad.dataset.id = sound.id;
        pad.tabIndex = 0;
        pad.setAttribute('role', 'button');
        pad.setAttribute('aria-label', `${sound.name}${sound.key ? `, hotkey ${sound.key}` : ''}`);
        pad.title = sound.key ? `${sound.name} · press ${sound.key}` : sound.name;

        const actions = document.createElement('div');
        actions.className = 'sound-pad-actions';

        const keybindBtn = document.createElement('button');
        keybindBtn.type = 'button';
        keybindBtn.className = 'pad-action btn-keybind';
        keybindBtn.title = 'Assign hotkey';
        keybindBtn.setAttribute('aria-label', `Assign hotkey to ${sound.name}`);
        keybindBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>';
        actions.appendChild(keybindBtn);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'pad-action btn-edit';
        editBtn.title = 'Edit sound';
        editBtn.setAttribute('aria-label', `Edit ${sound.name}`);
        editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'pad-action is-danger btn-delete';
        deleteBtn.title = 'Delete sound';
        deleteBtn.setAttribute('aria-label', `Delete ${sound.name}`);
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>';
        actions.appendChild(deleteBtn);

        pad.innerHTML = `
            <span class="sound-pad-key"></span>
            <span class="sound-pad-icon" aria-hidden="true">${sound.icon || '🎵'}</span>
            <span class="sound-pad-title"></span>
            <div class="pad-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <div class="progress-line"></div>
        `;
        pad.appendChild(actions);
        pad.querySelector('.sound-pad-title').textContent = sound.name;
        pad.querySelector('.sound-pad-title').title = sound.name;

        const keyEl = pad.querySelector('.sound-pad-key');
        if (sound.key) {
            keyEl.textContent = sound.key;
            keyEl.title = `Hotkey: ${sound.key}`;
        } else {
            keyEl.remove();
        }

        const info = state.playing.get(sound.id);
        if (info) {
            const bar = pad.querySelector('.progress-line');
            if (bar && state.ctx) {
                const elapsed = state.ctx.currentTime - info.startTime;
                bar.style.width = `${clamp((elapsed / info.duration) * 100, 0, 100)}%`;
            }
        }

        pad.addEventListener('click', (event) => {
            if (event.target.closest('.pad-action')) return;
            playSound(sound);
        });
        pad.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                playSound(sound);
            }
        });

        keybindBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            openKeybind(sound);
        });

        editBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            openEditModal(sound);
        });

        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            deleteSoundWithUndo(sound);
        });

        return pad;
    }
    function renderFilterBar() {
        if (!el.soundFilters) return;
        const folders = [...new Set(state.sounds.map((s) => s.folder).filter(Boolean))].sort();
        const hasFavorites = state.sounds.some((s) => s.favorite);
        const chips = [
            { id: 'all', label: 'All' },
            ...(hasFavorites ? [{ id: 'favorites', label: '⭐ Favorites' }] : []),
            ...folders.map((f) => ({ id: f, label: f }))
        ];
        el.soundFilters.replaceChildren();
        chips.forEach((chip) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `filter-chip${state.filter === chip.id ? ' is-active' : ''}`;
            btn.textContent = chip.label;
            btn.addEventListener('click', () => {
                state.filter = chip.id;
                renderFilterBar();
                renderSoundboard();
            });
            el.soundFilters.appendChild(btn);
        });
        el.soundFilters.hidden = chips.length <= 1;
    }

    function renderSoundboard() {
        const query = el.soundSearch.value.trim().toLowerCase();
        const filtered = state.sounds.filter((sound) => {
            // Apply active filter chip
            if (state.filter === 'favorites' && !sound.favorite) return false;
            if (state.filter && state.filter !== 'all' && state.filter !== 'favorites') {
                if (sound.folder !== state.filter) return false;
            }
            // Apply text search
            if (!query) return true;
            return sound.name.toLowerCase().includes(query)
                || (sound.key && sound.key.toLowerCase().includes(query))
                || (sound.folder && sound.folder.toLowerCase().includes(query))
                || (sound.tags && sound.tags.some((t) => t.toLowerCase().includes(query)));
        });

        el.soundboardGrid.replaceChildren();
        filtered.forEach((sound) => el.soundboardGrid.appendChild(createPad(sound)));

        el.soundCountBadge.textContent = `${state.sounds.length} sound${state.sounds.length === 1 ? '' : 's'}`;
        el.soundEmpty.hidden = filtered.length > 0;

        if (filtered.length === 0) {
            const title = el.soundEmpty.querySelector('strong');
            const hint = el.soundEmpty.querySelector('small');
            if (title) title.textContent = state.sounds.length === 0 ? 'Soundboard is empty' : 'No sounds found';
            if (hint) {
                hint.textContent = state.sounds.length === 0
                    ? 'Drop an audio file above to add your first sound.'
                    : 'Try a different name or hotkey.';
            }
        }
    }

    async function openEditModal(sound) {
        state.editTarget = sound;
        if (el.soundEditSubtitle) el.soundEditSubtitle.textContent = sound.custom ? 'Custom sound' : 'Built-in sound';
        el.editSoundName.value = sound.name || '';
        el.editSoundIcon.value = sound.icon || '🎵';
        el.editSoundFolder.value = sound.folder || '';
        el.editSoundTags.value = Array.isArray(sound.tags) ? sound.tags.join(', ') : '';
        el.editLoop.checked = Boolean(sound.loop);
        el.editFavorite.checked = Boolean(sound.favorite);

        const vol = sound.volume != null ? sound.volume : 100;
        el.editVolume.value = vol;
        el.editVolumeVal.textContent = `${Math.round(vol)}%`;
        updateRangeFill(el.editVolume);

        el.editTrimStart.value = 0;
        el.editTrimStartVal.textContent = '0.00 s';
        updateRangeFill(el.editTrimStart);

        el.editTrimEndOn.checked = false;
        el.editTrimEndVal.textContent = 'Full length';
        el.editTrimEnd.disabled = true;

        el.editFadeIn.value = 0;
        el.editFadeInVal.textContent = '0.00 s';
        updateRangeFill(el.editFadeIn);

        el.editFadeOut.value = 0;
        el.editFadeOutVal.textContent = '0.00 s';
        updateRangeFill(el.editFadeOut);

        if (el.editDuration) el.editDuration.textContent = '—';

        // Try to load duration asynchronously if audio context is available
        if (state.ctx) {
            loadBuffer(sound.url).then((buffer) => {
                if (el.editDuration) el.editDuration.textContent = `${buffer.duration.toFixed(2)} s`;
                el.editTrimEnd.max = buffer.duration.toFixed(2);
                el.editTrimStart.max = buffer.duration.toFixed(2);
                el.editFadeIn.max = Math.min(buffer.duration, 5).toFixed(2);
                el.editFadeOut.max = Math.min(buffer.duration, 5).toFixed(2);
            }).catch(() => {});
        }

        openModal(el.soundEditModal, el.editSoundName);
    }

    function setupEditModalEvents() {
        el.editVolume?.addEventListener('input', () => {
            el.editVolumeVal.textContent = `${Math.round(Number(el.editVolume.value))}%`;
            updateRangeFill(el.editVolume);
        });
        el.editTrimStart?.addEventListener('input', () => {
            el.editTrimStartVal.textContent = `${Number(el.editTrimStart.value).toFixed(2)} s`;
            updateRangeFill(el.editTrimStart);
        });
        el.editTrimEndOn?.addEventListener('change', () => {
            const on = el.editTrimEndOn.checked;
            el.editTrimEnd.disabled = !on;
            el.editTrimEndVal.textContent = on ? `${Number(el.editTrimEnd.value).toFixed(2)} s` : 'Full length';
        });
        el.editTrimEnd?.addEventListener('input', () => {
            el.editTrimEndVal.textContent = `${Number(el.editTrimEnd.value).toFixed(2)} s`;
        });
        el.editFadeIn?.addEventListener('input', () => {
            el.editFadeInVal.textContent = `${Number(el.editFadeIn.value).toFixed(2)} s`;
            updateRangeFill(el.editFadeIn);
        });
        el.editFadeOut?.addEventListener('input', () => {
            el.editFadeOutVal.textContent = `${Number(el.editFadeOut.value).toFixed(2)} s`;
            updateRangeFill(el.editFadeOut);
        });

        el.btnPreviewSound?.addEventListener('click', () => {
            if (state.editTarget) playSound(state.editTarget);
        });

        el.btnSaveSound?.addEventListener('click', async () => {
            const sound = state.editTarget;
            if (!sound) return;
            const body = {
                name: el.editSoundName.value.trim() || sound.name,
                icon: el.editSoundIcon.value.trim() || sound.icon,
                folder: el.editSoundFolder.value.trim(),
                tags: el.editSoundTags.value.split(',').map((t) => t.trim()).filter(Boolean),
                volume: Number(el.editVolume.value) / 100,
                loop: el.editLoop.checked,
                favorite: el.editFavorite.checked
            };
            try {
                await api(`/api/sounds/${encodeURIComponent(sound.id)}`, { method: 'PATCH', body });
                closeModal(el.soundEditModal);
                await loadSounds();
                toast(`"${body.name}" saved.`, 'success');
            } catch (error) {
                toast(`Could not save: ${error.message}`, 'error', 5000);
            }
        });
    }

    async function loadBuffer(url) {
        if (state.soundCache?.has(url)) return state.soundCache.get(url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Sound file not found (${response.status})`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await state.ctx.decodeAudioData(arrayBuffer);
        if (!state.soundCache) state.soundCache = new Map();
        state.soundCache.set(url, buffer);
        return buffer;
    }

    function updateProgress(id) {
        const info = state.playing.get(id);
        if (!info || !state.ctx) return;
        const bar = getPad(id)?.querySelector('.progress-line');
        if (!bar) return;
        const elapsed = state.ctx.currentTime - info.startTime;
        bar.style.width = `${clamp((elapsed / info.duration) * 100, 0, 100)}%`;
    }

    async function playSound(sound) {
        try {
            await ensureAudio();
        } catch {
            return;
        }
        // Make sure the isolated virtual-mic feed is active before audio starts.
        if (!state.routeOk) {
            await routeStreamToSink();
        }

        if (state.playing.has(sound.id)) {
            stopSound(sound.id);
            return;
        }
        if (state.loading.has(sound.id)) return;

        state.loading.add(sound.id);
        const pad = getPad(sound.id);
        if (pad) pad.classList.add('is-loading');

        try {
            const buffer = await loadBuffer(sound.url);
            const source = state.ctx.createBufferSource();
            source.buffer = buffer;
            const sourceGain = state.ctx.createGain();
            sourceGain.gain.value = (sound.volume != null ? sound.volume : 100) / 100;
            source.connect(sourceGain);
            sourceGain.connect(nodes.soundboardBus);

            const startTime = state.ctx.currentTime;
            const duration = buffer.duration;
            const interval = setInterval(() => updateProgress(sound.id), 60);

            state.playing.set(sound.id, { source, sourceGain, startTime, duration, interval });
            source.onended = () => stopSound(sound.id);
            source.start();
            updatePadPlaying(sound.id, true);
            updateEngineUI();
        } catch (error) {
            console.error('Could not play sound:', error);
            toast(`Could not play “${sound.name}”: ${error.message}`, 'error', 4500);
        } finally {
            state.loading.delete(sound.id);
            const currentPad = getPad(sound.id);
            if (currentPad && !state.playing.has(sound.id)) {
                currentPad.classList.remove('is-loading');
            }
        }
    }

    function stopSound(id) {
        const info = state.playing.get(id);
        if (!info) {
            updatePadPlaying(id, false);
            return;
        }
        state.playing.delete(id);
        clearInterval(info.interval);
        info.source.onended = null;
        try { info.source.stop(); } catch { /* already stopped */ }
        try { info.sourceGain?.disconnect(); } catch { /* already disconnected */ }
        updatePadPlaying(id, false);
        updateEngineUI();
    }

    function stopAllSounds() {
        const ids = Array.from(state.playing.keys());
        ids.forEach((id) => stopSound(id));
        if (ids.length > 0) {
            toast(`Stopped ${ids.length} sound${ids.length === 1 ? '' : 's'}.`, 'info', 1800);
        }
    }

    async function deleteSoundWithUndo(sound) {
        stopSound(sound.id);
        try {
            const result = await api(`/api/sounds/${encodeURIComponent(sound.id)}`, { method: 'DELETE' });
            if (state.soundCache) state.soundCache.delete(sound.url);
            delete state.keybinds[sound.id];
            saveKeybinds();
            await loadSounds();

            const trash = result && result.trash;
            if (trash) {
                toast(`Deleted “${sound.name}”.`, 'success', 6000, {
                    label: 'Undo',
                    onClick: async () => {
                        try {
                            await api('/api/trash/restore', { method: 'POST', body: { trashId: trash.trashId } });
                            await loadSounds();
                            toast(`Restored “${sound.name}”.`, 'success');
                        } catch (error) {
                            toast(`Could not restore: ${error.message}`, 'error', 4500);
                        }
                    }
                });
            } else {
                toast(`Deleted “${sound.name}”.`, 'success');
            }
        } catch (error) {
            toast(`Could not delete “${sound.name}”: ${error.message}`, 'error', 4500);
        }
    }

    async function loadTrash() {
        state.trashLoading = true;
        try {
            const data = await api('/api/trash');
            const list = Array.isArray(data.trash) ? data.trash : [];
            state.trash = list;
            el.trashCount.textContent = list.length;
            el.trashCount.hidden = list.length === 0;
            renderTrash();
        } catch (error) {
            console.warn('Could not load trash:', error);
        } finally {
            state.trashLoading = false;
        }
    }

    function renderTrash() {
        if (!el.trashList) return;
        el.trashList.replaceChildren();
        if (state.trash.length === 0) {
            el.trashList.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--dim);font-size:0.7rem;padding:12px;">Trash is empty</p>';
            return;
        }
        state.trash.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).forEach((entry) => {
            const item = document.createElement('div');
            item.className = 'trash-item';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.justifyContent = 'space-between';
            item.style.padding = '8px 10px';
            item.style.border = '1px solid var(--line)';
            item.style.borderRadius = '8px';
            item.style.background = 'var(--surface)';
            item.style.marginBottom = '6px';
            const info = document.createElement('div');
            info.style.display = 'flex';
            info.style.alignItems = 'center';
            info.style.gap = '8px';
            info.style.flex = '1';
            info.style.minWidth = '0';
            const icon = document.createElement('span');
            icon.textContent = entry.icon || '🎵';
            icon.style.fontSize = '1.2rem';
            const name = document.createElement('span');
            name.textContent = entry.name || entry.filename;
            name.style.color = 'var(--text-soft)';
            name.style.fontSize = '0.75rem';
            name.style.fontWeight = '600';
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';
            name.style.whiteSpace = 'nowrap';
            info.appendChild(icon);
            info.appendChild(name);
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '6px';
            const restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.className = 'btn btn-quiet btn-sm';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                try {
                    await api('/api/trash/restore', { method: 'POST', body: { trashId: entry.trashId } });
                    await loadTrash();
                    await loadSounds();
                    toast(`Restored “${entry.name || entry.filename}”.`, 'success');
                } catch (error) {
                    toast(`Could not restore: ${error.message}`, 'error', 4500);
                }
            });
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-quiet btn-sm is-danger';
            deleteBtn.textContent = 'Delete forever';
            deleteBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                try {
                    await api(`/api/trash/${encodeURIComponent(entry.trashId)}`, { method: 'DELETE' });
                    await loadTrash();
                    toast(`Deleted “${entry.name || entry.filename}” forever.`, 'success');
                } catch (error) {
                    toast(`Could not delete: ${error.message}`, 'error', 4500);
                }
            });
            actions.appendChild(restoreBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(info);
            item.appendChild(actions);
            el.trashList.appendChild(item);
        });
    }

    async function openTrash() {
        await loadTrash();
        openModal(el.trashModal);
    }

    async function emptyTrash() {
        try {
            await api('/api/trash/empty', { method: 'POST' });
            await loadTrash();
            await loadSounds();
            toast('Trash emptied.', 'success');
            closeModal(el.trashModal);
        } catch (error) {
            toast(`Could not empty trash: ${error.message}`, 'error', 4500);
        }
    }

    async function deleteSound(sound) {
        await deleteSoundWithUndo(sound);
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
            reader.readAsDataURL(file);
        });
    }

    function setUploadBusy(busy, count = 0) {
        state.uploadBusy = busy;
        el.soundDropzone.classList.toggle('is-busy', busy);
        const strong = el.soundDropzone.querySelector('strong');
        const small = el.soundDropzone.querySelector('small');
        if (strong) strong.textContent = busy
            ? `Uploading ${count} file${count === 1 ? '' : 's'}…`
            : 'Drop audio files here';
        if (small) small.textContent = busy
            ? 'Please keep this tab open'
            : 'MP3, WAV, OGG, M4A · saved to disk';
    }

    async function uploadFiles(fileList) {
        if (state.uploadBusy) {
            toast('An upload is already in progress.', 'warn', 2400);
            return;
        }
        const files = Array.from(fileList || []);
        const audioFiles = files.filter((file) => file.type.startsWith('audio/') || AUDIO_EXT.test(file.name));
        if (audioFiles.length === 0) {
            toast('Only audio files (MP3, WAV, OGG, M4A) can be added.', 'error');
            return;
        }
        const valid = [];
        for (const file of audioFiles) {
            if (file.size === 0) {
                toast(`“${file.name}” is empty.`, 'error');
            } else if (file.size > MAX_FILE_BYTES) {
                toast(`“${file.name}” is too large (max 28 MB).`, 'error');
            } else {
                valid.push(file);
            }
        }
        if (valid.length === 0) return;

        setUploadBusy(true, valid.length);
        let added = 0;
        const failures = [];

        try {
            for (const file of valid) {
                try {
                    const base64 = await readFileAsDataUrl(file);
                    await api('/api/upload-sound', {
                        method: 'POST',
                        body: {
                            name: file.name,
                            displayName: file.name.replace(/\.[^/.]+$/, ''),
                            base64
                        }
                    });
                    added += 1;
                } catch (error) {
                    failures.push(`${file.name}: ${error.message}`);
                }
            }
            await loadSounds();
            if (added > 0) {
                toast(`Added ${added} sound${added === 1 ? '' : 's'} to the soundboard.`, 'success');
            }
            if (failures.length > 0) {
                toast(failures[0], 'error', 6000);
            }
        } finally {
            setUploadBusy(false);
            el.soundFileInput.value = '';
        }
    }

    // -----------------------------------------------------------------------------
    // Keybinds
    // -----------------------------------------------------------------------------

    function normalizeKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return null;
        let key = event.key;
        if (!key) return null;
        if (key.length === 1) {
            key = key.toUpperCase();
            if (!/^[A-Z0-9]$/.test(key)) return null;
            if (RESERVED_KEYS.has(key)) return null;
            return key;
        }
        if (/^F([1-9]|1[0-2])$/.test(key)) return key;
        return null;
    }

    function openKeybind(sound) {
        state.keybindTarget = sound;
        el.keySoundName.textContent = sound.name;
        el.keyPromptBox.textContent = sound.key ? `[${sound.key}] — press a new key…` : 'Waiting…';
        el.keyPromptBox.classList.add('is-listening');
        el.keybindError.hidden = true;
        el.keyPromptBox.tabIndex = -1;
        openModal(el.keybindModal, el.keyPromptBox);
        el.keyPromptBox.focus({ preventScroll: true });
        window.addEventListener('keydown', handleKeybindKey, true);
    }

    function closeKeybindModal() {
        window.removeEventListener('keydown', handleKeybindKey, true);
        state.keybindTarget = null;
        el.keyPromptBox.classList.remove('is-listening');
        el.keyPromptBox.textContent = 'Waiting…';
        el.keybindError.hidden = true;
        closeModal(el.keybindModal);
    }

    function handleKeybindKey(event) {
        if (!state.keybindTarget) return;
        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Escape') {
            closeKeybindModal();
            return;
        }

        const key = normalizeKey(event);
        if (!key) {
            el.keybindError.hidden = false;
            return;
        }

        const target = state.keybindTarget;
        const conflict = state.sounds.find((sound) => sound.id !== target.id && sound.key === key);
        if (conflict) {
            state.keybinds[conflict.id] = '';
            toast(`Hotkey ${key} moved from “${conflict.name}”.`, 'info', 2600);
        }

        state.keybinds[target.id] = key;
        saveKeybinds();
        assignKeys();
        closeKeybindModal();
        renderSoundboard();
        toast(`Hotkey ${key} assigned to “${target.name}”.`, 'success', 2600);
    }

    function clearKeybind() {
        if (!state.keybindTarget) return;
        state.keybinds[state.keybindTarget.id] = '';
        saveKeybinds();
        assignKeys();
        const name = state.keybindTarget.name;
        closeKeybindModal();
        renderSoundboard();
        toast(`Hotkey removed from “${name}”.`, 'info', 2400);
    }

    function triggerSoundByKey(key) {
        const match = state.sounds.find((sound) => sound.key && sound.key.toUpperCase() === key.toUpperCase());
        if (match) playSound(match);
        return Boolean(match);
    }

    // -----------------------------------------------------------------------------
    // Meters + visualizer
    // -----------------------------------------------------------------------------

    function readLevel(name) {
        const analyser = nodes.analysers[name];
        const buffer = state.meterBufs.get(name);
        if (!analyser || !buffer) return 0;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            const sample = (buffer[i] - 128) / 128;
            sum += sample * sample;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const db = 20 * Math.log10(rms + 1e-7);
        return Math.pow(clamp((db + 60) / 60, 0, 1), 0.72);
    }

    function updateMeters() {
        const targets = {
            mic: state.micActive ? readLevel('mic') : 0,
            voice: state.ctx ? readLevel('voice') : 0,
            soundboard: state.ctx ? readLevel('soundboard') : 0,
            master: state.ctx ? readLevel('master') : 0
        };
        const elements = {
            mic: el.vuMic,
            voice: el.vuVoice,
            soundboard: el.vuSoundboard,
            master: el.vuMaster
        };

        Object.keys(targets).forEach((name) => {
            const previous = state.meterLevels[name] || 0;
            const target = targets[name];
            const next = target > previous ? target : previous * 0.9;
            state.meterLevels[name] = next;
            const meter = elements[name];
            if (meter) meter.style.height = `${(next * 100).toFixed(1)}%`;
        });
    }

    function roundedRect(context, x, y, width, height, radius) {
        if (typeof context.roundRect === 'function') {
            context.beginPath();
            context.roundRect(x, y, width, height, radius);
            return;
        }
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.lineTo(x + width - r, y);
        context.quadraticCurveTo(x + width, y, x + width, y + r);
        context.lineTo(x + width, y + height);
        context.lineTo(x, y + height);
        context.lineTo(x, y + r);
        context.quadraticCurveTo(x, y, x + r, y);
        context.closePath();
    }

    function drawVisualizer() {
        const canvas = el.canvas;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.round(width * dpr);
        const targetH = Math.round(height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, width, height);

        const analyser = nodes.analysers.master;
        const level = state.meterLevels.master || 0;
        const hasSignal = level > 0.035;
        const now = performance.now();
        if (hasSignal) state.vizSignalAt = now;

        const idle = !hasSignal && now - (state.vizSignalAt || 0) > 700;
        el.vizIdle.classList.toggle('is-hidden', !idle);
        el.vizLiveDot.classList.toggle('is-live', hasSignal);
        const idleText = state.micActive
            ? 'Mic is live — waiting for signal'
            : 'Play a sound or start the mic to see the signal';
        if (idle && el.vizIdle.textContent !== idleText) {
            el.vizIdle.textContent = idleText;
        }

        if (!analyser || !state.ctx) {
            ctx2d.strokeStyle = 'rgba(148, 163, 184, 0.12)';
            ctx2d.lineWidth = 1;
            ctx2d.beginPath();
            ctx2d.moveTo(0, height / 2);
            ctx2d.lineTo(width, height / 2);
            ctx2d.stroke();
            return;
        }

        if (state.vizMode === 'wave') {
            const data = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(data);
            const gradient = ctx2d.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, '#6674f4');
            gradient.addColorStop(0.55, '#8b7bff');
            gradient.addColorStop(1, '#26dcff');

            ctx2d.strokeStyle = gradient;
            ctx2d.lineWidth = 2;
            ctx2d.shadowColor = 'rgba(38, 220, 255, 0.55)';
            ctx2d.shadowBlur = 10;
            ctx2d.beginPath();
            const slice = width / (data.length - 1);
            for (let i = 0; i < data.length; i++) {
                const value = data[i] / 128.0;
                const y = (value * height) / 2;
                if (i === 0) ctx2d.moveTo(0, y);
                else ctx2d.lineTo(i * slice, y);
            }
            ctx2d.stroke();
            ctx2d.shadowBlur = 0;
            return;
        }

        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const barCount = Math.max(24, Math.min(54, Math.floor(width / 9)));
        const gap = 2;
        const barWidth = (width - (barCount - 1) * gap) / barCount;
        const gradient = ctx2d.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#4b57d6');
        gradient.addColorStop(0.55, '#8b7bff');
        gradient.addColorStop(1, '#26dcff');

        for (let i = 0; i < barCount; i++) {
            const index = Math.min(
                data.length - 1,
                Math.floor(Math.pow(i / barCount, 1.55) * data.length * 0.82)
            );
            const value = data[index] / 255;
            const barHeight = Math.max(1.5, Math.pow(value, 1.18) * (height - 8));
            const x = i * (barWidth + gap);
            ctx2d.fillStyle = gradient;
            roundedRect(ctx2d, x, height - barHeight - 2, barWidth, barHeight, Math.min(barWidth / 2, 2.5));
            ctx2d.fill();
        }
    }

    function setVizMode(mode, opts = {}) {
        state.vizMode = mode === 'wave' ? 'wave' : 'bars';
        state.prefs.viz = state.vizMode;
        el.btnVisBars.classList.toggle('is-active', state.vizMode === 'bars');
        el.btnVisWave.classList.toggle('is-active', state.vizMode === 'wave');
        el.btnVisBars.setAttribute('aria-pressed', String(state.vizMode === 'bars'));
        el.btnVisWave.setAttribute('aria-pressed', String(state.vizMode === 'wave'));
        if (!opts.silent) savePrefs();
    }

    function startRenderLoop() {
        const loop = () => {
            updateMeters();
            drawVisualizer();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    // -----------------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------------

    function setupEvents() {
        el.btnMicToggle.addEventListener('click', () => {
            if (state.micBusy) return;
            if (state.micActive) stopMicrophone();
            else startMicrophone();
        });

        el.btnMonitorToggle.addEventListener('click', () => {
            setMonitor(!state.monitorActive);
        });

        el.btnStopAll.addEventListener('click', stopAllSounds);

        el.virtualMicPill.addEventListener('click', () => {
            toggleVirtualMic();
        });

        el.btnDiscordGuide.addEventListener('click', () => openModal(el.discordModal));
        el.btnStartVirtualMicModal.addEventListener('click', () => {
            setVirtualMic(true);
        });
        el.btnBrowserLink.addEventListener('click', toggleBrowserFallback);
        el.btnRouteAudio.addEventListener('click', async () => {
            const ok = await routeStreamToSink(true);
            if (ok) {
                toast('Audio routed to virtual sink.', 'success', 2600);
            } else {
                toast('Routing failed — click “Enable browser capture” in any warning toast.', 'error', 4500);
            }
        });

        // Faders
        Object.keys(FADER_META).forEach((name) => {
            const input = $(FADER_META[name].input);
            input.addEventListener('input', () => setFader(name, input.value));
            input.addEventListener('dblclick', () => {
                input.value = 1;
                setFader(name, 1);
            });
        });

        // Noise gate
        el.noiseGateSlider.addEventListener('input', () => setGate(el.noiseGateSlider.value));

        // Echo cancellation
        const applyEchoCancellation = debounce(async () => {
            state.prefs.echoCancel = el.toggleEchoCancel.checked;
            savePrefs();
            if (state.micActive) {
                toast('Restarting the microphone to apply echo settings…', 'info', 2200);
                await restartMicrophone();
            }
        }, 260);
        el.toggleEchoCancel.addEventListener('change', applyEchoCancellation);

        // Devices
        el.selectMicDevice.addEventListener('change', async () => {
            state.prefs.micId = el.selectMicDevice.value;
            savePrefs();
            if (state.micActive) await restartMicrophone();
        });

        el.selectOutputDevice.addEventListener('change', () => {
            state.prefs.outputId = el.selectOutputDevice.value;
            savePrefs();
            ensureAudio()
                .then(() => routeStreamToSink(true))
                .catch(() => {});
        });

        el.selectMonitorDevice?.addEventListener('change', () => {
            state.prefs.monitorId = el.selectMonitorDevice.value;
            savePrefs();
            syncMonitorDeviceUI();
            if (state.ctx) applyMonitorRoute().catch(() => {});
        });

        // Visualizer
        el.btnVisBars.addEventListener('click', () => setVizMode('bars'));
        el.btnVisWave.addEventListener('click', () => setVizMode('wave'));

        // Voice sliders
        el.sliderPitch.addEventListener('input', () => {
            state.prefs.basePitch = Number(el.sliderPitch.value);
            el.labelPitch.textContent = fmtSigned(state.prefs.basePitch, ' st');
            updateRangeFill(el.sliderPitch);
            applyPitch(state.prefs.basePitch);
            markCustomVoice();
            savePrefs();
        });

        el.sliderTone.addEventListener('input', () => {
            state.prefs.baseTone = Number(el.sliderTone.value);
            el.labelTone.textContent = toneLabel(state.prefs.baseTone);
            updateRangeFill(el.sliderTone);
            applyTone(state.prefs.baseTone);
            markCustomVoice();
            savePrefs();
        });

        // Effects sliders
        const bindFxSlider = (input, key, label, format) => {
            input.addEventListener('input', () => {
                state.prefs.fx[key] = Number(input.value);
                label.textContent = format(state.prefs.fx[key]);
                updateRangeFill(input);
                syncFxControls();
                savePrefs();
            });
        };
        bindFxSlider(el.sliderReverb, 'reverb', el.labelReverb, (v) => `${Math.round(v)}%`);
        bindFxSlider(el.sliderEcho, 'echo', el.labelEcho, (v) => `${Math.round(v)} ms`);
        bindFxSlider(el.sliderDrive, 'drive', el.labelDrive, (v) => `${Math.round(v)}%`);
        bindFxSlider(el.sliderRobot, 'robot', el.labelRobot, (v) => `${Math.round(v)} Hz`);

        // Effect presets
        el.btnFxRobot.addEventListener('click', toggleRobotFx);
        el.btnFxRadio.addEventListener('click', toggleRadioFx);
        el.btnFxDemon.addEventListener('click', toggleDemonFx);
        el.btnFxCave.addEventListener('click', toggleCaveFx);
        el.btnClearEffects.addEventListener('click', () => clearAllEffects());
        el.btnResetVoice.addEventListener('click', () => {
            selectCharacter('normal');
            toast('Voice reset to normal.', 'info', 2000);
        });

        // Soundboard
        el.soundSearch.addEventListener('input', () => renderSoundboard());
        el.soundSearch.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && el.soundSearch.value) {
                event.stopPropagation();
                el.soundSearch.value = '';
                renderSoundboard();
            }
        });

        el.btnOpenUpload.addEventListener('click', () => el.soundFileInput.click());
        el.soundFileInput.addEventListener('change', (event) => {
            uploadFiles(event.target.files);
        });

        el.btnOpenTrash.addEventListener('click', openTrash);
        el.btnEmptyTrash.addEventListener('click', emptyTrash);

        const openPicker = () => {
            if (!state.uploadBusy) el.soundFileInput.click();
        };
        el.soundDropzone.addEventListener('click', openPicker);
        el.soundDropzone.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPicker();
            }
        });
        el.soundDropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
            el.soundDropzone.classList.add('is-dragover');
        });
        el.soundDropzone.addEventListener('dragleave', (event) => {
            if (!el.soundDropzone.contains(event.relatedTarget)) {
                el.soundDropzone.classList.remove('is-dragover');
            }
        });
        el.soundDropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
            el.soundDropzone.classList.remove('is-dragover');
            uploadFiles(event.dataTransfer.files);
        });

        // Prevent the browser from navigating away when a file is dropped elsewhere.
        window.addEventListener('dragover', (event) => {
            if (!event.target.closest?.('#soundDropzone')) event.preventDefault();
        });
        window.addEventListener('drop', (event) => {
            if (!event.target.closest?.('#soundDropzone')) event.preventDefault();
        });

        el.btnClearKeybind.addEventListener('click', clearKeybind);

        // Keyboard shortcuts
        window.addEventListener('keydown', handleGlobalKeydown);

        // Device changes and status polling
        navigator.mediaDevices?.addEventListener('devicechange', debounce(() => {
            refreshDevices();
        }, 500));

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                checkVirtualMicStatus();
                refreshDevices();
            }
        });
    }

    function handleGlobalKeydown(event) {
        if (state.keybindTarget) return;

        const target = event.target;
        const typing = target instanceof HTMLElement && (
            target.tagName === 'INPUT'
            || target.tagName === 'TEXTAREA'
            || target.tagName === 'SELECT'
            || target.isContentEditable
        );

        if (event.key === 'Escape') {
            if (state.modals.length > 0) {
                event.preventDefault();
                const modal = state.modals[state.modals.length - 1];
                if (modal === el.keybindModal) closeKeybindModal();
                else closeModal(modal);
                return;
            }
            if (typing && target === el.soundSearch && el.soundSearch.value) {
                event.preventDefault();
                el.soundSearch.value = '';
                renderSoundboard();
                return;
            }
            if (!typing) {
                event.preventDefault();
                stopAllSounds();
            }
            return;
        }

        if (typing || state.modals.length > 0) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.repeat) return;

        if (event.key === '/') {
            event.preventDefault();
            el.soundSearch.focus();
            el.soundSearch.select();
            return;
        }

        if (event.key === 'm' || event.key === 'M') {
            event.preventDefault();
            if (!state.micBusy) {
                if (state.micActive) stopMicrophone();
                else startMicrophone();
            }
            return;
        }

        if (event.key === 'h' || event.key === 'H') {
            event.preventDefault();
            setMonitor(!state.monitorActive);
            return;
        }

        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        if (triggerSoundByKey(key)) {
            event.preventDefault();
        }
    }

    // -----------------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------------

    async function init() {
        state.prefs = loadPrefs();
        state.monitorActive = state.prefs.monitor !== false;
        state.vizMode = state.prefs.viz;

        const storedKeys = loadJson(KEYS_KEY, {});
        state.keybinds = {};
        Object.entries(storedKeys).forEach(([id, key]) => {
            if (typeof key === 'string') state.keybinds[id] = key;
        });

        el.toggleEchoCancel.checked = state.prefs.echoCancel;
        el.btnBrowserLink.textContent = 'Reconnect audio feed';

        renderVoiceCards();
        syncVoiceControls();
        syncFxControls();
        syncGateUI();
        Object.keys(FADER_META).forEach(syncFaderUI);
        setVizMode(state.prefs.viz, { silent: true });
        updateMonitorUI();
        updateMicUI('off');
        updateEngineUI();
        setRouteStatus('is-off', 'Not routed');

        setupModals();
        setupEditModalEvents();
        setupEvents();
        startRenderLoop();

        await loadSounds();
        await loadTrash();
        await checkVirtualMicStatus();
        await refreshDevices();

        setInterval(() => {
            if (!document.hidden) checkVirtualMicStatus();
        }, 10000);

        // One-time gesture listener in case autoplay blocked the Discord feed.
        document.addEventListener('pointerdown', () => {
            if (state.ctx && state.virtualMicActive && !state.routeOk) {
                routeStreamToSink(true);
            }
        }, { once: true });

        // Keep the feed attached: browser streams come and go, and a lost link
        // is what makes the virtual mic suddenly go silent.
        setInterval(() => {
            if (!document.hidden && state.virtualMicActive && state.ctx) {
                routeStreamToSink();
            }
        }, 4000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Debug handle so the console can inspect live audio state.
    window.__auramixer = {
        getState: () => state,
        getContextState: () => (state.ctx ? state.ctx.state : null),
        getMicActive: () => state.micActive,
        getMasterLevel: () => readLevel('master'),
        getMicLevel: () => readLevel('mic'),
        getFaders: () => state.prefs.faders,
        getGate: () => state.prefs.gate
    };
})();
