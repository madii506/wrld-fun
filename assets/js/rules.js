/* wrld rulebooks: one shape, shared by the browser and the engine.
   A rule is   when <the world does something>  ->  <the coin does something>   with a cooldown.
   Nothing here talks to the network; the readers live in api/_world.js. */
(function (root, make) { const W = make(); if (typeof module === 'object' && module.exports) module.exports = W; else root.WR = W; })(this, function () {
  const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'DOGE', 'BONK', 'WIF'];
  const LEAGUES = [
    { id: 'eng.1', sport: 'soccer', name: 'Premier League' }, { id: 'esp.1', sport: 'soccer', name: 'La Liga' },
    { id: 'ita.1', sport: 'soccer', name: 'Serie A' }, { id: 'ger.1', sport: 'soccer', name: 'Bundesliga' },
    { id: 'fra.1', sport: 'soccer', name: 'Ligue 1' }, { id: 'uefa.champions', sport: 'soccer', name: 'Champions League' },
    { id: 'usa.1', sport: 'soccer', name: 'MLS' }, { id: 'nba', sport: 'basketball', name: 'NBA' },
    { id: 'nfl', sport: 'football', name: 'NFL' }, { id: 'mlb', sport: 'baseball', name: 'MLB' }, { id: 'nhl', sport: 'hockey', name: 'NHL' },
  ];
  const CATS = [{ id: 'war', name: 'war', tag: 'geopolitics' }, { id: 'politics', name: 'politics', tag: 'politics' }, { id: 'money', name: 'money', tag: 'economy' },
    { id: 'sports', name: 'sports', tag: 'sports' }, { id: 'crypto', name: 'crypto', tag: 'crypto' }, { id: 'tech', name: 'tech', tag: 'tech' }];
  const SRC = {
    events: { label: 'world events', ops: { above: 'odds rise above', below: 'odds fall below', yes: 'resolves YES', no: 'resolves NO' } },
    price: { label: 'price', ops: { above: 'goes above', below: 'goes below', up: 'pumps', down: 'dumps' } },
    weather: { label: 'weather', ops: { rain: 'it rains', snow: 'it snows', hot: 'it gets hotter than', cold: 'it gets colder than', wind: 'wind is stronger than', clear: 'the sky is clear' } },
    sports: { label: 'sports', ops: { wins: 'wins a game', loses: 'loses a game' } },
    posts: { label: 'x posts', ops: { says: 'posts' } },
    coin: { label: 'the coin', ops: { mcap: 'market cap reaches', grad: 'graduates' } },
    time: { label: 'time', ops: { every: 'every' } },
  };
  const ACTS = {
    burn: { label: 'buy back & burn', fn: 'buyback_burn', cls: 'burn' },
    airdrop: { label: 'buy back & airdrop holders', fn: 'airdrop_holders', cls: 'air' },
    holders: { label: 'pay holders in SOL', fn: 'pay_holders', cls: 'hold' },
    creator: { label: 'pay the creator', fn: 'pay_creator', cls: 'crea' },
  };
  const MAX_RULES = 6;
  const num = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); if (!isFinite(n)) return null; return Math.min(hi, Math.max(lo, n)); };
  const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  function fail(m) { const e = new Error(m); e.rule = true; throw e; }

  // the one canonical shape: unknown fields are dropped, numbers are clamped, names are trimmed
  function normalize(r) {
    if (!r || typeof r !== 'object') fail('A rule is empty.');
    const src = String(r.src || ''); if (!SRC[src]) fail('Pick what the rule watches.');
    const op = String(r.op || ''); if (!SRC[src].ops[op]) fail('Pick a condition for the ' + SRC[src].label + ' rule.');
    const act = String(r.act || ''); if (!ACTS[act]) fail('Pick what the coin does.');
    const out = { src, op };
    if (src === 'price') {
      out.asset = ASSETS.includes(String(r.asset).toUpperCase()) ? String(r.asset).toUpperCase() : fail('Pick a coin to watch.');
      if (op === 'up' || op === 'down') { out.value = num(r.value, 0.5, 90); out.win = r.win === '24h' ? '24h' : '1h'; }
      else out.value = num(r.value, 0.00000001, 1e9);
      if (out.value == null) fail('Give the price rule a number.');
      out.value = +(+out.value).toPrecision(8);
    } else if (src === 'events') {
      out.cat = CATS.find(c => c.id === r.cat) ? r.cat : fail('Pick a kind of event.');
      const m = r.market || {}; if (!/^\d{1,12}$/.test(String(m.id || '')) || !s(m.q, 160)) fail('Pick an event to watch.');
      out.market = { id: String(m.id), q: s(m.q, 160), slug: s(m.slug, 120).replace(/[^a-z0-9-]/gi, '') };
      if (op === 'above' || op === 'below') { out.value = num(r.value, 1, 99); if (out.value == null) fail('Give the odds in %.'); out.value = Math.round(out.value); }
    } else if (src === 'weather') {
      const c = r.city || {}; const lat = num(c.lat, -90, 90), lon = num(c.lon, -180, 180);
      if (lat == null || lon == null || !s(c.name, 60)) fail('Pick a city for the weather rule.');
      out.city = { name: s(c.name, 60), country: s(c.country, 40), lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
      if (op === 'hot' || op === 'cold') { out.value = num(r.value, -60, 60); if (out.value == null) fail('Give the temperature in °C.'); out.value = Math.round(out.value * 10) / 10; }
      if (op === 'wind') { out.value = num(r.value, 5, 250); if (out.value == null) fail('Give the wind speed in km/h.'); out.value = Math.round(out.value); }
    } else if (src === 'sports') {
      const lg = LEAGUES.find(l => l.id === r.league); if (!lg) fail('Pick a league.');
      const t = r.team || {}; if (!/^\d{1,8}$/.test(String(t.id || '')) || !s(t.name, 60)) fail('Pick a team.');
      out.league = lg.id; out.team = { id: String(t.id), name: s(t.name, 60) };
    } else if (src === 'posts') {
      const h = String(r.handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').replace(/[/?].*$/, '');
      if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) fail('Give an X handle to watch.');
      out.handle = h; out.word = s(r.word, 40).toLowerCase();
    } else if (src === 'coin') {
      if (op === 'mcap') { out.value = num(r.value, 1000, 1e11); if (out.value == null) fail('Give a market cap in USD.'); out.value = Math.round(out.value); }
    } else if (src === 'time') {
      out.every = num(r.every, 1, 168); if (out.every == null) fail('Give the interval in hours.'); out.every = Math.round(out.every);
    }
    out.act = act; out.pct = Math.round(num(r.pct, 1, 100) || 10);
    out.cool = Math.round(num(r.cool, 1, 168) || 6);
    return out;
  }
  function normalizeBook(list) {
    if (!Array.isArray(list) || !list.length) fail('Add at least one rule.');
    if (list.length > MAX_RULES) fail('Up to ' + MAX_RULES + ' rules.');
    return list.map(normalize);
  }
  const usd = v => '$' + (v >= 1 ? Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 }) : Number(v).toPrecision(3));
  const lg = id => (LEAGUES.find(l => l.id === id) || { name: id }).name;
  // the readable line, in the rulebook's own little language
  function cond(r) {
    switch (r.src) {
      case 'price': return r.op === 'above' ? `price("${r.asset}") > ${usd(r.value)}` : r.op === 'below' ? `price("${r.asset}") < ${usd(r.value)}`
        : `price("${r.asset}").change(${r.win}) ${r.op === 'up' ? '>= +' : '<= -'}${r.value}%`;
      case 'events': { const q = r.market.q.length > 60 ? r.market.q.slice(0, 57) + '…' : r.market.q; return r.op === 'above' ? `odds("${q}").yes > ${r.value}%` : r.op === 'below' ? `odds("${q}").yes < ${r.value}%` : `event("${q}").resolves(${r.op === 'yes' ? 'YES' : 'NO'})`; }
      case 'weather': { const c = `weather("${r.city.name}")`; return r.op === 'rain' ? c + '.raining' : r.op === 'snow' ? c + '.snowing' : r.op === 'clear' ? c + '.clear'
        : r.op === 'hot' ? `${c}.temp > ${r.value}°C` : r.op === 'cold' ? `${c}.temp < ${r.value}°C` : `${c}.wind > ${r.value}km/h`; }
      case 'sports': return `sports("${lg(r.league)}", "${r.team.name}").${r.op}`;
      case 'posts': return `x("@${r.handle}").posts(${r.word ? '"' + r.word + '"' : ''})`;
      case 'coin': return r.op === 'mcap' ? `coin.mcap >= ${usd(r.value)}` : 'coin.graduates';
      case 'time': return `every(${r.every}h)`;
    }
    return '?';
  }
  const action = r => `${ACTS[r.act].fn}(${r.pct}% chest)`;
  const line = r => `when ${cond(r)} -> ${action(r)}`;
  // plain words, for people who don't read code
  function words(r) {
    let w;
    switch (r.src) {
      case 'price': w = r.op === 'above' ? `${r.asset} goes above ${usd(r.value)}` : r.op === 'below' ? `${r.asset} drops below ${usd(r.value)}`
        : `${r.asset} ${r.op === 'up' ? 'pumps' : 'dumps'} ${r.value}% within ${r.win === '1h' ? 'an hour' : 'a day'}`; break;
      case 'events': w = r.op === 'above' ? `the odds of “${r.market.q}” rise above ${r.value}%` : r.op === 'below' ? `the odds of “${r.market.q}” fall below ${r.value}%` : `“${r.market.q}” resolves ${r.op === 'yes' ? 'YES' : 'NO'}`; break;
      case 'weather': w = r.op === 'rain' ? `it rains in ${r.city.name}` : r.op === 'snow' ? `it snows in ${r.city.name}` : r.op === 'clear' ? `the sky is clear over ${r.city.name}`
        : r.op === 'hot' ? `${r.city.name} gets hotter than ${r.value}°C` : r.op === 'cold' ? `${r.city.name} gets colder than ${r.value}°C` : `wind in ${r.city.name} passes ${r.value} km/h`; break;
      case 'sports': w = `${r.team.name} ${r.op === 'wins' ? 'win' : 'lose'} a ${lg(r.league)} game`; break;
      case 'posts': w = `@${r.handle} posts${r.word ? ' "' + r.word + '"' : ' anything'}`; break;
      case 'coin': w = r.op === 'mcap' ? `the coin reaches ${usd(r.value)} market cap` : 'the coin graduates from pump.fun'; break;
      case 'time': w = `every ${r.every} hours`; break;
    }
    const a = { burn: 'buy back and burn', airdrop: 'buy back and airdrop the top holders', holders: 'pay the top holders', creator: 'pay the creator' }[r.act];
    return r.src === 'time' ? `Every ${r.every} hours, ${a} with ${r.pct}% of the chest.` : `When ${w}, ${a} with ${r.pct}% of the chest.`;
  }
  // a rule that watches a level fires when the level is reached, then re-arms once it isn't; an event fires once per event
  const isEvent = r => r.src === 'sports' || r.src === 'posts' || r.src === 'time' || (r.src === 'events' && (r.op === 'yes' || r.op === 'no'));
  function book(rules, meta) {
    const head = meta ? [`# ${meta.name} ($${meta.symbol})`, `# rulebook ${meta.fp || ''}`.trim()] : [];
    return head.concat(rules.map((r, i) => `${String(i + 1).padStart(2, '0')}  ${line(r)}  # max once per ${r.cool}h`)).join('\n');
  }
  // the fingerprint: sha-256 over the canonical JSON (keys in a fixed order)
  function canon(rules) {
    const order = ['src', 'op', 'cat', 'market', 'q', 'slug', 'asset', 'value', 'win', 'city', 'name', 'country', 'lat', 'lon', 'league', 'team', 'id', 'handle', 'word', 'every', 'act', 'pct', 'cool'];
    const sortv = v => Array.isArray(v) ? v.map(sortv) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(k => [k, sortv(v[k])])) : v;
    return JSON.stringify({ v: 1, rules: sortv(rules) });
  }
  const TEMPLATES = [
    { id: 'dip', name: 'Dip Shield', blurb: 'When the market bleeds, the coin buys itself.', rules: [
      { src: 'price', asset: 'BTC', op: 'down', value: 5, win: '1h', act: 'burn', pct: 25, cool: 6 },
      { src: 'price', asset: 'SOL', op: 'down', value: 8, win: '24h', act: 'burn', pct: 25, cool: 12 }] },
    { id: 'moon', name: 'Moon Watch', blurb: 'Big round numbers on SOL pay the people holding.', rules: [
      { src: 'price', asset: 'SOL', op: 'above', value: 300, act: 'burn', pct: 30, cool: 24 },
      { src: 'price', asset: 'SOL', op: 'above', value: 500, act: 'holders', pct: 50, cool: 24 }] },
    { id: 'rain', name: 'Rain Maker', blurb: 'It rains in London. It rains on holders.', rules: [
      { src: 'weather', city: { name: 'London', country: 'United Kingdom', lat: 51.509, lon: -0.126 }, op: 'rain', act: 'holders', pct: 10, cool: 12 },
      { src: 'weather', city: { name: 'London', country: 'United Kingdom', lat: 51.509, lon: -0.126 }, op: 'clear', act: 'burn', pct: 5, cool: 24 }] },
    { id: 'gameday', name: 'Game Day', blurb: 'Your team wins, the holders get the bag.', rules: [
      { src: 'sports', league: 'eng.1', team: { id: '359', name: 'Arsenal' }, op: 'wins', act: 'airdrop', pct: 20, cool: 24 },
      { src: 'sports', league: 'eng.1', team: { id: '359', name: 'Arsenal' }, op: 'loses', act: 'burn', pct: 10, cool: 24 }] },
    { id: 'heat', name: 'Heatwave', blurb: 'Dubai cooks, the supply melts.', rules: [
      { src: 'weather', city: { name: 'Dubai', country: 'United Arab Emirates', lat: 25.077, lon: 55.309 }, op: 'hot', value: 40, act: 'burn', pct: 15, cool: 24 },
      { src: 'time', every: 24, op: 'every', act: 'holders', pct: 5, cool: 24 }] },
    { id: 'clock', name: 'Clockwork', blurb: 'No world needed: a steady burn and a payday.', rules: [
      { src: 'time', every: 6, op: 'every', act: 'burn', pct: 10, cool: 6 },
      { src: 'coin', op: 'mcap', value: 100000, act: 'holders', pct: 25, cool: 24 }] },
  ];
  return { ASSETS, LEAGUES, CATS, SRC, ACTS, MAX_RULES, normalize, normalizeBook, cond, action, line, words, isEvent, book, canon, usd, lg, TEMPLATES };
});
