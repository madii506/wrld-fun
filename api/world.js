// GET  /api/world                      the live board: prices, weather in four cities, the latest games
// GET  /api/world?op=geo&q=            find a city            ?op=teams&league=    a league's teams
// GET  /api/world?op=game&league=&team= a team's last result  ?op=posts&h=          an X account's latest posts
// GET  /api/world?op=price&a=SOL       one price              ?op=weather&lat=&lon= one place
// GET  /api/world?op=probe             every source, timed (the docs page's "try" table)
// POST /api/world?op=eval {rules}      read a rulebook against the world right now
const L = require('./_lib');
const WD = require('./_world');
const W = require('../assets/js/rules.js');

async function evalBook(req, res) {
  if (L.limited('eval:' + L.ip(req), 60, 60000)) return L.send(res, 200, { ok: false, error: 'Slow down a little.' });
  const b = await L.body(req, 32 * 1024);
  const list = Array.isArray(b.rules) ? b.rules.slice(0, W.MAX_RULES) : [];
  const out = await Promise.all(list.map(async raw => {
    let r; try { r = W.normalize(raw); } catch (e) { return { ok: false, invalid: true, text: e.message }; }
    const ev = await WD.evaluate(r, {});
    return { ...ev, line: W.line(r), words: W.words(r), event: W.isEvent(r) };
  }));
  L.send(res, 200, { ok: true, results: out, at: new Date().toISOString() });
}
async function probe(res) {
  const t = async (name, fn) => { const t0 = Date.now(); try { const v = await fn(); return { name, ok: !!(v && v.ok !== false), ms: Date.now() - t0, sample: v && v.sample }; } catch (e) { return { name, ok: false, ms: Date.now() - t0 }; } };
  const rows = await Promise.all([
    t('price · coinbase', async () => { const p = await WD.price('SOL'); return { ok: p.ok, sample: p.ok ? 'SOL ' + W.usd(p.price) : null }; }),
    t('weather · open-meteo', async () => { const w = await WD.weather(51.509, -0.126); return { ok: w.ok, sample: w.ok ? `London ${w.temp}°C ${w.desc}` : null }; }),
    t('sports · espn', async () => { const g = await WD.lastGame('eng.1', '359'); return { ok: g.ok, sample: g.ok && g.last ? `${g.last.me} ${g.last.score} ${g.last.them}` : null }; }),
    t('events · polymarket', async () => { const m = await WD.markets('politics'); return { ok: m.ok, sample: m.ok ? m.markets[0].q.slice(0, 40) + ' · YES ' + m.markets[0].yes + '%' : null }; }),
    t('posts · x', async () => { const x = await WD.posts('solana'); return { ok: x.ok, sample: x.ok && x.posts[0] ? '@solana: ' + x.posts[0].text.slice(0, 40) : null }; }),
    t('chain · solana rpc', async () => { const s = await L.rpc('getSlot', [{ commitment: 'confirmed' }]); return { ok: s > 0, sample: 'slot ' + s }; }),
  ]);
  L.send(res, 200, { ok: true, rows, at: new Date().toISOString() }, L.CACHE(20));
}
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  const qy = L.query(req); const op = String(qy.op || '');
  try {
    if (req.method === 'POST' && op === 'eval') return evalBook(req, res);
    if (op === 'geo') return L.send(res, 200, { ok: true, results: await WD.geo(qy.q) }, L.CACHE(3600));
    if (op === 'leagues') return L.send(res, 200, { ok: true, leagues: W.LEAGUES }, L.CACHE(86400));
    if (op === 'teams') return L.send(res, 200, { ok: true, teams: await WD.teams(String(qy.league || '')) }, L.CACHE(21600));
    if (op === 'game') return L.send(res, 200, await WD.lastGame(String(qy.league || ''), String(qy.team || '')), L.CACHE(60));
    if (op === 'markets') return L.send(res, 200, await WD.markets(String(qy.cat || '')), L.CACHE(90));
    if (op === 'market') return L.send(res, 200, await WD.market(String(qy.id || '')), L.CACHE(45));
    if (op === 'posts') return L.send(res, 200, await WD.posts(String(qy.h || '')), L.CACHE(60));
    if (op === 'price') return L.send(res, 200, await WD.price(String(qy.a || '').toUpperCase()), L.CACHE(20));
    if (op === 'weather') return L.send(res, 200, await WD.weather(qy.lat, qy.lon), L.CACHE(120));
    if (op === 'probe') return probe(res);
    return L.send(res, 200, { ok: true, ...(await WD.board()) }, L.CACHE(20));
  } catch (e) { L.send(res, 200, { ok: false, error: 'The world didn’t answer just now.' }); }
};
