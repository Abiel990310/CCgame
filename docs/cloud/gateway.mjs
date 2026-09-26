// Stands in for Supabase's API gateway: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST,
// and /realtime/v1/websocket answered here, as Realtime Broadcast on public
// channels (the only part of Realtime the game uses). No dependencies, so the
// WebSocket framing is done by hand.
import crypto from 'node:crypto';
import http from 'node:http';
const routes = { '/auth/v1': 9999, '/rest/v1': 3000 };
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};
// Supabase's free plan refuses larger broadcasts; failing the same way here keeps tests honest.
const MAX_MESSAGE = 256 * 1024;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const prefix = Object.keys(routes).find((p) => req.url.startsWith(p));
  if (!prefix || !req.headers.apikey) { res.writeHead(prefix ? 401 : 404, cors); return res.end('{"message":"no apikey"}'); }
  const up = http.request({ host: '127.0.0.1', port: routes[prefix], path: req.url.slice(prefix.length) || '/', method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...cors });
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(up);
});

/** topic -> Map(client -> join_ref) */
const topics = new Map();

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/realtime/v1/websocket' || !url.searchParams.get('apikey')) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { socket, send: (obj) => sendFrame(socket, 1, Buffer.from(JSON.stringify(obj))) };
  let buffer = Buffer.alloc(0);
  let pieces = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const frame = readFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.length);
      if (frame.opcode === 8) { socket.end(); return; }
      if (frame.opcode === 9) { sendFrame(socket, 10, frame.payload); continue; }
      pieces.push(frame.payload);
      if (!frame.fin) continue;
      const text = Buffer.concat(pieces).toString('utf8');
      pieces = [];
      if (text.length > MAX_MESSAGE) { socket.destroy(); return; }
      handle(client, JSON.parse(text));
    }
  });
  const gone = () => { for (const members of topics.values()) members.delete(client); };
  socket.on('close', gone);
  socket.on('error', gone);
});

function handle(client, m) {
  const reply = (status = 'ok', response = {}) =>
    client.send({ topic: m.topic, event: 'phx_reply', payload: { status, response }, ref: m.ref, join_ref: m.join_ref ?? null });
  if (m.topic === 'phoenix' && m.event === 'heartbeat') return reply();
  if (m.event === 'phx_join') {
    if (m.payload?.config?.private) return reply('error', { reason: 'private channels need a policy' });
    if (!topics.has(m.topic)) topics.set(m.topic, new Map());
    topics.get(m.topic).set(client, m.join_ref);
    return reply('ok', { postgres_changes: [] });
  }
  if (m.event === 'phx_leave') {
    topics.get(m.topic)?.delete(client);
    return reply();
  }
  if (m.event === 'broadcast') {
    const members = topics.get(m.topic);
    if (!members?.has(client)) return;
    for (const [other, joinRef] of members) {
      if (other !== client) other.send({ topic: m.topic, event: 'broadcast', payload: m.payload, ref: null, join_ref: joinRef });
    }
  }
}

function readFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  const maskAt = offset;
  if (masked) offset += 4;
  if (buf.length < offset + len) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskAt + (i % 4)];
  return { fin, opcode, payload, length: offset + len };
}

function sendFrame(socket, opcode, payload) {
  if (socket.destroyed) return;
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
    : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
  socket.write(Buffer.concat([head, payload]));
}

server.listen(54321, '127.0.0.1');
