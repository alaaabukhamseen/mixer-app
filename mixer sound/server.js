// server.js - AuraMixer Studio backend (soundboard + PipeWire virtual mic)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3030;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SOUNDS_DIR = path.join(PUBLIC_DIR, 'sounds');
const DATA_DIR = path.join(__dirname, 'data');
const META_FILE = path.join(DATA_DIR, 'soundboard.json');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
const VIRTUAL_MIC_SCRIPT = path.join(__dirname, 'virtual-mic.sh');

const MAX_UPLOAD_BYTES = 28 * 1024 * 1024;
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const AUDIO_EXT = /\.(wav|mp3|ogg|oga|m4a|aac|webm|flac)$/i;
const TIMESTAMP_SUFFIX = /[-_]\d{13}$/;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
    '.ico': 'image/x-icon'
};

if (!fs.existsSync(SOUNDS_DIR)) {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}
for (const dir of [DATA_DIR, TRASH_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; " +
        "font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

// Only allow API calls that originate from this app (blocks CSRF from other
// sites while keeping simple curl/local use working when no Origin is sent).
function isSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        const originUrl = new URL(origin);
        return originUrl.host === req.headers.host;
    } catch {
        return false;
    }
}

function runVirtualMicCommand(action, callback) {
    if (!fs.existsSync(VIRTUAL_MIC_SCRIPT)) {
        return callback(null, {
            action,
            success: false,
            active: false,
            output: 'virtual-mic.sh is missing.'
        });
    }
    execFile(VIRTUAL_MIC_SCRIPT, [action], { timeout: 15000 }, (error, stdout, stderr) => {
        const output = ((stdout || '') + (stderr || '')).trim();
        const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        let active;
        if (action === 'status') {
            // "ACTIVE" / "INACTIVE" are the bare state tokens printed by the script.
            active = lines.includes('ACTIVE') && !lines.includes('INACTIVE');
        } else if (action === 'stop') {
            active = false;
        } else {
            // start: running means "was already running" or "just started fine".
            active = !error;
        }
        callback(null, {
            action,
            success: !error || action === 'status',
            active,
            output
        });
    });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        let settled = false;

        const fail = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        req.on('data', (chunk) => {
            if (settled) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                fail(Object.assign(new Error('Upload is too large.'), { statusCode: 413 }));
                req.resume();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            settled = true;
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (error) {
                reject(Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 }));
            }
        });
        req.on('error', fail);
    });
}

// ---------------------------------------------------------------------------
// Dedicated PCM feed into the virtual sink.
// The browser captures the app's mixed audio as raw PCM and posts it here; a
// single pw-play process writes it to SoundboardSink. Unlike pw-link, this is
// isolated from all other browser audio, so other apps (Discord) cannot echo
// back into the virtual microphone.
// ---------------------------------------------------------------------------
let feedProc = null;
let feedSeq = -1;
let feedWatchdog = null;

function stopFeedProcess() {
    if (feedWatchdog) {
        clearTimeout(feedWatchdog);
        feedWatchdog = null;
    }
    if (feedProc) {
        try { feedProc.stdin.end(); } catch { /* ignore */ }
        try { feedProc.kill('SIGTERM'); } catch { /* ignore */ }
        feedProc = null;
    }
    feedSeq = -1;
}

function startFeedProcess() {
    if (feedProc && feedProc.exitCode === null && !feedProc.killed) return feedProc;
    stopFeedProcess();
    try {
        feedProc = spawn('pw-play', [
            '--target', 'SoundboardSink',
            '--format', 's16',
            '--rate', '48000',
            '--channels', '2',
            '--latency', '50',
            '-'
        ], { stdio: ['pipe', 'ignore', 'pipe'] });
        feedProc.stderr.on('data', () => { /* drain to avoid blocking */ });
        feedProc.on('error', () => { feedProc = null; });
        feedProc.on('exit', () => { feedProc = null; });
    } catch {
        feedProc = null;
    }
    return feedProc;
}

function kickFeedWatchdog() {
    if (feedWatchdog) clearTimeout(feedWatchdog);
    feedWatchdog = setTimeout(stopFeedProcess, 4000);
}

function soundNameFromFile(file) {
    const base = path.parse(file).name
        .replace(TIMESTAMP_SUFFIX, '')
        .replace(/[_\-]+/g, ' ')
        .trim();
    const name = base || 'Custom sound';
    return name.charAt(0).toUpperCase() + name.slice(1);
}

