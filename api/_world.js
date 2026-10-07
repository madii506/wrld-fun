// The sensors: every reading wrld acts on comes from a public source, and every reading carries the link it came from.
//   price    Coinbase (spot + 5-minute and hourly candles)
//   weather  Open-Meteo (current conditions; its geocoder for city names)
//   sports   ESPN's public scoreboards and team schedules
//   posts    an X account's latest posts (X's embed timeline; the X API when X_BEARER is set)
//   coin     Dexscreener once a pool exists, the pump.fun bonding curve before that
const L = require('./_lib');
const W = require('../assets/js/rules.js');

const now = () => new Date().toISOString();
const r2 = v => Math.round(v * 100) / 100;

// ---------- price ----------
async function price(asset) {
  if (!W.ASSETS.includes(asset)) return { ok: false, error: 'unknown asset' };
  return L.remember('px:' + asset, 25000, async () => {
    const p = asset + '-USD';
    const [spot, c5, c60] = await Promise.all([
      L.getJson(`https://api.coinbase.com/v2/prices/${p}/spot`, {}, 7000),
      L.getJson(`https://api.exchange.coinbase.com/products/${p}/candles?granularity=300`, {}, 7000),
      L.getJson(`https://api.exchange.coinbase.com/products/${p}/candles?granularity=3600`, {}, 7000),
    ]);
    const v = Number(spot.json && spot.json.data && spot.json.data.amount);
    if (!(v > 0)) return { ok: false, asset, error: 'coinbase did not answer', src: `https://api.coinbase.com/v2/prices/${p}/spot` };
    const k5 = Array.isArray(c5.json) ? c5.json : [], k60 = Array.isArray(c60.json) ? c60.json : [];   // newest first: [time, low, high, open, close, volume]
    const ago = (k, n) => (k.length > n ? Number(k[n][4]) : null);
    const h1 = ago(k5, 12), h24 = ago(k60, 24);
    return {
      ok: true, asset, price: v, ch1h: h1 ? r2((v / h1 - 1) * 100) : null, ch24h: h24 ? r2((v / h24 - 1) * 100) : null,
      spark: k60.slice(0, 24).map(k => Number(k[4])).reverse(), src: `https://www.coinbase.com/price/${{ SOL: 'solana', BTC: 'bitcoin', ETH: 'ethereum', XRP: 'xrp', DOGE: 'dogecoin', BONK: 'bonk', WIF: 'dogwifhat' }[asset]}`, at: now(),
    };
  });
}

