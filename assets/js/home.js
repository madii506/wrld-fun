/* wrld home: the spinning world, the live board, the pipeline, the rule tester, rulebooks, coins and the fired feed */
(function () {
  const { $, $$, esc, api, post, usd, pct, sol, ago, hhmm, hl, toast } = WRLD;
  const WR = window.WR;
  WRLD.typePrompt($('#prompt'), 'pump.fun coins, wired to the world');
  WRLD.caStrip($('#ca')); WRLD.tape(); WRLD.reveal(); WRLD.nudge();
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === 'home'));

  // ---------- the globe, with the four live cities pinned on it ----------
  const CITIES = [{ name: 'London', lat: 51.509, lon: -0.126 }, { name: 'New York', lat: 40.713, lon: -74.006 }, { name: 'Tokyo', lat: 35.69, lon: 139.692 }, { name: 'Dubai', lat: 25.077, lon: 55.309 }];
  const pinsEl = $('#pins'); let wx = {};
  function paintPins(lit) {
    pinsEl.innerHTML = CITIES.map(c => { const w = wx[c.name]; return `<div class="pin${lit && lit.name === c.name ? ' lit' : ''}"><b>@ ${esc(c.name)}</b><span>${w && w.ok ? `${w.temp}°C · ${esc(w.desc)}` : '<span class="off">offline</span>'}</span></div>`; }).join('');
  }
  paintPins(null);
  const small = matchMedia('(max-width: 640px)').matches;
  WRLD.globe($('#globe'), { cols: small ? 40 : 48, rows: small ? 20 : 24, pins: CITIES, lon0: -60, onFace: paintPins });

  // ---------- the live board ----------
  const spark = a => { if (!a || a.length < 2) return ''; const lo = Math.min(...a), hi = Math.max(...a), B = '▁▂▃▄▅▆▇█'; return a.map(v => B[Math.round((v - lo) / ((hi - lo) || 1) * 7)]).join(''); };
  let nextAt = 0; const lastPx = {};
  async function board() {
    $('#liveAt').textContent = 'reading…';
    const b = await api('/api/world');
    if (!b || !b.ok) { $('#liveAt').innerHTML = '<span class="off">feeds offline</span>'; ['#lvPx', '#lvWx', '#lvGm', '#lvEv'].forEach(s => { $(s).innerHTML = '<div class="row"><span class="off">source offline · retrying</span></div>'; }); nextAt = Date.now() + 20000; return; }
    const firstPaint = !Object.keys(lastPx).length;
    $('#lvPx').innerHTML = (b.prices || []).map(p => p.ok ? `<div class="row"><span class="nm">${p.asset}</span><span class="vl"><span class="pxv" data-a="${p.asset}" data-p="${p.price}">${usd(p.price)}</span> <span class="${p.ch1h >= 0 ? 'up' : 'dn'}">${pct(p.ch1h)}</span> <span class="dim">1h</span></span>
      <span class="sp" title="last 24 hours">${spark(p.spark)}</span><span class="meta">24h <span class="${p.ch24h >= 0 ? 'up' : 'dn'}">${pct(p.ch24h)}</span> · <a class="u" href="${esc(p.src)}" target="_blank" rel="noopener">source</a></span></div>`
      : `<div class="row"><span class="nm">${esc(p.asset)}</span><span class="vl off">offline</span></div>`).join('');
    $$('#lvPx .pxv').forEach(el => { const a = el.dataset.a, p = +el.dataset.p; if (firstPaint) WRLD.countUp(el, p, usd, 900); else if (lastPx[a] && lastPx[a] !== p) WRLD.flash(el.closest('.row'), p > lastPx[a]); lastPx[a] = p; });
    if (firstPaint) ['#lvPx', '#lvWx', '#lvGm', '#lvEv'].forEach(s => setTimeout(() => WRLD.stagger($(s), '.row', 70), 0));
    wx = {}; (b.weather || []).forEach(w => { wx[w.city] = w; });
    $('#lvWx').innerHTML = (b.weather || []).map(w => w.ok ? `<div class="row"><span class="nm">${esc(w.city)}</span><span class="vl">${w.temp}°C</span>
      <span class="meta">${esc(w.desc)} · wind ${w.wind} km/h ${w.raining ? '<span class="tag hold">raining</span>' : ''}${w.snowing ? '<span class="tag hold">snowing</span>' : ''}${w.clear ? '<span class="tag g">clear</span>' : ''}</span></div>`
      : `<div class="row"><span class="nm">${esc(w.city)}</span><span class="vl off">offline</span></div>`).join('');
    paintPins(null);
    const evs = b.events || [];
    $('#lvEv').innerHTML = evs.length ? evs.map(e => e.ok === false || !e.q ? `<div class="row"><span class="nm">${esc(e.cat)}</span><span class="vl off">offline</span></div>`
      : `<div class="row"><span class="nm">${esc(e.cat)}</span><span class="vl v"><b>YES ${e.yes}%</b></span><span class="meta" style="color:var(--ink2)">${esc(e.q)}</span><span class="meta"><a class="u" href="${esc(e.src)}" target="_blank" rel="noopener">source</a></span></div>`).join('')
      : '<div class="row"><span class="dim">no events on the board right now</span></div>';
    const gs = b.games || [];
    $('#lvGm').innerHTML = gs.length ? gs.map(g => `<div class="row"><span class="nm">${esc(g.home)} <span class="${g.hw ? 'g' : ''}">${esc(g.hs)}</span>–<span class="${g.aw ? 'g' : ''}">${esc(g.as)}</span> ${esc(g.away)}</span>
      <span class="vl ${g.state === 'in' ? 'burn' : 'dim'}">${g.state === 'in' ? '● live' : esc(g.detail)}</span><span class="meta">${esc(g.league)}</span></div>`).join('')
      : '<div class="row"><span class="dim">no games on the boards right now</span></div>';
    $('#liveAt').textContent = 'read ' + hhmm(b.at);
    nextAt = Date.now() + 30000;
  }
  setInterval(() => { const s = Math.max(0, Math.round((nextAt - Date.now()) / 1000)); $('#liveNext').textContent = nextAt ? `next read in ${s}s` : ''; if (nextAt && s <= 0 && !document.hidden) { nextAt = 0; board(); } }, 1000);
  $('#liveRe').addEventListener('click', board);
  board();

  // ---------- how a rule fires: four boxes, a packet travelling along the wire ----------
  const SCEN = [
    { name: 'war room', world: ['odds', 'ceasefire', 'YES > 60%'], rule: 'ceasefire odds > 60%', act: ['buyback_burn', '30% of chest'], cls: 'burn' },
    { name: 'rain maker', world: ['weather', 'London', 'raining'], rule: 'it rains in London', act: ['pay_holders', '10% of chest'], cls: 'hold' },
    { name: 'dip shield', world: ['price', 'BTC', '-5% in 1h'], rule: 'BTC dumps 5% in 1h', act: ['buyback_burn', '25% of chest'], cls: 'burn' },
    { name: 'game day', world: ['sports', 'Arsenal', 'won'], rule: 'Arsenal win a game', act: ['airdrop_holders', '20% of chest'], cls: 'air' },
    { name: 'moon watch', world: ['price', 'SOL', 'above $300'], rule: 'SOL goes above $300', act: ['pay_holders', '30% of chest'], cls: 'hold' },
  ];
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  let si = 0, step = 0, paused = false;
  function drawPipe() {
    const s = SCEN[si], on = k => step >= k;
    const box = (t, a, b, lit) => [`.${'-'.repeat(19)}.`, `| ${pad(t, 18)}|`, `| ${pad(a, 18)}|`, `| ${pad(b, 18)}|`, `'${'-'.repeat(19)}'`].map(l => lit ? `<span class="ok">${esc(l)}</span>` : esc(l));
    const B = [box(s.world[0] + '("' + s.world[1] + '")', '-> ' + s.world[2], step >= 1 ? 'reading ok' : '...', on(1)),
      box('rule: when', s.rule.slice(0, 18), step >= 2 ? 'read 1 ok, 2 ok' : 'waiting', on(2)),
      box('chest', 'claimed fees', step >= 3 ? s.act[1] : '...', on(3)),
      box(s.act[0], step >= 4 ? 'tx sent' : '...', step >= 4 ? 'linked on solscan' : '', on(4))];
    const wire = k => step === k ? '<span class="pk">----*---&gt;</span>' : step > k ? '<span class="ok">--------&gt;</span>' : '--------&gt;';   // 9 characters, same as the gap
    const out = [];
    for (let i = 0; i < 5; i++) out.push(B[0][i] + (i === 2 ? wire(1) : '         ') + B[1][i] + (i === 2 ? wire(2) : '         ') + B[2][i] + (i === 2 ? wire(3) : '         ') + B[3][i]);
    $('#pipe').innerHTML = out.join('\n'); $('#pipeName').textContent = 'example: ' + s.name;
  }
  function stepPipe() { if (paused) return; step++; if (step > 5) { step = 0; si = (si + 1) % SCEN.length; } drawPipe(); }
  drawPipe(); setInterval(stepPipe, 1100);
  $('#pipeP').addEventListener('click', e => { paused = !paused; e.currentTarget.textContent = paused ? 'play' : 'pause'; });
  // the wide pipeline doesn't fit a phone: shrink the type to fit the box
  const fit = () => { const p = $('#pipe'); p.style.fontSize = ''; const w = p.parentNode.clientWidth, need = 4 * 21 + 3 * 9; const px = Math.min(12.5, w / (need * .6)); p.style.fontSize = px + 'px'; };
  addEventListener('resize', fit); fit();

  // ---------- try a rule ----------
  let cur = null;
  const ed = WRLD.ruleEditor($('#tryEd'), { src: 'events', cat: 'war', op: 'above', value: 60, act: 'burn', pct: 20, cool: 12 }, (n, err) => {
    cur = n;
    $('#tryCode').innerHTML = n ? hl(WR.line(n) + '  # max once per ' + n.cool + 'h') + '\n<span class="cm"># ' + esc(WR.words(n)) + '</span>' : '<span class="cm"># ' + esc(err || 'finish the rule') + '</span>';
    $('#tryUse').href = n ? '/launch#r=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify([n]))))) : '/launch';
    $('#tryOut').hidden = true;
  });
  $('#tryGo').addEventListener('click', async e => {
    if (!cur) { toast('Finish the rule first'); return; }
    const b = e.currentTarget; b.disabled = true; const o = $('#tryOut'); o.hidden = false; o.innerHTML = '<span class="dim">reading the world…</span>';
    const r = await post('/api/world?op=eval', { rules: [cur] }); b.disabled = false;
    const x = r && r.ok && r.results[0];
    if (!x) { o.innerHTML = '<span class="na big2">couldn’t read the world just now</span><span class="dim">try again in a moment</span>'; return; }
    const verdict = !x.ok ? `<span class="na big2">SOURCE OFFLINE · the rule would wait</span>` : x.now ? `<span class="yes big2">TRUE · this would fire now</span>` : `<span class="no big2">FALSE · not right now</span>`;
    const note = x.event ? '<span class="dim">this rule counts events: on a live coin only ones after launch count, once each.</span>' : '<span class="dim">on a live coin it would also need to hold on the next read, then it fires once per crossing.</span>';
    o.classList.remove('pop'); void o.offsetWidth; o.classList.add('pop'); o.style.setProperty('--i', 0);
    o.innerHTML = `${verdict}<span>${esc(x.text)}${x.src ? ` · <a class="u" href="${esc(x.src)}" target="_blank" rel="noopener">source</a>` : ''}</span>${note}<span class="dim">read ${hhmm(r.at)}</span>`;
  });

  // ---------- rulebooks ----------
  $('#tpls').innerHTML = WR.TEMPLATES.map(t => {
    const rules = t.rules.map(WR.normalize);
    return `<div class="tpl"><h3>${esc(t.name)}</h3><p>${esc(t.blurb)}</p><div class="code">${rules.map((r, i) => hl(String(i + 1).padStart(2, '0') + '  ' + WR.line(r))).join('\n')}</div>
      <div class="r"><a class="br sm" href="/launch#t=${t.id}">use <span class="p">-&gt;</span></a><a class="br sm" href="#" data-copy="${esc(rules.map(WR.line).join('\n'))}" data-what="Rulebook copied">copy</a></div></div>`;
  }).join('');
  WRLD.stagger($('#tpls'), '.tpl', 80);

  // ---------- coins and the fired feed ----------
  const EMPTY = `<pre aria-hidden="true">   .------------------.\n   |  no coins yet    |\n   '------------------'</pre>`;
  async function coins() {
    const r = await api('/api/coins');
    const list = (r && r.coins) || [];
    $('#coinsN').textContent = r && r.ok ? `${list.filter(c => c.state === 'live').length} live` : '';
    if (r && r.ok) WRLD.countUp($('#stLive'), list.filter(c => c.state === 'live').length, v => String(Math.round(v)), 600); else $('#stLive').textContent = '—';
    if (!r || !r.ok) { $('#coinsBd').innerHTML = '<div class="empty"><span class="off">the registry didn’t answer · retrying</span></div>'; return; }
    if (!list.length) { $('#coinsBd').innerHTML = `<div class="empty">${EMPTY}No coins yet. The first coin wired to the world could be yours. <a class="u" href="/launch">launch one</a>.</div>`; return; }
    $('#coinsBd').innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>coin</th><th>rules</th><th class="hide-s">fired</th><th class="hide-s">claimed</th><th>mcap</th></tr></thead><tbody>${list.map(c => `
      <tr><td><a class="coin" href="/coin?m=${esc(c.mint)}"><img src="${esc(c.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span><b>$${esc(c.symbol)}</b><span class="rl">${esc(c.name)}${c.state !== 'live' ? ' · ' + esc(c.state) : ''}</span></span></a></td>
      <td class="rl">${c.rules.slice(0, 2).map(x => esc(x.words)).join('<br>')}${c.rules.length > 2 ? `<br>+${c.rules.length - 2} more` : ''}</td>
      <td class="hide-s">${c.fires || 0}${c.lastFireAt ? `<br><span class="rl">${ago(c.lastFireAt)}</span>` : ''}</td><td class="hide-s">${sol(c.claimedSol)}</td><td>${usd(c.mcapUsd)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function feed() {
    const r = await api('/api/coins?op=log');
    const log = (r && r.log) || [];
    if (!r || !r.ok) { $('#feed').innerHTML = '<div class="empty"><span class="off">the engine log didn’t answer · retrying</span></div>'; return; }
    if (!log.length) { $('#feed').innerHTML = '<div class="empty">Nothing has fired yet. When it does, every claim, fire and payout shows up here with its transaction.</div>'; return; }
    $('#feed').innerHTML = log.map(e => `<div class="ev ${esc(e.kind)}"><span class="t">${ago(e.at)}</span><span><span class="kind">${esc(e.kind)}</span><a class="u" href="/coin?m=${esc(e.mint)}">$${esc(e.symbol)}</a> ${esc(e.text)}</span>
      <span class="l">${e.src ? `<a class="u" href="${esc(e.src)}" target="_blank" rel="noopener">source</a>` : ''}${e.sig ? `<a class="u" href="${WRLD.tx(e.sig)}" target="_blank" rel="noopener">tx</a>` : ''}</span></div>`).join('');
    if (!feed.done) { feed.done = 1; WRLD.stagger($('#feed'), '.ev', 40); }
  }

  // ---------- world events: tabs of live markets, each one a rule you can launch ----------
  const evCache = {}; let evCat = 'war';
  const bar = p => { const n = Math.round(Math.max(0, Math.min(100, p)) / 5); return `<span class="bar" data-fill="${n}" data-w="20">[${'#'.repeat(n)}<span class="dim">${'-'.repeat(20 - n)}</span>]</span>`; };
  const vol = v => !v ? '' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v);
  const enc = o => encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));
  $('#evTabs').innerHTML = WR.CATS.map(c => `<button class="br sm" type="button" data-cat="${c.id}">${esc(c.name)}</button>`).join('');
  async function events(cat) {
    evCat = cat; $$('#evTabs [data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === cat)); $$('#evTabs [data-cat]').forEach(b => { b.style.color = b.dataset.cat === cat ? 'var(--green3)' : ''; });
    if (!evCache[cat]) { $('#evList').innerHTML = '<div class="empty">reading the odds…</div>'; evCache[cat] = await api('/api/world?op=markets&cat=' + encodeURIComponent(cat)); }
    if (evCat !== cat) return;
    const r = evCache[cat];
    if (!r || !r.ok) { $('#evList').innerHTML = '<div class="empty"><span class="off">the odds didn’t answer · try again in a minute</span></div>'; delete evCache[cat]; return; }
    $('#evAt').textContent = 'read ' + hhmm(r.at);
    WRLD.swap($('#evList'), r.markets.slice(0, 8).map(m => {
      const up = Math.min(95, Math.max(5, Math.ceil((m.yes + 10) / 5) * 5));
      const rule = [{ src: 'events', cat, market: { id: m.id, q: m.q, slug: m.slug }, op: 'above', value: up, act: 'burn', pct: 20, cool: 12 }];
      return `<div class="evrow"><div class="q">${esc(m.q)}</div>
        <div class="o">${bar(m.yes)} <b class="v">YES ${m.yes}%</b> <span class="dim">${vol(m.vol)}${m.vol ? ' 24h' : ''}</span></div>
        <div class="a"><a class="u" href="${esc(m.src)}" target="_blank" rel="noopener">source</a><a class="br sm" href="/launch#r=${enc(rule)}">wire a coin <span class="p">-&gt;</span></a></div>
        <div class="w dim">e.g. when YES passes ${up}% → buy back &amp; burn 20% of the chest</div></div>`;
    }).join(''), () => { WRLD.stagger($('#evList'), '.evrow', 55); WRLD.fillBars($('#evList')); });
  }
  $('#evTabs').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) events(b.dataset.cat); });
  events('war');

  // the engine's heartbeat: when it last read the world, from its own lock
  api('/api/coins?op=stats').then(s => { if (s && s.ok && s.lastTick) { $('#stTick').textContent = ago(s.lastTick); $('#stTickL').textContent = 'since the engine last read the world (it runs every ~5 min)'; } });

  coins(); feed(); setInterval(() => { if (!document.hidden) { coins(); feed(); } }, 30000);
})();