// -----------------------------------------------------------------------------
// Soundboard metadata + trash
// -----------------------------------------------------------------------------

function emptyMeta() {
    return { version: 1, order: [], sounds: {}, trash: [] };
}

function loadMeta() {
    try {
        if (!fs.existsSync(META_FILE)) return emptyMeta();
        const parsed = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
        const meta = emptyMeta();
        if (Array.isArray(parsed.order)) {
            meta.order = parsed.order.filter((id) => typeof id === 'string');
        }
        if (parsed.sounds && typeof parsed.sounds === 'object') {
            Object.entries(parsed.sounds).forEach(([id, value]) => {
                if (typeof id === 'string' && value && typeof value === 'object') {
                    meta.sounds[id] = normalizeSoundMeta(value, soundNameFromFile(id));
                }
            });
        }
        if (Array.isArray(parsed.trash)) {
            meta.trash = parsed.trash.filter((entry) =>
                entry && typeof entry.trashId === 'string' && typeof entry.filename === 'string'
            ).filter((entry) => {
                const stored = path.basename(entry.stored || '');
                return Boolean(stored) && fs.existsSync(path.join(TRASH_DIR, stored));
            });
        }
        return meta;
    } catch (error) {
        console.error(`Could not read soundboard metadata: ${error.message}`);
        return emptyMeta();
    }
}

