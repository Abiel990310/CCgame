// Stands in for Supabase's API gateway: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST.
import http from 'node:http';
const routes = { '/auth/v1': 9999, '/rest/v1': 3000 };
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const prefix = Object.keys(routes).find((p) => req.url.startsWith(p));
  if (!prefix || !req.headers.apikey) { res.writeHead(prefix ? 401 : 404, cors); return res.end('{"message":"no apikey"}'); }
  const up = http.request({ host: '127.0.0.1', port: routes[prefix], path: req.url.slice(prefix.length) || '/', method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...cors });
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(up);
}).listen(54321, '127.0.0.1');