// ---------- weather ----------
const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm, hail', 99: 'thunderstorm, hail' };
const RAINY = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SNOWY = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
async function weather(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon)) return { ok: false, error: 'bad place' };
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  return L.remember('wx:' + key, 120000, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,is_day&timezone=auto`;
    const r = await L.getJson(url, {}, 8000);
    const c = r.json && r.json.current;
    if (!c) return { ok: false, error: 'open-meteo did not answer', src: url };
    const code = Number(c.weather_code);
    return {
      ok: true, temp: Number(c.temperature_2m), rainMm: Number(c.rain || 0) + Number(c.showers || 0), snowCm: Number(c.snowfall || 0), code, desc: WMO[code] || 'weather',
      raining: Number(c.rain || 0) + Number(c.showers || 0) > 0 || RAINY(code), snowing: Number(c.snowfall || 0) > 0 || SNOWY(code), clear: code <= 1,
      wind: Number(c.wind_speed_10m), day: !!c.is_day, local: c.time, src: `https://open-meteo.com/en/docs?latitude=${lat}&longitude=${lon}`, at: now(),
    };
  });
}
async function geo(q) {
  q = L.clean(q, 60); if (q.length < 2) return [];
  return L.remember('geo:' + q.toLowerCase(), 864e5, async () => {
    const r = await L.getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`, {}, 7000);
    return ((r.json && r.json.results) || []).map(g => ({ name: g.name, country: g.country || '', admin: g.admin1 || '', lat: +Number(g.latitude).toFixed(3), lon: +Number(g.longitude).toFixed(3) }));
  });
}

// ---------- sports (ESPN) ----------
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const league = id => W.LEAGUES.find(l => l.id === id);
async function teams(id) {
  const lg = league(id); if (!lg) return [];
  return L.remember('teams:' + id, 864e5, async () => {
    const r = await L.getJson(`${ESPN}/${lg.sport}/${lg.id}/teams`, {}, 8000);
    const list = (((r.json && r.json.sports) || [])[0] || {}).leagues;
    return (((list || [])[0] || {}).teams || []).map(t => t.team).filter(Boolean)
      .map(t => ({ id: String(t.id), name: t.displayName || t.name, abbr: t.abbreviation || '', logo: ((t.logos || [])[0] || {}).href || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
const score = c => { const s = c && c.score; return s == null ? '' : typeof s === 'object' ? String(s.displayValue != null ? s.displayValue : s.value) : String(s); };
function gameOf(ev, teamId) {
  const comp = (ev.competitions || [])[0] || {}; const st = (comp.status || ev.status || {}).type || {};
  const cs = comp.competitors || []; const me = cs.find(c => String((c.team || {}).id) === String(teamId)); const them = cs.find(c => c !== me);
  if (!me || !them) return null;
  const won = me.winner === true, lost = them.winner === true;
  return { id: String(ev.id), date: ev.date, name: ev.shortName || ev.name, completed: !!st.completed, state: st.state || '', detail: st.shortDetail || st.detail || '',
    won, lost, draw: !!st.completed && !won && !lost, me: (me.team || {}).displayName, them: (them.team || {}).displayName, score: `${score(me)}–${score(them)}`,
    link: ((ev.links || []).find(l => /gamecast|summary|boxscore/i.test((l.rel || []).join(' '))) || (ev.links || [])[0] || {}).href || null };
}
async function lastGame(id, teamId) {
  const lg = league(id); if (!lg || !/^\d{1,8}$/.test(String(teamId))) return { ok: false, error: 'bad team' };
  return L.remember('game:' + id + ':' + teamId, 120000, async () => {
    const url = `${ESPN}/${lg.sport}/${lg.id}/teams/${teamId}/schedule`;
    const r = await L.getJson(url, {}, 8000);
    const evs = ((r.json && r.json.events) || []).map(e => gameOf(e, teamId)).filter(Boolean);
    if (!r.json) return { ok: false, error: 'espn did not answer', src: url };
    const done = evs.filter(g => g.completed).sort((a, b) => new Date(b.date) - new Date(a.date));
    const next = evs.filter(g => !g.completed).sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;
    const team = (r.json.team && (r.json.team.displayName || r.json.team.name)) || '';
    return { ok: true, team, last: done[0] || null, next, src: `https://www.espn.com/${lg.sport === 'soccer' ? 'soccer' : lg.id}/team/_/id/${teamId}`, at: now() };
  });
}
async function scoreboard(id) {
  const lg = league(id); if (!lg) return [];
  return L.remember('sb:' + id, 90000, async () => {
    const r = await L.getJson(`${ESPN}/${lg.sport}/${lg.id}/scoreboard`, {}, 8000);
    return ((r.json && r.json.events) || []).map(ev => {
      const comp = (ev.competitions || [])[0] || {}; const st = (comp.status || {}).type || {}; const cs = comp.competitors || [];
      const h = cs.find(c => c.homeAway === 'home') || cs[0], a = cs.find(c => c !== h);
      if (!h || !a) return null;
      return { league: lg.name, id: String(ev.id), date: ev.date, state: st.state, detail: st.shortDetail || '', home: (h.team || {}).shortDisplayName || (h.team || {}).displayName,
        away: (a.team || {}).shortDisplayName || (a.team || {}).displayName, hs: score(h), as: score(a), hw: h.winner === true, aw: a.winner === true };
    }).filter(Boolean);
  });
}