function saveMeta(meta) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const temp = `${META_FILE}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(meta, null, 2));
        fs.renameSync(temp, META_FILE);
    } catch (error) {
        console.error(`Could not save soundboard metadata: ${error.message}`);
    }
}

function normalizeSoundMeta(input, fallbackName = '') {
    const raw = input && typeof input === 'object' ? input : {};
    const text = (value, max, fallback = '') =>
        typeof value === 'string' ? value.trim().slice(0, max) : fallback;
    const number = (value, min, max, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };

    const rawTags = Array.isArray(raw.tags)
        ? raw.tags
        : (typeof raw.tags === 'string' ? raw.tags.split(',') : []);
    const tags = [...new Set(rawTags
        .map((tag) => String(tag).trim().slice(0, 24))
        .filter(Boolean))]
        .slice(0, 8);

    const trimStart = number(raw.trimStart, 0, 3600, 0);
    let trimEnd = raw.trimEnd === null || raw.trimEnd === undefined || raw.trimEnd === ''
        ? null
        : number(raw.trimEnd, 0, 3600, null);
    if (trimEnd !== null && trimEnd <= trimStart + 0.03) trimEnd = null;

    return {
        name: text(raw.name, 80, fallbackName),
        icon: text(raw.icon, 8, ''),
        folder: text(raw.folder, 40, ''),
        tags,
        favorite: raw.favorite === true,
        volume: Number(number(raw.volume, 0, 2, 1).toFixed(3)),
        trimStart: Number(trimStart.toFixed(3)),
        trimEnd: trimEnd === null ? null : Number(trimEnd.toFixed(3)),
        fadeIn: Number(number(raw.fadeIn, 0, 5, 0).toFixed(3)),
        fadeOut: Number(number(raw.fadeOut, 0, 5, 0).toFixed(3)),
        loop: raw.loop === true
    };
}

function makeSound(file, meta) {
    const stats = fs.statSync(path.join(SOUNDS_DIR, file));
    const stored = meta.sounds[file] || {};
    const fallbackName = soundNameFromFile(file);
    const clean = normalizeSoundMeta(stored, fallbackName);
    if (!clean.name) clean.name = fallbackName;
    return {
        id: file,
        filename: file,
        name: clean.name,
        icon: clean.icon,
        folder: clean.folder,
        tags: clean.tags,
        favorite: clean.favorite,
        volume: clean.volume,
        trimStart: clean.trimStart,
        trimEnd: clean.trimEnd,
        fadeIn: clean.fadeIn,
        fadeOut: clean.fadeOut,
        loop: clean.loop,
        customName: typeof stored.name === 'string' && stored.name.trim() !== '',
        hasMeta: Boolean(meta.sounds[file]),
        url: `/sounds/${encodeURIComponent(file)}`,
        size: stats.size,
        createdAt: stats.birthtimeMs || stats.mtimeMs
    };
}

function listSounds() {
    const meta = loadMeta();
    const order = new Map(meta.order.map((id, index) => [id, index]));
    const files = fs.readdirSync(SOUNDS_DIR).filter((file) => AUDIO_EXT.test(file));

    return files
        .map((file) => {
            try {
                return makeSound(file, meta);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => {
            const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
            const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;
            if (ai === Number.MAX_SAFE_INTEGER && a.createdAt !== b.createdAt) {
                return a.createdAt - b.createdAt;
            }
            return a.name.localeCompare(b.name);
        });
}

function uniqueSoundFilename(preferred) {
    const ext = path.extname(preferred).toLowerCase();
    const base = path.basename(preferred, path.extname(preferred));
    let candidate = preferred;
    let counter = 1;
    while (fs.existsSync(path.join(SOUNDS_DIR, candidate))) {
        candidate = `${base}_restored_${Date.now()}_${counter}${ext}`;
        counter += 1;
    }
    return candidate;
}

function makeTrashEntry(entry) {
    const storedName = path.basename(entry.stored || '');
    let size = 0;
    try {
        size = fs.statSync(path.join(TRASH_DIR, storedName)).size;
    } catch { /* file may be gone */ }
    return {
        trashId: entry.trashId,
        filename: entry.filename,
        name: (entry.meta && entry.meta.name) || soundNameFromFile(entry.filename),
        folder: (entry.meta && entry.meta.folder) || '',
        favorite: Boolean(entry.meta && entry.meta.favorite),
        deletedAt: entry.deletedAt || 0,
        size
    };
}


function handleApiRequest(req, res, url) {
    if (!isSameOrigin(req)) {
        return sendJson(res, 403, { error: 'Cross-origin API requests are not allowed.' });
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Allow': 'GET, POST, PATCH, DELETE, OPTIONS',
            'Cache-Control': 'no-store'
        });
        return res.end();
    }

    // 1. Virtual mic status
    if (url.pathname === '/api/status' && req.method === 'GET') {
        return runVirtualMicCommand('status', (err, result) => sendJson(res, 200, result));
    }

    // 2. Virtual mic controls
    const micActions = {
        '/api/virtual-mic/start': 'start',
        '/api/virtual-mic/stop': 'stop',
        '/api/virtual-mic/link': 'link',
        '/api/virtual-mic/check': 'check',
        '/api/virtual-mic/unlink': 'unlink',
        '/api/virtual-mic/restart': 'restart'
    };
    if (micActions[url.pathname] && req.method === 'POST') {
        return runVirtualMicCommand(micActions[url.pathname], (err, result) => {
            sendJson(res, result.success ? 200 : 500, result);
        });
    }

    // 3. Isolated PCM feed into the virtual sink
    if (url.pathname === '/api/feed/start' && req.method === 'POST') {
        const proc = startFeedProcess();
        kickFeedWatchdog();
        return sendJson(res, proc ? 200 : 500, { ok: Boolean(proc) });
    }
    if (url.pathname === '/api/feed/stop' && req.method === 'POST') {
        stopFeedProcess();
        return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/feed/chunk' && req.method === 'POST') {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
                tooLarge = true;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (tooLarge) return sendJson(res, 413, { error: 'Chunk too large.' });
            const seq = Number(url.searchParams.get('seq') || 0);
            const proc = startFeedProcess();
            let dropped = false;
            if (proc && seq > feedSeq) {
                feedSeq = seq;
                try { proc.stdin.write(Buffer.concat(chunks)); } catch { dropped = true; }
                kickFeedWatchdog();
            } else {
                dropped = true;
            }
            return sendJson(res, 200, { ok: true, dropped });
        });
        return;
    }

    // 4. List sounds
    if (url.pathname === '/api/sounds' && req.method === 'GET') {
        try {
            return sendJson(res, 200, { sounds: listSounds() });
        } catch (error) {
            return sendJson(res, 500, { error: 'Could not read the sounds folder.' });
        }
    }

    // 4. Save pad order (must be matched before /api/sounds/:id)
    if (url.pathname === '/api/sounds/order' && req.method === 'POST') {
        return readJsonBody(req)
            .then((data) => {
                const requested = Array.isArray(data.order) ? data.order : [];
                const meta = loadMeta();
                const files = new Set(fs.readdirSync(SOUNDS_DIR).filter((file) => AUDIO_EXT.test(file)));
                const seen = new Set();
                const order = [];
                requested.forEach((id) => {
                    if (seen.has(id) || !files.has(id)) return;
                    seen.add(id);
                    order.push(id);
                });
                // Keep any files the client did not know about at the end.
                [...files].sort().forEach((file) => {
                    if (!seen.has(file)) order.push(file);
                });
                meta.order = order;
                saveMeta(meta);
                return sendJson(res, 200, { success: true, order });
            })
            .catch((error) => {
                sendJson(res, error.statusCode || 500, { error: error.message || 'Could not save order.' });
            });
    }

    // 5. Upload sound (JSON base64 data URL)
    if (url.pathname === '/api/upload-sound' && req.method === 'POST') {
        return readJsonBody(req)
            .then((data) => {
                const rawName = String(data.name || 'custom-sound');
                let ext = path.extname(rawName).toLowerCase();
                if (!ext || !AUDIO_EXT.test(ext)) ext = '.mp3';

                const baseName = path.basename(rawName, path.extname(rawName))
                    .replace(/[^a-zA-Z0-9_-]+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 60) || 'custom-sound';

                let base64Data = String(data.base64 || '');
                const comma = base64Data.indexOf(',');
                if (comma !== -1) base64Data = base64Data.slice(comma + 1);
                base64Data = base64Data.replace(/\s/g, '');
                if (!base64Data) {
                    return sendJson(res, 400, { error: 'No audio data was sent.' });
                }

                const buffer = Buffer.from(base64Data, 'base64');
                if (!buffer.length) {
                    return sendJson(res, 400, { error: 'The uploaded audio file is empty.' });
                }
                if (buffer.length > MAX_UPLOAD_BYTES) {
                    return sendJson(res, 413, { error: 'Audio files must be 28 MB or smaller.' });
                }

                let filename = `${baseName}_${Date.now()}${ext}`;
                let counter = 1;
                while (fs.existsSync(path.join(SOUNDS_DIR, filename))) {
                    filename = `${baseName}_${Date.now()}_${counter}${ext}`;
                    counter += 1;
                }
                fs.writeFileSync(path.join(SOUNDS_DIR, filename), buffer);

                const meta = loadMeta();
                const displayName = typeof data.displayName === 'string' && data.displayName.trim()
                    ? data.displayName.trim().slice(0, 80)
                    : soundNameFromFile(filename);
                meta.sounds[filename] = normalizeSoundMeta({ name: displayName }, displayName);
                meta.order = meta.order.filter((id) => id !== filename);
                meta.order.push(filename);
                saveMeta(meta);

                return sendJson(res, 200, {
                    success: true,
                    sound: makeSound(filename, meta)
                });
            })
            .catch((error) => {
                sendJson(res, error.statusCode || 500, { error: error.message || 'Upload failed.' });
            });
    }

    // 6. Update sound metadata (name, icon, folder, tags, volume, trim, fades, loop)
    if (url.pathname.startsWith('/api/sounds/') && req.method === 'PATCH') {
        let fileToUpdate;
        try {
            fileToUpdate = decodeURIComponent(url.pathname.slice('/api/sounds/'.length));
        } catch {
            return sendJson(res, 400, { error: 'Invalid filename.' });
        }
        if (!fileToUpdate || path.basename(fileToUpdate) !== fileToUpdate || !AUDIO_EXT.test(fileToUpdate)) {
            return sendJson(res, 400, { error: 'Invalid sound filename.' });
        }
        if (!fs.existsSync(path.join(SOUNDS_DIR, fileToUpdate))) {
            return sendJson(res, 404, { error: 'Sound not found.' });
        }

        return readJsonBody(req)
            .then((data) => {
                const meta = loadMeta();
                const current = meta.sounds[fileToUpdate] || {};
                const patch = {};
                ['name', 'icon', 'folder', 'tags', 'favorite', 'volume',
                    'trimStart', 'trimEnd', 'fadeIn', 'fadeOut', 'loop'].forEach((key) => {
                    if (Object.prototype.hasOwnProperty.call(data, key)) patch[key] = data[key];
                });
                const fallbackName = soundNameFromFile(fileToUpdate);
                const merged = normalizeSoundMeta({ ...current, ...patch }, fallbackName);
                if (!merged.name) merged.name = fallbackName;
                meta.sounds[fileToUpdate] = merged;
                if (!meta.order.includes(fileToUpdate)) meta.order.push(fileToUpdate);
                saveMeta(meta);
                return sendJson(res, 200, { success: true, sound: makeSound(fileToUpdate, meta) });
            })
            .catch((error) => {
                sendJson(res, error.statusCode || 500, { error: error.message || 'Could not update sound.' });
            });
    }

    // 7. Delete sound -> move to trash
    if (url.pathname.startsWith('/api/sounds/') && req.method === 'DELETE') {
        let fileToDelete;
        try {
            fileToDelete = decodeURIComponent(url.pathname.slice('/api/sounds/'.length));
        } catch {
            return sendJson(res, 400, { error: 'Invalid filename.' });
        }

        if (!fileToDelete || path.basename(fileToDelete) !== fileToDelete || !AUDIO_EXT.test(fileToDelete)) {
            return sendJson(res, 400, { error: 'Invalid sound filename.' });
        }

        const safePath = path.join(SOUNDS_DIR, fileToDelete);
        if (!safePath.startsWith(SOUNDS_DIR + path.sep) || !fs.existsSync(safePath)) {
            return sendJson(res, 404, { error: 'Sound not found.' });
        }
        try {
            const meta = loadMeta();
            const fallbackName = soundNameFromFile(fileToDelete);
            const savedMeta = normalizeSoundMeta(meta.sounds[fileToDelete] || { name: fallbackName }, fallbackName);
            const trashEntry = {
                trashId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                filename: fileToDelete,
                stored: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}__${fileToDelete}`,
                deletedAt: Date.now(),
                meta: savedMeta
            };
            const trashPath = path.join(TRASH_DIR, trashEntry.stored);
            try {
                fs.renameSync(safePath, trashPath);
            } catch {
                fs.copyFileSync(safePath, trashPath);
                fs.unlinkSync(safePath);
            }

            delete meta.sounds[fileToDelete];
            meta.order = meta.order.filter((id) => id !== fileToDelete);
            meta.trash = meta.trash.filter((entry) => entry.filename !== fileToDelete || entry.stored !== trashEntry.stored);
            meta.trash.unshift(trashEntry);
            saveMeta(meta);

            return sendJson(res, 200, {
                success: true,
                deleted: fileToDelete,
                trash: makeTrashEntry(trashEntry)
            });
        } catch (error) {
            return sendJson(res, 500, { error: `Could not move the sound to trash: ${error.message}` });
        }
    }

    // 8. List trash
    if (url.pathname === '/api/trash' && req.method === 'GET') {
        try {
            const meta = loadMeta();
            const trash = meta.trash
                .slice()
                .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
                .map(makeTrashEntry);
            return sendJson(res, 200, { trash });
        } catch {
            return sendJson(res, 500, { error: 'Could not read the trash.' });
        }
    }

    // 9. Restore from trash
    if (url.pathname === '/api/trash/restore' && req.method === 'POST') {
        return readJsonBody(req)
            .then((data) => {
                const trashId = String(data.trashId || '');
                const meta = loadMeta();
                const index = meta.trash.findIndex((entry) => entry.trashId === trashId);
                if (index === -1) return sendJson(res, 404, { error: 'This item is no longer in the trash.' });

                const entry = meta.trash[index];
                const storedName = path.basename(entry.stored || '');
                const storedPath = path.join(TRASH_DIR, storedName);
                if (!storedName || !fs.existsSync(storedPath)) {
                    meta.trash.splice(index, 1);
                    saveMeta(meta);
                    return sendJson(res, 404, { error: 'The deleted audio file is missing.' });
                }

                const targetFilename = fs.existsSync(path.join(SOUNDS_DIR, entry.filename))
                    ? uniqueSoundFilename(entry.filename)
                    : entry.filename;
                const targetPath = path.join(SOUNDS_DIR, targetFilename);
                try {
                    fs.renameSync(storedPath, targetPath);
                } catch {
                    fs.copyFileSync(storedPath, targetPath);
                    fs.unlinkSync(storedPath);
                }

                if (entry.meta) {
                    meta.sounds[targetFilename] = normalizeSoundMeta(entry.meta, soundNameFromFile(targetFilename));
                }
                if (!meta.order.includes(targetFilename)) meta.order.push(targetFilename);
                meta.trash.splice(index, 1);
                saveMeta(meta);

                return sendJson(res, 200, {
                    success: true,
                    sound: makeSound(targetFilename, meta),
                    restoredAs: targetFilename
                });
            })
            .catch((error) => {
                sendJson(res, error.statusCode || 500, { error: error.message || 'Could not restore sound.' });
            });
    }

    // 10. Empty the trash
    if (url.pathname === '/api/trash/empty' && req.method === 'POST') {
        try {
            const meta = loadMeta();
            let removed = 0;
            meta.trash.forEach((entry) => {
                const storedName = path.basename(entry.stored || '');
                if (!storedName) return;
                try {
                    fs.unlinkSync(path.join(TRASH_DIR, storedName));
                    removed += 1;
                } catch { /* already gone */ }
            });
            const filenames = meta.trash.map((entry) => entry.filename);
            meta.trash = [];
            saveMeta(meta);
            return sendJson(res, 200, { success: true, removed, filenames });
        } catch (error) {
            return sendJson(res, 500, { error: `Could not empty the trash: ${error.message}` });
        }
    }

    // 11. Permanently delete one trashed item
    if (url.pathname.startsWith('/api/trash/') && req.method === 'DELETE') {
        let trashId;
        try {
            trashId = decodeURIComponent(url.pathname.slice('/api/trash/'.length));
        } catch {
            return sendJson(res, 400, { error: 'Invalid trash id.' });
        }
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(trashId)) {
            return sendJson(res, 400, { error: 'Invalid trash id.' });
        }
        try {
            const meta = loadMeta();
            const index = meta.trash.findIndex((entry) => entry.trashId === trashId);
            if (index === -1) return sendJson(res, 404, { error: 'This item is no longer in the trash.' });
            const entry = meta.trash[index];
            const storedName = path.basename(entry.stored || '');
            if (storedName) {
                try { fs.unlinkSync(path.join(TRASH_DIR, storedName)); } catch { /* already gone */ }
            }
            meta.trash.splice(index, 1);
            saveMeta(meta);
            return sendJson(res, 200, { success: true, trashId, filename: entry.filename });
        } catch (error) {
            return sendJson(res, 500, { error: `Could not delete the item: ${error.message}` });
        }
    }

    return sendJson(res, 404, { error: 'Not Found' });
}

