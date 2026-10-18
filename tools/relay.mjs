#!/usr/bin/env node
/**
 * VITA Co-op Relay — WebSocket fan-out untuk mode co-op campaign (maks 4 pemain).
 *
 * Zero dependency: hanya modul inti Node (node:http, node:crypto, node:url).
 * Implementasi protokol RFC 6455 (handshake + codec frame) sendiri agar tidak
 * menambah paket npm ke proyek yang menganut prinsip "tanpa aset/dependency eksternal".
 *
 * Peran server (host-authoritative):
 *   - Klien mengirim JOIN { roomId, isHost, callsign }.
 *   - Server membalas WELCOME { peerIndex, peeks[] } ke pendatang dan
 *     PEER_JOIN { peerIndex, callsign } ke anggota kamar lain.
 *   - INPUT / SNAPSHOT / START_GAME diteruskan (broadcast) ke anggota lain,
 *     dengan peerIndex di-stamp oleh server (otoritatif, bukan dari klien).
 *   - PING / PONG aplikasi: bertarget bila ada `to`, jika tidak di-broadcast.
 *   - PEER_LEAVE dikirim ke sisa anggota saat klien terputus.
 *
 * Jalankan: npm run relay    (atau: node tools/relay.mjs --port 8080)
 * Kesehatan: GET http://localhost:8080/  -> JSON status
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------
// Batas keras (hardening: cegah kamar/message tak terbatas)
// ---------------------------------------------------------------
const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_ROOMS = 500;
const HEARTBEAT_MS = 30000;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---------------------------------------------------------------
// Handshake & codec WebSocket (murni, dapat diuji terpisah)
// ---------------------------------------------------------------
function computeAcceptKey(key) {
    const guid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    if (typeof key !== 'string' || key.length < 8) return '';
    return crypto.createHash('sha1').update(key + guid, 'utf8').digest('base64');
}

function decodeWebSocketFrame(buf) {
    const cap = 1024 * 1024;
    if (!buf || buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
        if (buf.length < 4) return null;
        len = buf.readUInt16BE(2);
        offset = 4;
    } else if (len === 127) {
        if (buf.length < 10) return null;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(cap)) return { error: 'too_large' };
        len = Number(big);
        offset = 10;
    }
    if (len > cap) return { error: 'too_large' };
    const maskLen = masked ? 4 : 0;
    const total = offset + maskLen + len;
    if (buf.length < total) return null;
    let maskKey = null;
    if (masked) maskKey = buf.subarray(offset, offset + 4);
    const dataStart = offset + maskLen;
    let payload = buf.subarray(dataStart, dataStart + len);
    if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
    }
    return { fin, opcode, masked, payload, size: len, consumed: total };
}

function encodeWebSocketFrame(opcode, payload, mask) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
    const len = data.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | (opcode & 0x0f);
    if (mask) {
        header[1] |= 0x80;
        const key = Buffer.from([0x12, 0x34, 0x56, 0x78]);
        const out = Buffer.alloc(header.length + 4 + len);
        header.copy(out, 0);
        key.copy(out, header.length);
        for (let i = 0; i < len; i++) out[header.length + 4 + i] = data[i] ^ key[i & 3];
        return out;
    }
    const out = Buffer.alloc(header.length + len);
    header.copy(out, 0);
    data.copy(out, header.length);
    return out;
}

function encodeTextFrame(str) {
    return encodeWebSocketFrame(0x1, Buffer.from(String(str), 'utf8'), false);
}

function createFrameParser(maxBytes) {
    const cap = (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : 1024 * 1024;
    let buffer = Buffer.alloc(0);
    let fragments = null;
    let fragmentOpcode = 0;
    return function push(chunk) {
        const out = [];
        if (chunk && chunk.length) buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
            const f = decodeWebSocketFrame(buffer);
            if (!f) break;
            if (f.error) {
                out.push({ error: f.error });
                buffer = Buffer.alloc(0);
                break;
            }
            buffer = buffer.subarray(f.consumed);
            if (f.payload.length > cap) {
                out.push({ error: 'too_large' });
                continue;
            }
            if (f.opcode === 0x8 || f.opcode === 0x9 || f.opcode === 0xA) {
                out.push({ opcode: f.opcode, payload: f.payload });
                continue;
            }
            if (f.opcode === 0x0 && fragments) {
                fragments.total += f.payload.length;
                if (fragments.total > cap) {
                    out.push({ error: 'too_large' });
                    fragments = null;
                    continue;
                }
                fragments.parts.push(f.payload);
                if (f.fin) {
                    out.push({ opcode: fragmentOpcode, text: Buffer.concat(fragments.parts).toString('utf8') });
                    fragments = null;
                }
                continue;
            }
            if (f.opcode === 0x1 || f.opcode === 0x2) {
                if (!f.fin) {
                    fragments = { parts: [f.payload], total: f.payload.length };
                    fragmentOpcode = f.opcode;
                    continue;
                }
                if (f.opcode === 0x1) out.push({ opcode: 0x1, text: f.payload.toString('utf8') });
                else out.push({ opcode: 0x2, binary: f.payload });
                continue;
            }
        }
        return out;
    };
}

// ---------------------------------------------------------------
// Sanitasi input tak terpercaya dari klien
// ---------------------------------------------------------------
function sanitizeRoomCode(raw) {
    if (typeof raw !== 'string') return '';
    const up = raw.toUpperCase();
    let out = '';
    for (let i = 0; i < up.length && out.length < 8; i++) {
        const c = up.charAt(i);
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) out += c;
    }
    return out.length >= 3 ? out : '';
}

function sanitizeCallsign(raw) {
    if (typeof raw !== 'string') return '';
    let out = '';
    const banned = '<>"\'&\\`';
    for (let i = 0; i < raw.length && out.length < 16; i++) {
        const c = raw.charAt(i);
        if (c < ' ') continue;
        if (banned.indexOf(c) !== -1) continue;
        out += c;
    }
    return out.trim();
}

// ---------------------------------------------------------------
// Manajemen kamar & penugasan indeks pemain (host = 0)
// ---------------------------------------------------------------
function assignPeerIndex(usedIndexes, isHost, maxPlayers) {
    const cap = (typeof maxPlayers === 'number' && maxPlayers > 0) ? maxPlayers : 4;
    const used = usedIndexes instanceof Set ? usedIndexes : new Set(Array.isArray(usedIndexes) ? usedIndexes : []);
    if (isHost && !used.has(0)) return 0;
    for (let i = 1; i < cap; i++) {
        if (!used.has(i)) return i;
    }
    return -1;
}

function safeWrite(socket, buf) {
    if (!socket || socket.destroyed) return;
    try { socket.write(buf); } catch (_) {}
}

function sendTo(client, obj) {
    if (!client || !client.socket) return;
    let text;
    try { text = JSON.stringify(obj); } catch (_) { return; }
    safeWrite(client.socket, encodeTextFrame(text));
}

function broadcast(room, obj, except) {
    if (!room) return;
    room.clients.forEach((c) => {
        if (c !== except) sendTo(c, obj);
    });
}

function safeClose(socket, code, reason) {
    if (!socket || socket.destroyed) return;
    try {
        const payload = Buffer.alloc(2);
        payload.writeUInt16BE(typeof code === 'number' ? code : 1000, 0);
        safeWrite(socket, encodeWebSocketFrame(0x8, payload, false));
    } catch (_) {}
    try { socket.end(); } catch (_) {}
}

function findClient(room, idx) {
    let found = null;
    if (!room) return null;
    room.clients.forEach((c) => {
        if (c.peerIndex === idx) found = c;
    });
    return found;
}

function countClients(rooms) {
    let n = 0;
    rooms.forEach((room) => { n += room.clients.size; });
    return n;
}

function handleJoin(rooms, client, msg) {
    if (!rooms || !client || !msg) return { ok: false, code: 'BAD_REQUEST' };
    const roomId = sanitizeRoomCode(msg.roomId);
    if (!roomId) return { ok: false, code: 'BAD_ROOM' };
    if (client.roomId) leaveRoom(rooms, client);
    let room = rooms.get(roomId);
    if (!room) {
        if (rooms.size >= MAX_ROOMS) return { ok: false, code: 'SERVER_FULL' };
        room = { id: roomId, clients: new Set(), used: new Set() };
        rooms.set(roomId, room);
    }
    if (room.clients.size >= MAX_PLAYERS) return { ok: false, code: 'ROOM_FULL' };
    const isHost = !!msg.isHost || room.clients.size === 0;
    const idx = assignPeerIndex(room.used, isHost, MAX_PLAYERS);
    if (idx < 0) return { ok: false, code: 'ROOM_FULL' };
    client.roomId = roomId;
    client.peerIndex = idx;
    client.callsign = sanitizeCallsign(msg.callsign) || ('P' + (idx + 1));
    client.isHost = idx === 0;
    room.clients.add(client);
    room.used.add(idx);
    const peers = [];
    room.clients.forEach((c) => {
        peers.push({ idx: c.peerIndex, callsign: c.callsign, isHost: c.isHost });
    });
    sendTo(client, { type: 'WELCOME', roomId: roomId, peerIndex: idx, isHost: client.isHost, peers: peers });
    room.clients.forEach((c) => {
        if (c !== client) {
            sendTo(c, { type: 'PEER_JOIN', roomId: roomId, peerIndex: idx, callsign: client.callsign, isHost: client.isHost });
        }
    });
    return { ok: true, roomId: roomId, peerIndex: idx, isHost: client.isHost, peers: peers };
}

function leaveRoom(rooms, client) {
    if (!client || !client.roomId) return;
    const roomId = client.roomId;
    const peerIndex = client.peerIndex;
    client.roomId = null;
    client.peerIndex = -1;
    const room = rooms.get(roomId);
    if (!room) return;
    room.clients.delete(client);
    if (peerIndex >= 0) room.used.delete(peerIndex);
    broadcast(room, { type: 'PEER_LEAVE', roomId: roomId, peerIndex: peerIndex, callsign: client.callsign }, null);
    if (room.clients.size === 0) rooms.delete(roomId);
}

function removeClient(rooms, client) {
    if (!client || client.removed) return;
    client.removed = true;
    leaveRoom(rooms, client);
}

function routeMessage(rooms, client, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const type = msg.type;
    if (type === 'JOIN') {
        const res = handleJoin(rooms, client, msg);
        if (!res.ok) sendTo(client, { type: 'ERROR', code: res.code, message: res.code });
        return;
    }
    if (!client.roomId) return;
    const room = rooms.get(client.roomId);
    if (!room) return;
    const outbound = Object.assign({}, msg, { roomId: room.id, peerIndex: client.peerIndex, from: client.peerIndex });
    if (type === 'INPUT' || type === 'SNAPSHOT' || type === 'START_GAME' || type === 'PEER_JOIN') {
        broadcast(room, outbound, client);
        return;
    }
    if (type === 'PING' || type === 'PONG') {
        if (typeof outbound.to === 'number') {
            const target = findClient(room, outbound.to);
            if (target) sendTo(target, outbound);
        } else {
            broadcast(room, outbound, client);
        }
        return;
    }
}

function resolvePort(argv, env, fallback) {
    const args = Array.isArray(argv) ? argv : [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a !== 'string') continue;
        if (a === '--port' && args[i + 1]) {
            const n = parseInt(args[i + 1], 10);
            if (n > 0 && n < 65536) return n;
        }
        if (a.startsWith('--port=')) {
            const n = parseInt(a.slice(7), 10);
            if (n > 0 && n < 65536) return n;
        }
    }
    const envPort = env && env.PORT ? parseInt(env.PORT, 10) : NaN;
    if (envPort > 0 && envPort < 65536) return envPort;
    return (typeof fallback === 'number' && fallback > 0) ? fallback : 8080;
}

// ---------------------------------------------------------------
// Server
// ---------------------------------------------------------------
function createRelayServer() {
    const rooms = new Map();

    const server = http.createServer((req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            const body = JSON.stringify({
                service: 'vita-relay',
                status: 'ok',
                rooms: rooms.size,
                players: countClients(rooms),
                maxPlayers: MAX_PLAYERS
            });
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'Content-Length': Buffer.byteLength(body)
            });
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
        }
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
    });

    server.on('upgrade', (req, socket) => {
        socket.on('error', () => {});
        const key = req.headers['sec-websocket-key'];
        const upgrade = String(req.headers['upgrade'] || '').toLowerCase();
        if (upgrade !== 'websocket' || typeof key !== 'string') {
            socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const accept = computeAcceptKey(key);
        if (!accept) {
            socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
        );
        socket.setNoDelay && socket.setNoDelay(true);

        const client = {
            socket: socket,
            roomId: null,
            peerIndex: -1,
            callsign: '',
            isHost: false,
            alive: true,
            removed: false,
            parser: createFrameParser(MAX_MESSAGE_BYTES)
        };

        socket.on('data', (chunk) => {
            client.alive = true;
            onData(rooms, client, chunk);
        });
        socket.on('close', () => removeClient(rooms, client));
        socket.on('end', () => removeClient(rooms, client));
        socket.on('error', () => removeClient(rooms, client));
    });

    const heartbeat = setInterval(() => {
        rooms.forEach((room) => {
            room.clients.forEach((client) => {
                if (client.alive === false) {
                    safeClose(client.socket, 1001, 'heartbeat timeout');
                    removeClient(rooms, client);
                    return;
                }
                client.alive = false;
                safeWrite(client.socket, encodeWebSocketFrame(0x9, Buffer.alloc(0), false));
            });
        });
    }, HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();

    return {
        server: server,
        rooms: rooms,
        close: function close() {
            clearInterval(heartbeat);
            try { server.close(); } catch (_) {}
        }
    };
}

function onData(rooms, client, chunk) {
    let frames;
    try {
        frames = client.parser(chunk);
    } catch (_) {
        frames = [{ error: 'parse' }];
    }
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.error) {
            safeClose(client.socket, 1009, 'message too large');
            removeClient(rooms, client);
            return;
        }
        if (f.opcode === 0x8) {
            removeClient(rooms, client);
            safeClose(client.socket, 1000, 'bye');
            return;
        }
        if (f.opcode === 0xA) {
            client.alive = true;
            continue;
        }
        if (f.opcode === 0x9) {
            safeWrite(client.socket, encodeWebSocketFrame(0xA, f.payload, false));
            continue;
        }
        if (f.opcode !== 0x1) continue;
        if (typeof f.text !== 'string' || f.text.length > MAX_MESSAGE_BYTES) {
            safeClose(client.socket, 1009, 'message too large');
            removeClient(rooms, client);
            return;
        }
        let msg = null;
        try {
            msg = JSON.parse(f.text);
        } catch (_) {
            sendTo(client, { type: 'ERROR', code: 'BAD_JSON', message: 'Invalid JSON payload' });
            continue;
        }
        routeMessage(rooms, client, msg);
    }
}

// ---------------------------------------------------------------
// Bootstrap (hanya saat dijalankan langsung, bukan saat diimpor)
// ---------------------------------------------------------------
function isMainModule() {
    try {
        if (!process.argv[1]) return false;
        return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch (_) {
        return false;
    }
}

if (isMainModule()) {
    const port = resolvePort(process.argv.slice(2), process.env, 8080);
    const app = createRelayServer();
    app.server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error('[vita-relay] Port ' + port + ' sudah dipakai. Jalankan: node tools/relay.mjs --port 8081');
        } else {
            console.error('[vita-relay] Gagal start: ' + (err && err.message ? err.message : err));
        }
        process.exit(1);
    });
    app.server.listen(port, () => {
        console.log('[vita-relay] Co-op relay aktif di ws://localhost:' + port);
        console.log('[vita-relay] Health check:      http://localhost:' + port + '/');
        console.log('[vita-relay] Maks ' + MAX_PLAYERS + ' pemain per kamar. Tekan Ctrl+C untuk berhenti.');
    });
    const shutdown = () => {
        console.log('\n[vita-relay] Menghentikan server...');
        app.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

export {
    MAX_PLAYERS,
    MAX_MESSAGE_BYTES,
    MAX_ROOMS,
    GUID,
    computeAcceptKey,
    decodeWebSocketFrame,
    encodeWebSocketFrame,
    encodeTextFrame,
    createFrameParser,
    sanitizeRoomCode,
    sanitizeCallsign,
    assignPeerIndex,
    handleJoin,
    leaveRoom,
    removeClient,
    routeMessage,
    resolvePort,
    createRelayServer
};
