/* wrld coin page: rulebook with live readings, the chest, and every action with its transaction */
(function () {
  const { $, $$, esc, api, usd, sol, ago, hl, copy } = WRLD;
  const WR = window.WR;
  WRLD.tape(); WRLD.nudge();
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === 'coins'));
  const key = new URLSearchParams(location.search).get('m') || new URLSearchParams(location.search).get('id') || '';
  const none = m => { $('#none').hidden = false; $('#none').innerHTML = m; };
  if (!key) { none('No coin picked. <a class="u" href="/#coins">see every coin on wrld</a>.'); return; }
  let first = true;
  async function load() {
    const r = await api('/api/coins?m=' + encodeURIComponent(key));
    if (!r || !r.ok) { if (first) none(esc((r && r.error) || 'The records didn’t answer.') + ' <a class="u" href="/#coins">see every coin on wrld</a>.'); return; }
    first = false; const c = r.coin; $('#coin').hidden = false; $('#none').hidden = true;
    document.title = `wrld · $${c.symbol}`;
    $('#cImg').src = c.img; $('#cName').textContent = c.name; $('#cSym').textContent = '$' + c.symbol;
    $('#cState').innerHTML = c.state === 'live' ? `<span class="livedot">live</span> since ${new Date(c.liveAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : esc(c.state);
    $('#cMint').textContent = c.mint; $('#cCopy').onclick = () => copy(c.mint, 'Contract copied');
    $('#lPump').href = 'https://pump.fun/coin/' + c.mint; $('#lDex').href = 'https://dexscreener.com/solana/' + c.mint; $('#lScan').href = WRLD.acct(c.mint);
    $('#sChest').textContent = sol(c.chestSol); $('#sClaim').textContent = sol(c.claimedSol); $('#sSpent').textContent = sol(c.spentSol); $('#sFires').textContent = c.fires || 0; $('#sMcap').textContent = usd(c.mcapUsd);
    $('#cFp').textContent = 'fingerprint ' + c.fp;
    const rules = (c.rulesRaw || []).map(r => { try { return WR.normalize(r); } catch { return null; } });
    $('#cpBook').onclick = () => copy(WR.book(rules.filter(Boolean), { name: c.name, symbol: c.symbol, fp: 'fingerprint ' + c.fp }), 'Rulebook copied');
    $('#rs').innerHTML = rules.map((r, i) => {
      if (!r) return '';
      const s = (c.state_rules || []).find(x => x.rule === i) || {};
      const cool = s.lastFire && Date.now() - new Date(s.lastFire) < r.cool * 36e5;
      const st = cool ? `<b class="crea">cooling</b>fired ${ago(s.lastFire)}` : WR.isEvent(r) ? `<b class="g">watching</b>${s.lastFire ? 'last fired ' + ago(s.lastFire) : 'not fired yet'}`
        : s.streak >= 1 && s.armed ? `<b class="burn">holding ${Math.min(2, s.streak)}/2</b>one more read fires it` : s.armed === false ? `<b class="dim">fired · re-arms</b>when the level drops back` : `<b class="g">armed</b>${s.lastFire ? 'last fired ' + ago(s.lastFire) : 'not fired yet'}`;
      return `<div class="rstate"><span class="i">${String(i + 1).padStart(2, '0')}</span><div><div class="code" style="padding:8px 10px">${hl(WR.line(r))}</div>
        <div class="rd">${esc(WR.words(r))} Max once per ${r.cool}h.</div><div class="rd">${s.reading ? 'last reading: ' + esc(s.reading) + (s.lastRead ? ' · ' + ago(s.lastRead) : '') : 'no reading yet'}</div></div><div class="stt">${st}</div></div>`;
    }).join('');
    const lt = (c.state_rules || []).map(s => s.lastRead).filter(Boolean).sort().pop();
    $('#cTick').textContent = lt ? 'engine last read the world ' + ago(lt) : 'the engine reads the world every few minutes';
    $('#log').innerHTML = r.log.length ? r.log.map(e => `<div class="ev ${esc(e.kind)}"><span class="t">${ago(e.at)}</span><span><span class="kind">${esc(e.kind)}</span>${esc(e.text)}</span>
      <span class="l">${e.src ? `<a class="u" href="${esc(e.src)}" target="_blank" rel="noopener">source</a>` : ''}${e.sig ? `<a class="u" href="${WRLD.tx(e.sig)}" target="_blank" rel="noopener">tx</a>` : ''}</span></div>`).join('') : '<div class="empty">Nothing yet.</div>';
    $('#cWal').textContent = c.wallet; $('#cWalCp').onclick = () => copy(c.wallet, 'Wallet copied'); $('#cWalScan').href = WRLD.acct(c.wallet); $('#cRes').textContent = c.reserveSol;
    $('#cWait').textContent = c.waitingSol != null ? `creator fees waiting to be claimed: ${sol(c.waitingSol)} (claimed once at least 0.003 SOL is waiting)` : '';
  }
  load(); setInterval(() => { if (!document.hidden) load(); }, 20000);
})();
