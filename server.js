// FAYROW site server — zero dependencies, Node 18+
// Serves /public and exposes GET /api/discord (live avatar + banner via Discord API)

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- tiny .env loader (no dotenv needed) ----
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — fine */ }

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const USER_ID = process.env.DISCORD_USER_ID;
const CACHE_MS = 30_000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

// ---- Discord profile (cached) ----
let cache = { at: 0, data: null };
let inflight = null;

async function fetchProfile() {
  const res = await fetch(`https://discord.com/api/v10/users/${USER_ID}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}`);
  const u = await res.json();

  const ext = (hash) => (hash && hash.startsWith('a_') ? 'gif' : 'png');
  const avatar = u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext(u.avatar)}?size=512`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
  const banner = u.banner
    ? `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${ext(u.banner)}?size=1024`
    : null;

  let bannerColor = u.banner_color || null;
  if (!bannerColor && typeof u.accent_color === 'number') {
    bannerColor = '#' + u.accent_color.toString(16).padStart(6, '0');
  }

  return {
    id: u.id,
    username: u.username,
    displayName: u.global_name || u.username,
    avatar,
    banner,
    bannerColor,
  };
}

async function getProfile() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = fetchProfile()
      .then((d) => { cache = { at: Date.now(), data: d }; return d; })
      .finally(() => { inflight = null; });
  }
  try {
    return await inflight;
  } catch (e) {
    if (cache.data) return cache.data; // serve stale on error
    throw e;
  }
}

// ---- HTTP ----
function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/discord') {
      if (!TOKEN || !USER_ID) {
        return send(res, 503, JSON.stringify({ error: 'not_configured' }), {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
      }
      try {
        const data = await getProfile();
        return send(res, 200, JSON.stringify(data), {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=20',
        });
      } catch (e) {
        console.error('[discord]', e.message);
        return send(res, 502, JSON.stringify({ error: 'discord_unavailable' }), {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');

    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      const ext = path.extname(file).toLowerCase();
      send(res, 200, req.method === 'HEAD' ? undefined : buf, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
    });
  } catch (e) {
    console.error(e);
    send(res, 500, 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`FAYROW site → http://localhost:${PORT}`);
  if (!TOKEN || !USER_ID) {
    console.log('! DISCORD_BOT_TOKEN / DISCORD_USER_ID not set — fill .env to enable live avatar & banner');
  }
});
