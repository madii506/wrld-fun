/* wrld launcher: coin → rulebook → first buy → one deposit → the engine creates the coin */
(function () {
  const { $, $$, esc, api, post, sol, hl, toast, copy, short } = WRLD;
  const WR = window.WR;
  WRLD.typePrompt($('#prompt'), 'launch a coin, wired to the world'); WRLD.tape(); WRLD.nudge();
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === 'launch'));

  let CFG = { createSol: 0.03, reserveSol: 0.015, minDev: 0.01, maxDev: 10, feeBps: 500, open: true };
  api('/api/launch?op=config').then(c => { if (c && c.ok) { CFG = c; costs(); } });

  // ---------- the rulebook ----------
  const eds = [];
  function count() { $('#rCount').textContent = `${eds.length} / ${WR.MAX_RULES} rules`; $('#addRule').disabled = eds.length >= WR.MAX_RULES; }
  function addRule(init) {
    if (eds.length >= WR.MAX_RULES) return;
    const me = {}; const ed = WRLD.ruleEditor($('#rules'), init || { src: 'price', asset: 'SOL', op: 'above', value: '', act: 'burn', pct: 10, cool: 6 }, () => book(), {
      coin: true, n: () => eds.indexOf(me) + 1, remove: () => { eds.splice(eds.indexOf(me), 1); count(); renumber(); book(); } });
    Object.assign(me, ed); eds.push(me); count(); renumber(); book();
  }
  function renumber() { eds.forEach((e, i) => { const n = $('.n', e.el); if (n) n.textContent = 'rule ' + String(i + 1).padStart(2, '0'); }); }
  function setRules(list) { $('#rules').innerHTML = ''; eds.length = 0; list.forEach(r => addRule(r)); if (!list.length) addRule(); }
  $('#addRule').addEventListener('click', () => addRule());
  $('#tchips').innerHTML = WR.TEMPLATES.map(t => `<button class="br sm" type="button" data-t="${t.id}">${esc(t.name)}</button>`).join('');
  $('#tchips').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; const t = WR.TEMPLATES.find(x => x.id === b.dataset.t); setRules(t.rules.map(r => JSON.parse(JSON.stringify(r)))); toast(t.name + ' loaded'); });

  let bookTimer = null, curRules = [];
  async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  function book() {
    clearTimeout(bookTimer);
    bookTimer = setTimeout(async () => {
      const ok = [], bad = [];
      eds.forEach((e, i) => { const n = e.get(); if (n) ok.push(n); else bad.push(i + 1); });
      curRules = bad.length ? null : ok;
      const name = $('#fName').value.trim() || 'your coin', sym = ($('#fSym').value.trim() || 'TICKER').toUpperCase().replace(/^\$/, '');
      if (!ok.length) { $('#book').innerHTML = '<span class="cm"># add a rule</span>'; $('#fp').textContent = ''; return; }
      const fp = curRules && window.crypto && crypto.subtle ? (await sha(WR.canon(ok))).slice(0, 12) : '';
      $('#fp').textContent = fp ? 'fingerprint ' + fp : '';
      $('#book').innerHTML = hl(WR.book(ok, { name, symbol: sym, fp: fp ? 'fingerprint ' + fp : '' })) + (bad.length ? `\n<span class="cm"># rule ${bad.join(', ')} isn’t finished</span>` : '');
      $('#evals').innerHTML = '';
    }, 120);
  }
  $('#cpBook').addEventListener('click', () => copy($('#book').textContent, 'Rulebook copied'));
  ['#fName', '#fSym'].forEach(s => $(s).addEventListener('input', book));
  $('#evalAll').addEventListener('click', async e => {
    const ok = eds.map(x => x.get()).filter(Boolean); if (!ok.length) { toast('Finish a rule first'); return; }
    e.currentTarget.disabled = true; $('#evals').innerHTML = '<span class="dim">reading the world…</span>';
    const r = await post('/api/world?op=eval', { rules: ok }); e.currentTarget.disabled = false;
    if (!r || !r.ok) { $('#evals').innerHTML = '<span class="red">couldn’t read the world just now</span>'; return; }
    $('#evals').innerHTML = r.results.map((x, i) => `<div style="padding:4px 0;border-bottom:1px dotted var(--line)"><b>${String(i + 1).padStart(2, '0')}</b> ${!x.ok ? '<span class="burn">offline</span>' : x.now ? '<span class="g"><b>TRUE</b></span>' : '<span class="dim">false</span>'} · ${esc(x.text)}${x.src ? ` <a class="u" href="${esc(x.src)}" target="_blank" rel="noopener">source</a>` : ''}</div>`).join('');
  });

  // a rule or rulebook handed over from the home page
  (function fromHash() {
    const h = location.hash.slice(1); const p = new URLSearchParams(h);
    if (p.get('t')) { const t = WR.TEMPLATES.find(x => x.id === p.get('t')); if (t) return setRules(t.rules.map(r => JSON.parse(JSON.stringify(r)))); }
    if (p.get('r')) { try { const list = JSON.parse(decodeURIComponent(escape(atob(p.get('r'))))); if (Array.isArray(list) && list.length) return setRules(list.slice(0, WR.MAX_RULES)); } catch {} }
    setRules([]);
  })();

  // ---------- picture ----------
  let IMG = null;
  $('#fImg').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast('That picture is over 8 MB'); return; }
    const im = new Image(); im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
      const s = Math.max(512 / im.width, 512 / im.height), w = im.width * s, h = im.height * s;
      x.fillStyle = '#f6f3ec'; x.fillRect(0, 0, 512, 512); x.drawImage(im, (512 - w) / 2, (512 - h) / 2, w, h);
      IMG = c.toDataURL('image/jpeg', .88); $('#drop').innerHTML = `<img src="${IMG}" alt="coin picture">`; URL.revokeObjectURL(im.src);
    };
    im.onerror = () => toast('That picture couldn’t be read'); im.src = URL.createObjectURL(f);
  });
  $('#drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fImg').click(); } });

  // ---------- costs ----------
  function needSol(dev) { return Math.ceil((CFG.createSol + dev * 1.02 + CFG.reserveSol) * 1000) / 1000; }
  function costs() {
    const dev = Number($('#fDev').value); $('#devV').textContent = dev.toFixed(2);
    $('#costs').innerHTML = `<tr><td>first buy (+2% for pump.fun fees and slippage)</td><td>${(dev * 1.02).toFixed(4)} SOL</td></tr>
      <tr><td>pump.fun rent and fees for a new coin (unused part comes back)</td><td>${CFG.createSol.toFixed(3)} SOL</td></tr>
      <tr><td>gas reserve kept in the coin’s wallet</td><td>${CFG.reserveSol.toFixed(3)} SOL</td></tr>
      <tr class="t"><td>one deposit</td><td>${needSol(dev).toFixed(3)} SOL</td></tr>`;
  }
  $('#fDev').addEventListener('input', costs); costs();

  // ---------- wallet ----------
  setInterval(() => { const w = WRLD.wallet(); if (w && !$('#fWal').value) $('#fWal').value = w.pk; }, 600);

  // ---------- launch ----------
  const err = m => { const e = $('#err'); e.textContent = m; e.hidden = !m; if (m) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const STEPS = [['rec', 'rulebook recorded'], ['dep', 'deposit received'], ['make', 'coin created on pump.fun'], ['back', 'first buy sent back to you'], ['live', 'the rules are watching']];
  function prog(state) {
    const bad = ['failed', 'refunded', 'expired'].includes(state);
    const at = { waiting: 1, creating: 2, live: 5 }[state] || 1;
    $('#prog').innerHTML = STEPS.map(([k, t], i) => `<div class="s ${bad ? (i === 0 ? 'ok' : i === 1 ? 'bad' : '') : i < at ? 'ok' : i === at ? 'on' : ''}">${esc(t)}</div>`).join('');
  }
  let L = null, poll = null;
  async function sendDeposit() {
    const w = WRLD.wallet() || await WRLD.connect(); if (!w) return;
    if (!L) return;
    try {
      if (!window.solanaWeb3) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/assets/js/web3.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      const { Transaction, SystemProgram, PublicKey } = window.solanaWeb3;
      const bh = await api('/api/launch?op=blockhash'); if (!bh || !bh.ok) throw new Error('Solana didn’t answer. Try again.');
      const from = new PublicKey(w.pk);
      const tx = new Transaction({ feePayer: from, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(L.wallet), lamports: L.need }));
      $('#depMsg').textContent = 'approve the transfer in your wallet…';
      let sig = null;
      if (w.p.signAndSendTransaction) { const r = await w.p.signAndSendTransaction(tx); sig = r && (r.signature || r); }
      else { const s = await w.p.signTransaction(tx); const r = await post('/api/launch?op=relay', { tx: btoa(String.fromCharCode(...s.serialize())) }); if (!r.ok) throw new Error(r.error); sig = r.sig; }
      $('#depMsg').innerHTML = `sent: <a class="u" href="${WRLD.tx(String(sig))}" target="_blank" rel="noopener">${esc(short(String(sig)))}</a>. waiting for it to land…`;
    } catch (e) { $('#depMsg').innerHTML = `<span class="red">${esc((e && e.message) || 'The transfer was cancelled.')}</span> You can also send it from any wallet.`; }
  }
  function depositBox(d) {
    $('#dep').innerHTML = `<div class="box"><div class="bd">
      <div style="margin-bottom:8px">send exactly <b>${d.needSol} SOL</b> to the coin’s wallet:</div>
      <div class="addr"><code>${esc(d.wallet)}</code><button class="br sm" type="button" data-copy="${esc(d.wallet)}" data-what="Wallet copied">copy</button><button class="br sm" type="button" data-copy="${d.needSol}" data-what="Amount copied">copy amount</button></div>
      <div class="cta" style="margin-top:12px"><button class="btn" type="button" id="sendDep">send it with my wallet <span class="k">-&gt;</span></button></div>
      <div id="depMsg" class="dim" style="margin-top:10px;font-size:12.5px">this page checks every few seconds. the engine also checks, so you can close it once the transfer is sent.</div>
      <div class="dim" style="margin-top:8px;font-size:12px">the coin’s address will be <code>${esc(d.mint)}</code>. a launch that isn’t funded within 3 hours is cancelled and anything sent is returned.</div></div></div>`;
    $('#sendDep').addEventListener('click', sendDeposit);
  }
  function done(d) {
    clearInterval(poll); try { localStorage.removeItem('wrld:launch'); } catch {}
    $('#dep').innerHTML = `<div class="msg ok"><b>$${esc(d.symbol)} is live.</b> its rules are watching the world.<div class="cta" style="margin-top:10px"><a class="btn" href="/coin?m=${esc(d.mint)}">open the coin <span class="k">-&gt;</span></a>
      <a class="br" href="https://pump.fun/coin/${esc(d.mint)}" target="_blank" rel="noopener">pump.fun</a>${d.create_sig ? `<a class="br" href="${WRLD.tx(d.create_sig)}" target="_blank" rel="noopener">creation tx</a>` : ''}</div></div>`;
  }
  async function check() {
    if (!L) return;
    const d = await api('/api/launch?op=status&id=' + encodeURIComponent(L.id)); if (!d || !d.ok) return;
    prog(d.state, d);
    if (d.state === 'waiting' && !$('#sendDep')) depositBox(d);
    if (d.state === 'waiting' && d.balance != null && d.balance > 0 && $('#depMsg')) $('#depMsg').textContent = `${(d.balance / 1e9).toFixed(4)} of ${d.needSol} SOL arrived.`;
    if (d.state === 'creating') $('#dep').innerHTML = '<div class="msg ok">deposit in. creating the coin on pump.fun…</div>';
    if (d.state === 'live') done(d);
    if (['failed', 'expired', 'refunded'].includes(d.state)) { clearInterval(poll); try { localStorage.removeItem('wrld:launch'); } catch {}
      $('#dep').innerHTML = `<div class="msg">the launch ${d.state === 'expired' ? 'expired' : 'didn’t go through'}${d.err ? ': ' + esc(d.err.slice(0, 160)) : ''}. ${d.refund_sig ? `your deposit was returned: <a class="u" href="${WRLD.tx(d.refund_sig)}" target="_blank" rel="noopener">refund tx</a>` : 'anything you sent is being returned automatically.'}</div>`; }
  }
  function track(d) { L = d; $('#flow').hidden = false; prog('waiting', d); depositBox(d); clearInterval(poll); poll = setInterval(check, 3500); check(); try { localStorage.setItem('wrld:launch', JSON.stringify({ id: d.id, wallet: d.wallet, need: d.need, needSol: d.needSol, mint: d.mint, symbol: d.symbol })); } catch {} }
  try { const s = JSON.parse(localStorage.getItem('wrld:launch') || 'null'); if (s && s.id) { track(s); toast('Picking up your launch where it left off'); } } catch {}

  $('#go').addEventListener('click', async e => {
    err('');
    const name = $('#fName').value.trim(), symbol = $('#fSym').value.trim().replace(/^\$/, '').toUpperCase();
    if (!name) return err('Give the coin a name.');
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return err('The ticker is 1–10 letters or numbers.');
    if (!IMG) return err('Add a picture for the coin.');
    const raw = eds.map(x => x.get()); if (!raw.length || raw.some(r => !r)) return err('Finish every rule (or remove the unfinished one).');
    const launcher = $('#fWal').value.trim(); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(launcher)) return err('Connect a wallet or paste your Solana address.');
    if (!$('#fOk').checked) return err('Tick the box to confirm you understand how the engine works.');
    const b = e.currentTarget; b.disabled = true; b.textContent = 'recording…';
    const r = await post('/api/launch?op=prepare', { launcher, name, symbol, description: $('#fDesc').value.trim(), twitter: $('#fX').value.trim(), website: $('#fWeb').value.trim(), image: IMG, devBuy: Number($('#fDev').value), rules: raw });
    b.disabled = false; b.innerHTML = 'launch <span class="k">-&gt;</span>';
    if (!r || !r.ok) return err((r && r.error) || 'The launch didn’t record. Try again.');
    track({ ...r, symbol });
    toast('Rulebook ' + r.fp + ' recorded');
  });
})();
