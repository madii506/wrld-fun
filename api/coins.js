// GET /api/coins                 every coin on wrld (live first), with its rulebook in one line per rule
// GET /api/coins?m=<mint>|id=    one coin: rules with their latest readings, the chest, fees, and the full log
// GET /api/coins?op=log          the latest engine actions across every coin (the tape and the "fired" feed)
// GET /api/coins?op=stats        totals
const L = require('./_lib');
const E = require('./_engine');
const W = require('../assets/js/rules.js');
const S = n => (n == null ? null : +(Number(n) / 1e9).toFixed(4));
const pub = (c, site) => ({ id: c.id, n: c.n, mint: c.mint, name: c.name, symbol: c.symbol, state: c.state, img: site + '/i/' + c.id, mcapUsd: c.mcap_usd, complete: c.complete,
  rules: (c.rules || []).map(r => ({ line: W.line(r), words: W.words(r), act: r.act, src: r.src })), fp: c.fp, fires: c.fires, lastFireAt: c.last_fire_at,
  claimedSol: S(c.claimed), spentSol: S(c.spent), liveAt: c.live_at, createdAt: c.created_at });

module.exports = async (req, res) => {
  const qy = L.query(req);
  if (!L.dbReady()) return L.send(res, 200, { ok: true, offline: true, coins: [], log: [] });
  try {
    await L.ready(); const site = L.origin(req);
    if (qy.op === 'log') {
      const r = await L.q(`SELECT l.kind, l.text, l.sig, l.src, l.sol, l.at, c.symbol, c.mint FROM wr_log l JOIN wr_coins c ON c.id = l.id
        WHERE l.kind IN ('fire','claim','launch','fee','refund') AND c.state IN ('live','refunded','failed') ORDER BY l.n DESC LIMIT 40`);
      return L.send(res, 200, { ok: true, log: r }, L.CACHE(10));
    }
    if (qy.op === 'stats') {
      const r = await L.q(`SELECT count(*) FILTER (WHERE state='live')::int AS live, COALESCE(sum(fires),0)::int AS fires, COALESCE(sum(claimed),0)::bigint AS claimed, COALESCE(sum(spent),0)::bigint AS spent FROM wr_coins`);
      return L.send(res, 200, { ok: true, live: r[0].live, fires: r[0].fires, claimedSol: S(r[0].claimed), spentSol: S(r[0].spent) }, L.CACHE(15));
    }
    const key = String(qy.m || qy.mint || qy.id || '');
    if (key) {
      const r = await L.q(`SELECT * FROM wr_coins WHERE mint=$1 OR id=$1`, [key]);
      if (!r.length) return L.send(res, 200, { ok: false, error: 'No coin with that address on wrld.' });
      const c = r[0];
      const st = await L.q(`SELECT rule, streak, armed, last_read, last_fire, reading FROM wr_state WHERE id=$1 ORDER BY rule`, [c.id]);
      const log = await L.q(`SELECT kind, rule, text, sig, src, sol, at FROM wr_log WHERE id=$1 ORDER BY n DESC LIMIT 60`, [c.id]);
      let chest = null, waiting = null;
      if (c.state === 'live') { [chest, waiting] = await Promise.all([E.chest(c).catch(() => null), E.waiting(c.wallet).catch(() => null)]); }
      return L.send(res, 200, { ok: true, coin: { ...pub(c, site), wallet: c.wallet, launcher: c.launcher, description: c.description, twitter: c.twitter, website: c.website,
        rulesRaw: c.rules, createSig: c.create_sig, metaUri: c.meta_uri, chestSol: S(chest), waitingSol: S(waiting), reserveSol: E.RESERVE / 1e9,
        state_rules: st.map(s => ({ rule: s.rule, streak: s.streak, armed: s.armed, lastRead: s.last_read, lastFire: s.last_fire, reading: s.reading })) }, log }, L.CACHE(8));
    }
    const r = await L.q(`SELECT * FROM wr_coins WHERE state IN ('live','creating') ORDER BY (state='live') DESC, n DESC LIMIT 100`);
    L.send(res, 200, { ok: true, coins: r.map(c => pub(c, site)) }, L.CACHE(15));
  } catch (e) { L.send(res, 200, { ok: false, error: 'The records didn’t answer just now.' }); }
};