// ---------- posts on X ----------
const XB = (process.env.X_BEARER || '').trim();
async function posts(handle) {
  handle = String(handle || '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { ok: false, error: 'bad handle' };
  return L.remember('x:' + handle.toLowerCase(), 90000, async () => {
    const src = 'https://x.com/' + handle;
    // 1) the embed timeline X serves to every site that embeds a profile
    try {
      const r = await L.getJson(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}?showReplies=false`, { headers: { accept: 'text/html' } }, 8000);
      const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(r.text || '');
      if (m) {
        const d = JSON.parse(m[1]); const es = (((d.props || {}).pageProps || {}).timeline || {}).entries || [];
        const list = es.map(e => e.content && e.content.tweet).filter(Boolean).map(t => ({ id: String(t.id_str || t.id), text: String(t.full_text || t.text || ''), at: t.created_at ? new Date(t.created_at).toISOString() : null }))
          .filter(t => /^\d+$/.test(t.id)).sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
        if (list.length) return { ok: true, handle, posts: list.slice(0, 8), via: 'embed', src, at: now() };
      }
    } catch {}
    // 2) the X API, when the house has a key
    if (XB) {
      try {
        const u = await L.getJson(`https://api.x.com/2/users/by/username/${handle}`, { headers: { authorization: 'Bearer ' + XB } }, 8000);
        const uid = u.json && u.json.data && u.json.data.id;
        if (uid) {
          const t = await L.getJson(`https://api.x.com/2/users/${uid}/tweets?max_results=5&tweet.fields=created_at&exclude=replies`, { headers: { authorization: 'Bearer ' + XB } }, 8000);
          const list = ((t.json && t.json.data) || []).map(x => ({ id: String(x.id), text: String(x.text || ''), at: x.created_at || null }));
          return { ok: true, handle, posts: list, via: 'api', src, at: now() };
        }
      } catch {}
    }
    return { ok: false, handle, error: 'X did not share this account’s posts just now', src };
  });
}

// ---------- world events: Polymarket's public odds (war, politics, money, sports, crypto, tech) ----------
const GAMMA = 'https://gamma-api.polymarket.com';
const parseArr = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
function mkt(m, ev) {
  const outs = parseArr(m.outcomes), px = parseArr(m.outcomePrices).map(Number);
  const yi = outs.findIndex(o => /^yes$/i.test(o)); if (yi < 0 || !isFinite(px[yi])) return null;
  const slug = (ev && ev.slug) || ((m.events || [])[0] || {}).slug || m.slug || '';
  const yes = px[yi], closed = !!m.closed;
  return { id: String(m.id), q: String(m.question || ''), slug, yes: Math.round(yes * 1000) / 10, closed, resolved: closed && (yes >= .99 || yes <= .01) ? (yes >= .99 ? 'YES' : 'NO') : null,
    end: m.endDate || null, vol: Number(m.volume24hr || m.volume || 0), src: 'https://polymarket.com/event/' + slug };
}
async function markets(cat) {
  const c = W.CATS.find(x => x.id === cat); if (!c) return { ok: false, error: 'unknown kind' };
  return L.remember('pm:' + cat, 120000, async () => {
    const r = await L.getJson(`${GAMMA}/events?tag_slug=${c.tag}&active=true&closed=false&order=volume24hr&ascending=false&limit=20`, {}, 9000);
    const evs = Array.isArray(r.json) ? r.json : [];
    const list = [];
    for (const ev of evs) for (const m of (ev.markets || [])) { if (m.closed || m.active === false) continue; const x = mkt(m, ev); if (x && x.q) list.push(x); }
    list.sort((a, b) => b.vol - a.vol);
    if (!list.length) return { ok: false, error: 'polymarket did not answer', src: 'https://polymarket.com' };
    return { ok: true, cat, markets: list.slice(0, 14), src: 'https://polymarket.com/' + c.tag, at: now() };
  });
}
async function market(id) {
  if (!/^\d{1,12}$/.test(String(id))) return { ok: false };
  return L.remember('pmm:' + id, 60000, async () => {
    const r = await L.getJson(`${GAMMA}/markets/${id}`, {}, 8000);
    const m = r.json && !Array.isArray(r.json) ? r.json : Array.isArray(r.json) ? r.json[0] : null;
    const x = m ? mkt(m) : null;
    return x ? { ok: true, ...x, at: now() } : { ok: false, error: 'polymarket did not answer', src: 'https://polymarket.com' };
  });
}

