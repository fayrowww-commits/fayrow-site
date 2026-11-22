// Cloudflare Pages Function → отвечает на GET /api/discord
// Токен и ID берутся из Settings → Variables and Secrets (DISCORD_BOT_TOKEN, DISCORD_USER_ID)

let cache = { at: 0, data: null };

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });

export async function onRequestGet({ env }) {
  const token = env.DISCORD_BOT_TOKEN;
  const id = env.DISCORD_USER_ID;
  if (!token || !id) return json({ error: 'not_configured' }, 503, { 'Cache-Control': 'no-store' });

  if (cache.data && Date.now() - cache.at < 30_000) {
    return json(cache.data, 200, { 'Cache-Control': 'public, max-age=20' });
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${id}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const u = await res.json();

    const ext = (h) => (h && h.startsWith('a_') ? 'gif' : 'png');
    const data = {
      id: u.id,
      username: u.username,
      displayName: u.global_name || u.username,
      avatar: u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext(u.avatar)}?size=512`
        : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`,
      banner: u.banner
        ? `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${ext(u.banner)}?size=1024`
        : null,
      bannerColor:
        u.banner_color ||
        (typeof u.accent_color === 'number' ? '#' + u.accent_color.toString(16).padStart(6, '0') : null),
    };

    cache = { at: Date.now(), data };
    return json(data, 200, { 'Cache-Control': 'public, max-age=20' });
  } catch {
    if (cache.data) return json(cache.data, 200, { 'Cache-Control': 'public, max-age=10' });
    return json({ error: 'discord_unavailable' }, 502, { 'Cache-Control': 'no-store' });
  }
}
