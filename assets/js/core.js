/* wrld — shared browser code: the tape, the spinning world, the rule editor, wallets, small helpers */
(function () {
  const CONFIG = window.WRLD_CONFIG || { ca: '', x: '' };
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (url, opt) => { try { const r = await fetch(url, opt); return await r.json(); } catch { return { ok: false, error: 'The network didn’t answer.' }; } };
  const post = (url, body) => api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const usd = v => v == null ? '—' : '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : v >= 1 ? Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 }) : Number(v).toPrecision(3));
  const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  const sol = v => v == null ? '—' : Number(v).toFixed(Number(v) >= 10 ? 2 : 4) + ' SOL';
  const ago = t => { if (!t) return '—'; const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const hhmm = t => new Date(t).toISOString().slice(11, 16) + ' UTC';
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const tx = s => 'https://solscan.io/tx/' + s, acct = a => 'https://solscan.io/account/' + a;
  let tt = null;
  function toast(m) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1900); }
  async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast((what || 'Copied') + ' ✓'); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast((what || 'Copied') + ' ✓'); } catch { toast('Copy failed'); } ta.remove(); } }
  document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) { e.preventDefault(); copy(b.getAttribute('data-copy'), b.getAttribute('data-what')); } });

  // the rulebook language, coloured
  function hl(line) {
    return esc(line).replace(/(&quot;[^&]*?&quot;)/g, '<span class="st">$1</span>')
      .replace(/^(\d\d)(\s)/, '<span class="cm">$1</span>$2').replace(/\b(when)\b/g, '<span class="kw">$1</span>')
      .replace(/\b(buyback_burn)\b/g, '<span class="burn">$1</span>').replace(/\b(pay_holders)\b/g, '<span class="hold">$1</span>')
      .replace(/\b(airdrop_holders)\b/g, '<span class="air">$1</span>').replace(/\b(pay_creator)\b/g, '<span class="crea">$1</span>')
      .replace(/(#[^\n]*)$/gm, '<span class="cm">$1</span>').replace(/-&gt;/g, '<span class="cm">-&gt;</span>');
  }

  // ---------- the tape: live readings + the engine's latest actions ----------
  async function tape() {
    const el = $('#tape .in'); if (!el) return;
    const [b, l] = await Promise.all([api('/api/world'), api('/api/coins?op=log')]);
    const items = [];
    if (b && b.ok) {
      for (const p of b.prices || []) if (p.ok) items.push(`<span class="it"><b>${p.asset}</b> ${usd(p.price)} <span class="${p.ch1h >= 0 ? 'up' : 'dn'}">${pct(p.ch1h)}</span> 1h</span>`);
      for (const w of b.weather || []) if (w.ok) items.push(`<span class="it"><b>${esc(w.city)}</b> ${w.temp}°C ${esc(w.desc)}</span>`);
      for (const e of b.events || []) if (e.ok !== false && e.q) items.push(`<span class="it"><b>${esc(e.cat)}</b> ${esc(e.q.slice(0, 70))} <span class="v">YES ${e.yes}%</span></span>`);
      for (const g of (b.games || []).slice(0, 4)) items.push(`<span class="it"><b>${esc(g.home)}</b> ${esc(g.hs)}–${esc(g.as)} <b>${esc(g.away)}</b> <span class="dim">${esc(g.detail)}</span></span>`);
    }
    if (l && l.ok) for (const e of (l.log || []).slice(0, 10)) items.push(`<span class="it"><span class="ar">+&gt;</span> <b>$${esc(e.symbol)}</b> ${esc(e.text.replace(/^rule \d+ fired: /, '').slice(0, 90))}</span>`);
    if (!items.length) { el.innerHTML = '<span class="it off">the world feeds are offline right now. retrying</span>'.repeat(2); setTimeout(tape, 20000); return; }
    const one = items.join('<span class="sep">//</span>') + '<span class="sep">//</span>';
    el.innerHTML = one + one;
    el.style.animationDuration = Math.max(40, items.length * 6) + 's';
  }

  // ---------- the spinning world: an orthographic ASCII globe from a 2° land mask ----------
  function globe(pre, opts = {}) {
    const A = window.WRLD_ART; if (!pre || !A) return;
    const W0 = A.land_w, H0 = A.land_h, raw = atob(A.land), bits = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bits[i] = raw.charCodeAt(i);
    const land = (lat, lon) => { let r = Math.round((89 - lat) / 2), c = Math.round((lon + 179) / 2); r = Math.max(0, Math.min(H0 - 1, r)); c = ((c % W0) + W0) % W0; const i = r * W0 + c; return (bits[i >> 3] >> (7 - (i & 7))) & 1; };
    const cols = opts.cols || 46, rows = opts.rows || 23, cw = .6, ch = 1;   // character cell in em
    const R = Math.min(cols * cw, rows * ch) / 2 - .6;                          // radius in em
    const cx = cols * cw / 2, cy = rows * ch / 2;
    const lat0 = (opts.lat0 || 18) * Math.PI / 180;
    const Lx = -.5, Ly = .55, Lz = .67;
    const pins = opts.pins || [];
    // the limb, computed once: a thin line of / | \ -
    const ring = new Map(), Rr = R + .2;
    const put = (r, c, x, y) => { if (r < 0 || r >= rows || c < 0 || c >= cols) return; const t = ((Math.atan2(-x, -y) * 180 / Math.PI) + 360) % 180; ring.set(r * cols + c, t < 25 || t > 155 ? '-' : t < 65 ? '/' : t < 115 ? '|' : '\\'); };
    for (let r = 0; r < rows; r++) { const y = (r + .5) * ch - cy; if (Math.abs(y) < Rr) { const dx = Math.sqrt(Rr * Rr - y * y); for (const x of [-dx, dx]) if (Math.abs(x / ch) >= Math.abs(y / cw)) put(r, Math.floor((cx + x) / cw), x, y); } }
    for (let c = 0; c < cols; c++) { const x = (c + .5) * cw - cx; if (Math.abs(x) < Rr) { const dy = Math.sqrt(Rr * Rr - x * x); for (const y of [-dy, dy]) if (Math.abs(x / ch) < Math.abs(y / cw)) put(Math.floor((cy + y) / ch), c, x, y); } }
    let lon0 = opts.lon0 != null ? opts.lon0 : -30, last = 0, paused = false, lit = null;
    function frame(ts) {
      if (!paused && ts - last > 90) {
        last = ts; lon0 += .9;
        const l0 = lon0 * Math.PI / 180; let out = '';
        const pinAt = new Map();
        for (const p of pins) {
          const la = p.lat * Math.PI / 180, lo = p.lon * Math.PI / 180;
          const cosc = Math.sin(lat0) * Math.sin(la) + Math.cos(lat0) * Math.cos(la) * Math.cos(lo - l0);
          if (cosc <= .15) continue;
          const x = Math.cos(la) * Math.sin(lo - l0), y = Math.cos(lat0) * Math.sin(la) - Math.sin(lat0) * Math.cos(la) * Math.cos(lo - l0);
          const c = Math.floor((cx + x * R) / cw), r = Math.floor((cy - y * R) / ch);
          pinAt.set(r * cols + c, p); p._vis = cosc;
        }
        for (let r = 0; r < rows; r++) {
          let cur = null, buf = '';
          const push = (cls, chr) => { if (cls !== cur) { if (buf) out += cur ? `<span class="${cur}">${buf}</span>` : buf; buf = ''; cur = cls; } buf += chr; };
          for (let c = 0; c < cols; c++) {
            const k = r * cols + c;
            if (pinAt.has(k)) { push('gp', '@'); continue; }
            if (ring.has(k)) { push('gl', ring.get(k)); continue; }
            const x = ((c + .5) * cw - cx) / R, y = -((r + .5) * ch - cy) / R, rr = x * x + y * y;
            if (rr >= .97) { push(null, ' '); continue; }
            const z = Math.sqrt(1 - rr), rho = Math.sqrt(rr), cc = Math.asin(Math.min(1, rho));
            const la = rho < 1e-9 ? lat0 : Math.asin(Math.cos(cc) * Math.sin(lat0) + y * Math.sin(cc) * Math.cos(lat0) / rho);
            const lo = l0 + Math.atan2(x * Math.sin(cc), rho * Math.cos(cc) * Math.cos(lat0) - y * Math.sin(cc) * Math.sin(lat0));
            const sh = x * Lx + y * Ly + z * Lz;
            if (land(la * 180 / Math.PI, ((lo * 180 / Math.PI + 540) % 360) - 180)) push(sh < .18 ? 'gs' : 'gd', sh < .18 ? '@' : '#');
            else push(sh < .06 ? 'go' : null, sh < .06 ? ':' : ' ');
          }
          if (buf) out += cur ? `<span class="${cur}">${buf}</span>` : buf;
          out += '\n';
        }
        pre.innerHTML = out;
        // the city facing us most squarely is the one the label list lights up
        const best = pins.filter(p => p._vis > .35).sort((a, b) => b._vis - a._vis)[0];
        if (opts.onFace && best !== lit) { lit = best; opts.onFace(best); }
        pins.forEach(p => { p._vis = null; });
      }
      if (!document.hidden) requestAnimationFrame(frame); else setTimeout(() => requestAnimationFrame(frame), 500);
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { paused = false; frame(1000); paused = true; } else requestAnimationFrame(frame);
    pre.addEventListener('mouseenter', () => { paused = true; }); pre.addEventListener('mouseleave', () => { if (!reduce) paused = false; });
  }

  // ---------- wallets ----------
  const wallets = () => [
    { id: 'phantom', name: 'Phantom', p: (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null) },
    { id: 'solflare', name: 'Solflare', p: window.solflare && window.solflare.isSolflare ? window.solflare : null },
    { id: 'backpack', name: 'Backpack', p: window.backpack && (window.backpack.solana || window.backpack) },
  ].filter(w => w.p);
  let WAL = null;
  async function connect() {
    const ws = wallets();
    if (!ws.length) { toast('No Solana wallet found in this browser'); return null; }
    const w = ws[0];
    try { const r = await w.p.connect(); const pk = (r && r.publicKey) || w.p.publicKey; WAL = { ...w, pk: pk.toString() }; try { localStorage.setItem('wrld:w', w.id); } catch {} paintWallet(); return WAL; }
    catch { toast('Wallet connection was cancelled'); return null; }
  }
  function paintWallet() { $$('[data-connect]').forEach(b => { b.innerHTML = WAL ? '<span class="p">●</span> ' + short(WAL.pk) : 'connect'; }); }
  document.addEventListener('click', e => { const b = e.target.closest('[data-connect]'); if (b) { e.preventDefault(); if (WAL) { copy(WAL.pk, 'Address copied'); } else connect(); } });
  (async () => { try { const id = localStorage.getItem('wrld:w'); const w = wallets().find(x => x.id === id); if (w) { const r = await w.p.connect({ onlyIfTrusted: true }); const pk = (r && r.publicKey) || w.p.publicKey; if (pk) { WAL = { ...w, pk: pk.toString() }; paintWallet(); } } } catch {} })();

  // ---------- the rule editor (used by the tester on the home page and by the launcher) ----------
  const WR = window.WR;
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const teamCache = {}, mkCache = {};
  async function marketsOf(cat) { if (!mkCache[cat]) mkCache[cat] = api('/api/world?op=markets&cat=' + encodeURIComponent(cat)).then(r => (r && r.markets) || []); return mkCache[cat]; }
  async function teamsOf(league) { if (!teamCache[league]) teamCache[league] = api('/api/world?op=teams&league=' + encodeURIComponent(league)).then(r => (r && r.teams) || []); return teamCache[league]; }
  function ruleEditor(host, init, onChange, opts = {}) {
    const r = Object.assign({ src: 'price', asset: 'SOL', op: 'above', value: '', win: '1h', act: 'burn', pct: 10, cool: 6 }, init || {});
    const el = document.createElement('div'); el.className = 'rule'; host.appendChild(el);
    function fire() { let n = null, err = null; try { n = WR.normalize(r); } catch (e) { err = e.message; } onChange && onChange(n, err, r); }
    function paint() {
      const S = WR.SRC[r.src];
      if (!S.ops[r.op]) r.op = Object.keys(S.ops)[0];
      let mid = '';
      if (r.src === 'price') {
        mid = `<select data-k="asset" aria-label="coin">${WR.ASSETS.map(a => opt(a, a, a === r.asset)).join('')}</select>
          <select data-k="op" aria-label="condition">${Object.entries(S.ops).map(([k, v]) => opt(k, v, k === r.op)).join('')}</select>`;
        mid += r.op === 'up' || r.op === 'down'
          ? `<input class="pct" data-k="value" type="number" step="0.5" min="0.5" max="90" placeholder="5" value="${esc(r.value)}" aria-label="percent">% in <select data-k="win" aria-label="window">${opt('1h', '1 hour', r.win === '1h')}${opt('24h', '24 hours', r.win === '24h')}</select>`
          : `$<input class="num" data-k="value" type="number" step="any" min="0" placeholder="300" value="${esc(r.value)}" aria-label="price in USD">`;
      } else if (r.src === 'events') {
        if (!r.cat) r.cat = 'war';
        mid = `<select data-k="cat" aria-label="kind of event">${WR.CATS.map(c => opt(c.id, c.name, c.id === r.cat)).join('')}</select>
          <select data-k="market" aria-label="event" style="max-width:min(420px,100%)">${r.market ? opt(r.market.id, r.market.q, true) : opt('', 'loading events…', true)}</select>
          <select data-k="op" aria-label="condition">${Object.entries(S.ops).map(([k, v]) => opt(k, v, k === r.op)).join('')}</select>`;
        if (r.op === 'above' || r.op === 'below') mid += `<input class="pct" data-k="value" type="number" min="1" max="99" placeholder="60" value="${esc(r.value)}" aria-label="odds percent">%`;
      } else if (r.src === 'weather') {
        mid = `<span class="city"><input data-k="cityq" type="text" placeholder="a city" value="${esc(r.city ? r.city.name : '')}" autocomplete="off" aria-label="city" style="width:150px"><span class="dd" hidden></span></span>
          <select data-k="op" aria-label="condition">${Object.entries(S.ops).map(([k, v]) => opt(k, v, k === r.op)).join('')}</select>`;
        if (r.op === 'hot' || r.op === 'cold') mid += `<input class="sm" data-k="value" type="number" step="0.5" placeholder="${r.op === 'hot' ? '30' : '0'}" value="${esc(r.value)}" aria-label="°C">°C`;
        if (r.op === 'wind') mid += `<input class="sm" data-k="value" type="number" step="1" placeholder="50" value="${esc(r.value)}" aria-label="km/h">km/h`;
      } else if (r.src === 'sports') {
        mid = `<select data-k="league" aria-label="league">${opt('', 'league…', !r.league)}${WR.LEAGUES.map(l => opt(l.id, l.name, l.id === r.league)).join('')}</select>
          <select data-k="team" aria-label="team" ${r.league ? '' : 'disabled'}>${r.team ? opt(r.team.id, r.team.name, true) : opt('', 'team…', true)}</select>
          <select data-k="op" aria-label="condition">${Object.entries(S.ops).map(([k, v]) => opt(k, v, k === r.op)).join('')}</select>`;
      } else if (r.src === 'posts') {
        mid = `@<input data-k="handle" type="text" placeholder="handle" value="${esc(r.handle || '')}" style="width:130px" aria-label="X handle"> posts <input data-k="word" type="text" placeholder="a word (or leave empty)" value="${esc(r.word || '')}" style="width:170px" aria-label="word">`;
      } else if (r.src === 'coin') {
        mid = `<select data-k="op" aria-label="condition">${Object.entries(S.ops).map(([k, v]) => opt(k, v, k === r.op)).join('')}</select>`;
        if (r.op === 'mcap') mid += `$<input class="num" data-k="value" type="number" step="1000" min="1000" placeholder="100000" value="${esc(r.value)}" aria-label="market cap in USD">`;
      } else if (r.src === 'time') {
        r.op = 'every'; mid = `every <input class="sm" data-k="every" type="number" min="1" max="168" placeholder="6" value="${esc(r.every || '')}" aria-label="hours"> hours`;
      }
      el.innerHTML = `${opts.n ? `<span class="n">rule ${String(opts.n()).padStart(2, '0')}</span>` : ''}
        <div class="ln"><span class="w">when</span>
          <select data-k="src" aria-label="what to watch">${Object.entries(WR.SRC).filter(([k]) => (opts.coin || k !== 'coin') && (k !== 'posts' || window.WRLD_XPOSTS || r.src === 'posts')).map(([k, v]) => opt(k, v.label, k === r.src)).join('')}</select>
          ${mid}</div>
        <div class="ln" style="margin-top:8px"><span class="arr">-&gt;</span>
          <select data-k="act" aria-label="action">${Object.entries(WR.ACTS).map(([k, v]) => opt(k, v.label, k === r.act)).join('')}</select>
          with <input class="pct" data-k="pct" type="number" min="1" max="100" value="${esc(r.pct)}" aria-label="percent of chest">% of the chest</div>
        <div class="meta2"><span>max once per <input class="pct" data-k="cool" type="number" min="1" max="168" value="${esc(r.cool)}" aria-label="cooldown hours">h</span>${opts.remove ? '<button class="br sm x" data-rm type="button">remove</button>' : ''}</div>`;
      if (r.src === 'events') marketsOf(r.cat).then(ms => {
        const s = $('[data-k=market]', el); if (!s) return;
        if (!ms.length) { s.innerHTML = opt('', 'events offline', true); s.disabled = true; return; }
        if (r.market && !ms.find(m => m.id === r.market.id)) ms = [{ id: r.market.id, q: r.market.q, slug: r.market.slug, yes: null }, ...ms];
        s.innerHTML = ms.map(m => `<option value="${esc(m.id)}" data-slug="${esc(m.slug)}" data-q="${esc(m.q)}"${r.market && r.market.id === m.id ? ' selected' : ''}>${esc(m.q.length > 70 ? m.q.slice(0, 67) + '…' : m.q)}${m.yes != null ? ' · ' + m.yes + '%' : ''}</option>`).join(''); s.disabled = false;
        if (!r.market) { const m = ms[0]; r.market = { id: m.id, q: m.q, slug: m.slug }; fire(); }
      });
      if (r.src === 'sports' && r.league) teamsOf(r.league).then(ts => {
        const s = $('[data-k=team]', el); if (!s) return;
        s.innerHTML = opt('', ts.length ? 'team…' : 'teams offline', !r.team) + ts.map(t => opt(t.id, t.name, r.team && r.team.id === t.id)).join(''); s.disabled = !ts.length;
      });
      fire();
    }
    let gq = 0;
    el.addEventListener('input', async e => {
      const k = e.target.getAttribute('data-k'); if (!k) return;
      if (k === 'cityq') {
        const qv = e.target.value.trim(), my = ++gq, dd = $('.dd', el); r.city = null; fire();
        if (qv.length < 2) { dd.hidden = true; return; }
        const res = await api('/api/world?op=geo&q=' + encodeURIComponent(qv)); if (my !== gq) return;
        const list = (res && res.results) || [];
        dd.innerHTML = list.length ? list.map((g, i) => `<button type="button" data-i="${i}">${esc(g.name)}<span class="dim">, ${esc([g.admin, g.country].filter(Boolean).join(', '))}</span></button>`).join('') : '<button type="button" disabled>no city found</button>';
        dd.hidden = false; dd._list = list; return;
      }
      if (['value', 'pct', 'cool', 'every', 'handle', 'word'].includes(k)) { r[k] = e.target.value; fire(); }
    });
    el.addEventListener('change', e => {
      const k = e.target.getAttribute('data-k'); if (!k || k === 'cityq') return;
      if (k === 'src') { const keep = { act: r.act, pct: r.pct, cool: r.cool }; for (const x of Object.keys(r)) delete r[x]; Object.assign(r, keep, { src: e.target.value, op: Object.keys(WR.SRC[e.target.value].ops)[0] }); if (r.src === 'price') r.asset = 'SOL'; if (r.src === 'events') r.cat = 'war'; return paint(); }
      if (k === 'league') { r.league = e.target.value; r.team = null; return paint(); }
      if (k === 'cat') { r.cat = e.target.value; r.market = null; return paint(); }
      if (k === 'market') { const o = e.target.selectedOptions[0]; r.market = e.target.value ? { id: e.target.value, q: o.dataset.q || o.textContent, slug: o.dataset.slug || '' } : null; return fire(); }
      if (k === 'team') { const o = e.target.selectedOptions[0]; r.team = e.target.value ? { id: e.target.value, name: o.textContent } : null; return fire(); }
      if (k === 'op' || k === 'win' || k === 'asset' || k === 'act') { r[k] = e.target.value; if (k === 'op') { r.value = ''; return paint(); } return fire(); }
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('.dd button[data-i]');
      if (b) { const g = b.parentNode._list[+b.dataset.i]; r.city = { name: g.name, country: g.country, lat: g.lat, lon: g.lon }; $('[data-k=cityq]', el).value = g.name; b.parentNode.hidden = true; fire(); }
      if (e.target.closest('[data-rm]')) { el.remove(); opts.remove && opts.remove(); }
    });
    document.addEventListener('click', e => { if (!el.contains(e.target)) { const dd = $('.dd', el); if (dd) dd.hidden = true; } });
    paint();
    return { el, get: () => { try { return WR.normalize(r); } catch { return null; } }, raw: () => r, set: v => { for (const x of Object.keys(r)) delete r[x]; Object.assign(r, v); paint(); } };
  }

  // nudge the engine: every visit helps keep it awake (the server allows one pass a minute)
  function nudge() { try { if (!sessionStorage.getItem('wrld:n')) { sessionStorage.setItem('wrld:n', '1'); fetch('/api/tick', { keepalive: true }).catch(() => {}); } } catch {} }

  // reveal on scroll, with a sweep so anchor jumps never leave sections hidden
  function reveal() {
    const els = $$('.rv'); if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('vis')); return; }
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('vis'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -6% 0px' });
    els.forEach(e => io.observe(e));
    const sweep = () => els.forEach(e => { if (e.getBoundingClientRect().top < innerHeight) e.classList.add('vis'); });
    addEventListener('hashchange', sweep); addEventListener('scroll', sweep, { passive: true }); setTimeout(sweep, 60);
  }
  function typePrompt(el, text) {
    if (!el) return; const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.innerHTML = '<span class="gt">&gt;</span><span class="tx"></span><span class="cur u"></span>';
    const tx = $('.tx', el); if (reduce) { tx.textContent = text; return; }
    let i = 0; const go = () => { tx.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(go, 26 + Math.random() * 40); }; setTimeout(go, 300);
  }
  // the official-token strip (both states)
  function caStrip(el) {
    if (!el) return;
    if (CONFIG.ca) el.innerHTML = `<span class="k">$WRLD</span><code>${esc(CONFIG.ca)}</code><span class="r"><a class="br sm" href="#" data-copy="${esc(CONFIG.ca)}" data-what="Contract copied">copy</a><a class="br sm" href="https://pump.fun/coin/${esc(CONFIG.ca)}" target="_blank" rel="noopener">pump.fun</a>${CONFIG.x ? `<a class="br sm" href="${esc(CONFIG.x)}" target="_blank" rel="noopener">x</a>` : ''}</span><span></span><span class="dim">anything else posted as $WRLD is not ours.</span>`;
    else el.innerHTML = `<span class="k">$WRLD</span><span>The token doesn’t exist yet. Anyone posting a contract address before it appears here is not us.</span>`;
  }

  api('/api/launch?op=config').then(c => { if (c && c.xApi) window.WRLD_XPOSTS = true; });
  window.WRLD = { $, $$, esc, api, post, usd, pct, sol, ago, hhmm, short, tx, acct, toast, copy, hl, tape, globe, ruleEditor, connect, wallet: () => WAL, wallets, nudge, reveal, typePrompt, caStrip, CONFIG };
})();