// ---------- the coin itself ----------
async function coinMarket(mint) {
  if (!L.isAddr(mint)) return { ok: false };
  return L.remember('cm:' + mint, 60000, async () => {
    try {
      const r = await L.getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {}, 7000);
      const ps = ((r.json && r.json.pairs) || []).filter(p => p.chainId === 'solana').sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
      if (ps.length) { const p = ps[0]; return { ok: true, mcapUsd: Number(p.marketCap || p.fdv || 0) || null, priceUsd: Number(p.priceUsd) || null, complete: p.dexId !== 'pumpfun', ch1h: (p.priceChange || {}).h1 ?? null, src: p.url, at: now() }; }
    } catch {}
    try {
      const [bc] = await L.accounts([L.bondingCurveOf(mint)]);
      if (bc && bc.data.length >= 49) {
        const vTok = Number(bc.data.readBigUInt64LE(8)), vSol = Number(bc.data.readBigUInt64LE(16)), supply = Number(bc.data.readBigUInt64LE(40)), complete = bc.data[48] === 1;
        const sp = await price('SOL'); const solUsd = sp.ok ? sp.price : null;
        const mcapSol = vTok ? (vSol / 1e9) * (supply / vTok) : null;
        return { ok: true, mcapUsd: mcapSol && solUsd ? mcapSol * solUsd : null, mcapSol, complete, src: 'https://pump.fun/coin/' + mint, at: now() };
      }
    } catch {}
    return { ok: false, error: 'no market yet', src: 'https://pump.fun/coin/' + mint };
  });
}

// ---------- reading a rule against the world, right now ----------
// returns { ok, now, key, text, src }  ok=false means the source could not be read (the rule waits; it never guesses)
async function evaluate(r, ctx = {}) {
  try {
    if (r.src === 'price') {
      const p = await price(r.asset); if (!p.ok) return { ok: false, text: `${r.asset}: price source offline`, src: p.src };
      const fmt = W.usd(p.price);
      if (r.op === 'above') return { ok: true, now: p.price > r.value, text: `${r.asset} ${fmt} (coinbase)`, src: p.src };
      if (r.op === 'below') return { ok: true, now: p.price < r.value, text: `${r.asset} ${fmt} (coinbase)`, src: p.src };
      const ch = r.win === '24h' ? p.ch24h : p.ch1h; if (ch == null) return { ok: false, text: `${r.asset}: no candles`, src: p.src };
      return { ok: true, now: r.op === 'up' ? ch >= r.value : ch <= -r.value, text: `${r.asset} ${ch > 0 ? '+' : ''}${ch}% in ${r.win} (now ${fmt})`, src: p.src };
    }
    if (r.src === 'events') {
      const m = await market(r.market.id); if (!m.ok) return { ok: false, text: 'event odds offline', src: m.src };
      const base = `“${m.q.slice(0, 80)}” · YES ${m.yes}%${m.resolved ? ' · resolved ' + m.resolved : ''}`;
      if (r.op === 'above') return { ok: true, now: !m.closed && m.yes > r.value, text: base, src: m.src };
      if (r.op === 'below') return { ok: true, now: !m.closed && m.yes < r.value, text: base, src: m.src };
      const hit = m.resolved === (r.op === 'yes' ? 'YES' : 'NO');
      return { ok: true, now: hit, key: hit ? 'r' + m.id : null, text: base, src: m.src };
    }
    if (r.src === 'weather') {
      const w = await weather(r.city.lat, r.city.lon); if (!w.ok) return { ok: false, text: `${r.city.name}: weather source offline`, src: w.src };
      const base = `${r.city.name}: ${w.temp}°C, ${w.desc}, wind ${w.wind} km/h`;
      const v = { rain: w.raining, snow: w.snowing, clear: w.clear, hot: w.temp > r.value, cold: w.temp < r.value, wind: w.wind > r.value }[r.op];
      return { ok: true, now: !!v, text: base, src: w.src };
    }
    if (r.src === 'sports') {
      const g = await lastGame(r.league, r.team.id); if (!g.ok) return { ok: false, text: `${r.team.name}: scores offline`, src: g.src };
      const last = g.last;
      if (!last) return { ok: true, now: false, key: null, text: `${r.team.name}: no finished game yet${g.next ? ' · next ' + g.next.name : ''}`, src: g.src };
      const hit = r.op === 'wins' ? last.won : last.lost;
      const after = !ctx.since || new Date(last.date) > new Date(ctx.since);
      const res = last.won ? 'won' : last.lost ? 'lost' : 'drew';
      return { ok: true, now: hit && after, key: hit ? 'g' + last.id : null, text: `${last.me} ${res} ${last.score} vs ${last.them} (${new Date(last.date).toISOString().slice(0, 10)})`, src: last.link || g.src };
    }
    if (r.src === 'posts') {
      const x = await posts(r.handle); if (!x.ok) return { ok: false, text: `@${r.handle}: ${x.error}`, src: x.src };
      const fresh = x.posts.filter(t => !ctx.since || !t.at || new Date(t.at) > new Date(ctx.since));
      const hit = fresh.find(t => !r.word || t.text.toLowerCase().includes(r.word));
      const top = x.posts[0];
      return { ok: true, now: !!hit, key: hit ? 'x' + hit.id : null, text: hit ? `@${r.handle}: “${hit.text.slice(0, 90)}”` : top ? `@${r.handle} last: “${top.text.slice(0, 80)}”` : `@${r.handle}: no posts`,
        src: hit ? `https://x.com/${r.handle}/status/${hit.id}` : x.src };
    }
    if (r.src === 'coin') {
      if (!ctx.mint) return { ok: true, now: false, text: 'reads the coin’s own market once it is live', src: null };
      const m = await coinMarket(ctx.mint); if (!m.ok) return { ok: false, text: 'market offline', src: m.src };
      if (r.op === 'grad') return { ok: true, now: !!m.complete, text: m.complete ? 'graduated' : 'on the bonding curve', src: m.src };
      return { ok: true, now: (m.mcapUsd || 0) >= r.value, text: `market cap ${m.mcapUsd ? W.usd(m.mcapUsd) : '—'}`, src: m.src };
    }
    if (r.src === 'time') {
      const from = ctx.since ? new Date(ctx.since).getTime() : Date.now();
      const n = Math.floor((Date.now() - from) / (r.every * 36e5));
      return { ok: true, now: n >= 1, key: n >= 1 ? 't' + n : null, text: n >= 1 ? `period ${n} since launch` : `first one ${Math.max(1, Math.round((from + r.every * 36e5 - Date.now()) / 6e4))} min after launch`, src: null };
    }
  } catch (e) { return { ok: false, text: 'source error: ' + String(e && e.message).slice(0, 80) }; }
  return { ok: false, text: 'unknown rule' };
}