function handleStaticFile(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' });
        return res.end('Method Not Allowed');
    }

    let reqPath;
    try {
        reqPath = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad Request');
    }
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    if (reqPath.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad Request');
    }

    const safePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
    if (safePath !== PUBLIC_DIR && !safePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Access Denied');
    }

    fs.stat(safePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const isAudio = contentType.startsWith('audio/');
        const cacheControl = ['.html', '.js', '.css', '.mjs'].includes(ext) ? 'no-store' : 'no-cache';

        const range = req.headers.range;
        if (range && isAudio) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) {
                res.writeHead(416, {
                    'Content-Range': `bytes */${stats.size}`,
                    'Accept-Ranges': 'bytes'
                });
                return res.end();
            }

            let start;
            let end;
            if (match[1] === '' && match[2] !== '') {
                // Suffix range: last N bytes.
                const suffixLength = Number(match[2]);
                start = Math.max(0, stats.size - suffixLength);
                end = stats.size - 1;
            } else {
                start = Number(match[1]);
                end = match[2] === '' ? stats.size - 1 : Number(match[2]);
            }

            if (!Number.isFinite(start) || !Number.isFinite(end) ||
                start < 0 || start >= stats.size || end < start) {
                res.writeHead(416, {
                    'Content-Range': `bytes */${stats.size}`,
                    'Accept-Ranges': 'bytes'
                });
                return res.end();
            }
            end = Math.min(end, stats.size - 1);

            const chunkSize = end - start + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
                'Cache-Control': cacheControl
            });
            if (req.method === 'HEAD') return res.end();
            return fs.createReadStream(safePath, { start, end }).pipe(res);
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': cacheControl
        });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(safePath).pipe(res);
    });
}

const server = http.createServer((req, res) => {
    setSecurityHeaders(res);
    let url;
    try {
        url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad Request');
    }

    if (url.pathname.startsWith('/api/')) {
        handleApiRequest(req, res, url);
    } else {
        handleStaticFile(req, res, url);
    }
});

server.on('error', (error) => {
    console.error(`Server error: ${error.message}`);
    process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
    console.log('=======================================================');
    console.log('🎙️  AuraMixer Studio is running!');
    console.log(`📡 Local URL: http://localhost:${PORT}`);
    console.log(`🔒 Bound to: ${HOST}:${PORT}`);
    console.log(`🎧 Sounds folder: ${SOUNDS_DIR}`);
    console.log('=======================================================');
});