// ---------- the live board on the home page ----------
const CITIES = [{ name: 'London', lat: 51.509, lon: -0.126 }, { name: 'New York', lat: 40.713, lon: -74.006 }, { name: 'Tokyo', lat: 35.69, lon: 139.692 }, { name: 'Dubai', lat: 25.077, lon: 55.309 }];
async function board() {
  return L.remember('board', 25000, async () => {
    const [px, wx, sb, ev] = await Promise.all([
      Promise.all(['SOL', 'BTC', 'ETH'].map(a => price(a).catch(() => ({ ok: false, asset: a })))),
      Promise.all(CITIES.map(c => weather(c.lat, c.lon).then(w => ({ ...w, city: c.name })).catch(() => ({ ok: false, city: c.name })))),
      Promise.all(['eng.1', 'nba', 'nfl', 'uefa.champions'].map(id => scoreboard(id).catch(() => []))),
      Promise.all(['war', 'politics', 'money'].map(c => markets(c).catch(() => ({ ok: false, cat: c })))),
    ]);
    const games = sb.flat().sort((a, b) => (b.state === 'in') - (a.state === 'in') || Math.abs(new Date(a.date) - Date.now()) - Math.abs(new Date(b.date) - Date.now())).slice(0, 6);
    const events = ev.map((e, i) => e.ok ? { cat: e.cat, ...e.markets[0] } : { cat: ['war', 'politics', 'money'][i], ok: false });
    return { prices: px, weather: wx, games, events, at: now() };
  });
}

module.exports = { price, weather, geo, teams, lastGame, scoreboard, posts, markets, market, coinMarket, evaluate, board, WMO };
