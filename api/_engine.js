// The engine. It is custodial, and says so: every coin launched on wrld has its own wallet, derived on this server from
// one master secret, and that wallet is the coin's pump.fun creator. The engine claims the coin's creator fees into it,
// reads the world, and when a rule fires it spends from that wallet exactly as the rulebook says. Every action is a
// public Solana transaction, linked from the coin's page. There is no sell action and no withdraw action.
const crypto = require('crypto');
const L = require('./_lib');
const WD = require('./_world');
const W = require('../assets/js/rules.js');

let web3 = null, spl = null;
const w3 = () => web3 || (web3 = require('@solana/web3.js'));
const sp = () => spl || (spl = require('@solana/spl-token'));

const LAMPORTS = 1e9;
const RESERVE = 0.015 * LAMPORTS;          // stays in every coin wallet for gas and token-account rent
const CREATE_COST = 0.03 * LAMPORTS;       // pump.fun rent for a new coin, plus margin; whatever is unused goes back
const MIN_DEV = 0.01, MAX_DEV = 10;
const CLAIM_MIN = 0.003 * LAMPORTS;        // claim when at least this much is waiting
const MIN_ACTION = 0.002 * LAMPORTS;       // smaller than this, a fire is recorded but nothing is spent
const PORTAL = 'https://pumpportal.fun/api/trade-local';
const PRIORITY = Number(process.env.PRIORITY_FEE || 0.0002);
const need = devBuy => Math.ceil((CREATE_COST + devBuy * 1.02 * LAMPORTS + RESERVE) / 1e6) * 1e6;   // rounded up to 0.001 SOL

// ---------- keys: derived, never stored ----------
let MASTER = null;
async function master() {
  if (MASTER) return MASTER;
  if (process.env.WRLD_MASTER && process.env.WRLD_MASTER.length >= 32) return (MASTER = process.env.WRLD_MASTER);
  await L.ready();
  await L.q(`INSERT INTO wr_meta (k, v) VALUES ('master', $1) ON CONFLICT (k) DO NOTHING`, [crypto.randomBytes(32).toString('hex')]);
  const r = await L.q(`SELECT v FROM wr_meta WHERE k='master'`);
  return (MASTER = r[0].v);
}
async function keys(id) {
  const m = await master(); const { Keypair } = w3();
  const seed = tag => crypto.createHmac('sha256', m).update(tag + ':' + id).digest();
  return { wallet: Keypair.fromSeed(seed('wallet')), mint: Keypair.fromSeed(seed('mint')) };
}
const newId = () => crypto.randomBytes(9).toString('base64url');

// ---------- sending ----------
async function blockhash() { const r = await L.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]); return r.value; }
async function confirm(sig, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await L.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]);
      const s = r.value && r.value[0];
      if (s) { if (s.err) return { ok: false, err: JSON.stringify(s.err) }; if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return { ok: true }; }
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return { ok: false, err: 'not confirmed in time' };
}
async function sendRaw(bytes, skipPreflight = false) {
  const b64 = Buffer.from(bytes).toString('base64');
  const j = await L.rpcRaw('sendTransaction', [b64, { encoding: 'base64', skipPreflight, maxRetries: 3, preflightCommitment: 'confirmed' }], 20000);
  if (j.error) { const logs = j.error.data && j.error.data.logs; throw new Error((j.error.message || 'send failed') + (logs ? ' | ' + logs.slice(-3).join(' | ') : '')); }
  return j.result;
}
async function sendAndConfirm(bytes) { const sig = await sendRaw(bytes); const c = await confirm(sig); if (!c.ok) { const e = new Error(c.err); e.sig = sig; throw e; } return sig; }
// a plain transaction from a coin wallet (transfers, burns, token moves)
async function sendIxs(payer, ixs) {
  const { Transaction, ComputeBudgetProgram } = w3();
  const bh = await blockhash();
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), ...ixs); tx.sign(payer);
  return sendAndConfirm(tx.serialize());
}
// PumpPortal's local API writes the pump.fun transaction; we sign it here with the coin's own keys
async function portal(args, signers) {
  if (L.MOCK && L.MOCK.portal) return L.MOCK.portal(args);
  const r = await fetch(PORTAL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  if (r.status !== 200) throw new Error('pumpportal ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 160));
  const { VersionedTransaction } = w3();
  const tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
  tx.sign(signers); return tx;
}

// ---------- reading a coin wallet ----------
async function mintInfo(mint) {
  return L.remember('mi:' + mint, 36e5, async () => { const [m] = await L.accounts([mint]); if (!m) throw new Error('mint not found'); return { program: m.owner, decimals: m.data[44] }; });
}
async function tokenBal(owner, mint) {
  const { program } = await mintInfo(mint); const [a] = await L.accounts([L.ataOf(owner, mint, program)]);
  return L.tokenAmount(a);
}
async function waiting(wallet) {   // creator fees waiting to be claimed, in lamports
  const v1 = L.creatorVaultOf(wallet), v2 = L.ammVaultOf(wallet);
  const [a, b] = await L.accounts([v1, L.ataOf(v2, L.SOL, L.TOKEN)]);
  return Math.max(0, (a ? a.lamports - L.RENT0 : 0)) + Number(L.tokenAmount(b));
}

// ---------- the launch ----------
async function create(c) {
  const k = await keys(c.id);
  await L.log(c.id, 'launch', `deposit in. creating $${c.symbol} on pump.fun`);
  let sig;
  try {
    const tx = await portal({ publicKey: k.wallet.publicKey.toBase58(), action: 'create', tokenMetadata: { name: c.name, symbol: c.symbol, uri: c.meta_uri },
      mint: k.mint.publicKey.toBase58(), denominatedInSol: 'true', amount: c.dev_buy, slippage: 10, priorityFee: PRIORITY, pool: 'pump' }, [k.mint, k.wallet]);
    sig = await sendAndConfirm(tx.serialize());
  } catch (e) {
    // it may have landed even though we did not see it confirm
    const [bc] = await L.accounts([L.bondingCurveOf(c.mint)]).catch(() => [null]);
    if (!bc) {
      await L.q(`UPDATE wr_coins SET state='failed', err=$2 WHERE id=$1`, [c.id, String(e.message).slice(0, 300)]);
      await L.log(c.id, 'error', 'launch failed: ' + String(e.message).slice(0, 200), { sig: e.sig });
      await refund(c, 'launch failed, deposit returned');
      return { ok: false, error: String(e.message) };
    }
    sig = e.sig || null;
  }
  await L.q(`UPDATE wr_coins SET state='live', live_at=now(), create_sig=$2, err=NULL WHERE id=$1`, [c.id, sig]);
  await L.log(c.id, 'launch', `$${c.symbol} is live on pump.fun`, { sig });
  // the rules start watching from this moment: anything the world did before launch doesn't count
  const rules = c.rules;
  for (let i = 0; i < rules.length; i++) await L.q(`INSERT INTO wr_state (id, rule, last_read) VALUES ($1,$2,now()) ON CONFLICT DO NOTHING`, [c.id, i]);
  await handOut(c, k).catch(e => L.log(c.id, 'error', 'sending the first buy back failed: ' + String(e.message).slice(0, 160)));
  return { ok: true, sig };
}
// after launch: the launcher's first-buy tokens and any SOL beyond the reserve go back to the launcher's wallet
async function handOut(c, k) {
  k = k || await keys(c.id);
  const { PublicKey, SystemProgram } = w3(); const S = sp();
  const owner = k.wallet.publicKey, to = new PublicKey(c.launcher), mint = new PublicKey(c.mint);
  const { program, decimals } = await mintInfo(c.mint); const prog = new PublicKey(program);
  const ixs = [];
  const amt = await tokenBal(owner.toBase58(), c.mint);
  if (amt > 0n) {
    const src = new PublicKey(L.ataOf(owner.toBase58(), c.mint, program)), dst = new PublicKey(L.ataOf(c.launcher, c.mint, program));
    ixs.push(S.createAssociatedTokenAccountIdempotentInstruction(owner, dst, to, mint, prog), S.createTransferCheckedInstruction(src, mint, dst, owner, amt, decimals, [], prog));
  }
  const bal = await L.balance(owner.toBase58());
  const extra = bal - RESERVE - 0.0025 * LAMPORTS;        // the reserve stays; ATA rent for the launcher's account is paid from the rest
  if (extra > 0.002 * LAMPORTS) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports: Math.floor(extra) }));
  if (!ixs.length) return null;
  const sig = await sendIxs(k.wallet, ixs);
  await L.q(`UPDATE wr_coins SET out_sig=$2 WHERE id=$1`, [c.id, sig]);
  await L.log(c.id, 'launch', `first buy${extra > 0.002 * LAMPORTS ? ' and unused SOL' : ''} sent to the creator`, { sig, sol: extra > 0 ? extra / LAMPORTS : null });
  return sig;
}
async function refund(c, why) {
  const k = await keys(c.id); const { SystemProgram, PublicKey } = w3();
  const bal = await L.balance(k.wallet.publicKey.toBase58());
  const amt = bal - 10000;
  if (amt <= 0) return null;
  try {
    const sig = await sendIxs(k.wallet, [SystemProgram.transfer({ fromPubkey: k.wallet.publicKey, toPubkey: new PublicKey(c.launcher), lamports: amt })]);
    await L.q(`UPDATE wr_coins SET refund_sig=$2, state=CASE WHEN state='live' THEN state ELSE 'refunded' END WHERE id=$1`, [c.id, sig]);
    await L.log(c.id, 'refund', why, { sig, sol: amt / LAMPORTS });
    return sig;
  } catch (e) { await L.log(c.id, 'error', 'refund failed, will retry: ' + String(e.message).slice(0, 160)); return null; }
}
// move a launch forward: called by the launch page while it waits, and by every engine tick
async function advance(c) {
  if (c.state === 'waiting') {
    const bal = await L.balance(c.wallet);
    if (bal >= Number(c.need) * 0.995) {
      const got = await L.q(`UPDATE wr_coins SET state='creating', ticked_at=now() WHERE id=$1 AND state='waiting' RETURNING *`, [c.id]);
      if (got.length) return create(got[0]);
    } else if (Date.now() - new Date(c.created_at) > 3 * 36e5) {
      await L.q(`UPDATE wr_coins SET state='expired' WHERE id=$1 AND state='waiting'`, [c.id]);
      if (bal > 10000) await refund({ ...c, state: 'expired' }, 'never fully funded, deposit returned');
    }
    return { ok: true, state: 'waiting', balance: bal };
  }
  if (c.state === 'creating' && Date.now() - new Date(c.ticked_at || c.created_at) > 4 * 6e4) {
    const [bc] = await L.accounts([L.bondingCurveOf(c.mint)]);
    if (bc) { await L.q(`UPDATE wr_coins SET state='live', live_at=COALESCE(live_at, now()) WHERE id=$1`, [c.id]); for (let i = 0; i < c.rules.length; i++) await L.q(`INSERT INTO wr_state (id, rule, last_read) VALUES ($1,$2,now()) ON CONFLICT DO NOTHING`, [c.id, i]); }
    else { await L.q(`UPDATE wr_coins SET state='failed', err='creation did not land' WHERE id=$1`, [c.id]); await refund(c, 'launch did not land, deposit returned'); }
  }
  if ((c.state === 'expired' || c.state === 'failed') && !c.refund_sig) { const bal = await L.balance(c.wallet); if (bal > 10000) await refund(c, 'deposit returned'); }
  return { ok: true, state: c.state };
}

// ---------- fees ----------
async function claim(c, k) {
  const w = await waiting(c.wallet);
  if (w < CLAIM_MIN) return 0;
  const before = await L.balance(c.wallet);
  const tx = await portal({ publicKey: c.wallet, action: 'collectCreatorFee', priorityFee: 0.00001, pool: 'pump' }, [k.wallet]);
  const sig = await sendAndConfirm(tx.serialize());
  const got = Math.max(0, (await L.balance(c.wallet)) - before);
  if (got <= 0) return 0;
  await L.q(`UPDATE wr_coins SET claimed = claimed + $2 WHERE id=$1`, [c.id, got]);
  await L.log(c.id, 'claim', `claimed ${(got / LAMPORTS).toFixed(4)} SOL of creator fees into the chest`, { sig, sol: got / LAMPORTS });
  const cut = Math.floor(got * L.FEE_BPS / 1e4);
  if (L.STUDIO && cut >= 100000) {
    const { SystemProgram, PublicKey } = w3();
    const s2 = await sendIxs(k.wallet, [SystemProgram.transfer({ fromPubkey: k.wallet.publicKey, toPubkey: new PublicKey(L.STUDIO), lamports: cut })]).catch(() => null);
    if (s2) await L.log(c.id, 'fee', `wrld's 5% (${(cut / LAMPORTS).toFixed(4)} SOL)`, { sig: s2, sol: cut / LAMPORTS });
  }
  return got;
}
async function chest(c) { return Math.max(0, (await L.balance(c.wallet)) - RESERVE); }

// ---------- holders: the largest token accounts, minus pools and the coin's own wallet ----------
async function holders(c) {
  const r = await L.rpc('getTokenLargestAccounts', [c.mint, { commitment: 'confirmed' }]);
  const accts = (r.value || []).filter(a => Number(a.amount) > 0);
  const raw = await L.accounts(accts.map(a => a.address));
  const curve = L.bondingCurveOf(c.mint), out = [];
  raw.forEach((a, i) => {
    const owner = L.tokenOwner(a); if (!owner) return;
    if (owner === c.wallet || owner === curve || !L.onCurve(L.b58dec(owner))) return;   // the chest, the curve and pools (program accounts) are not holders
    out.push({ owner, account: accts[i].address, amount: BigInt(accts[i].amount) });
  });
  return out.slice(0, 20);
}

// ---------- the actions ----------
async function buy(c, k, lamports) {
  const before = await tokenBal(c.wallet, c.mint).catch(() => 0n);
  const tx = await portal({ publicKey: c.wallet, action: 'buy', mint: c.mint, denominatedInSol: 'true', amount: +(lamports / LAMPORTS).toFixed(6), slippage: 15, priorityFee: PRIORITY, pool: 'auto' }, [k.wallet]);
  const sig = await sendAndConfirm(tx.serialize());
  const after = await tokenBal(c.wallet, c.mint);
  return { sig, tokens: after > before ? after - before : 0n };
}
async function act(c, k, rule, lamports) {
  const { PublicKey, SystemProgram } = w3(); const S = sp();
  const owner = k.wallet.publicKey; const sigs = []; const sol = lamports / LAMPORTS;
  if (rule.act === 'creator') {
    sigs.push(await sendIxs(k.wallet, [SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(c.launcher), lamports })]));
    return { sigs, text: `paid the creator ${sol.toFixed(4)} SOL` };
  }
  if (rule.act === 'holders') {
    const hs = await holders(c); if (!hs.length) return { sigs, text: 'no holders to pay yet', skip: true };
    const live = await L.accounts(hs.map(h => h.owner));
    const tot = hs.reduce((s, h) => s + h.amount, 0n);
    const pays = hs.map((h, i) => ({ to: h.owner, lam: Number(BigInt(lamports) * h.amount / tot), ok: live[i] && live[i].lamports > 0 })).filter(p => p.ok && p.lam >= 50000);
    if (!pays.length) return { sigs, text: 'the chest share per holder was too small', skip: true };
    for (let i = 0; i < pays.length; i += 12) sigs.push(await sendIxs(k.wallet, pays.slice(i, i + 12).map(p => SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(p.to), lamports: p.lam }))));
    return { sigs, text: `paid ${pays.length} holders ${(pays.reduce((s, p) => s + p.lam, 0) / LAMPORTS).toFixed(4)} SOL` };
  }
  // burn and airdrop both buy first
  const b = await buy(c, k, lamports); sigs.push(b.sig);
  if (b.tokens <= 0n) return { sigs, text: `bought back with ${sol.toFixed(4)} SOL (no tokens arrived to ${rule.act === 'burn' ? 'burn' : 'drop'})` };
  const { program, decimals } = await mintInfo(c.mint); const prog = new PublicKey(program), mint = new PublicKey(c.mint);
  const src = new PublicKey(L.ataOf(c.wallet, c.mint, program));
  const ui = Number(b.tokens) / 10 ** decimals;
  const fmt = ui >= 1e6 ? (ui / 1e6).toFixed(2) + 'M' : ui >= 1e3 ? (ui / 1e3).toFixed(1) + 'K' : ui.toFixed(0);
  if (rule.act === 'burn') {
    sigs.push(await sendIxs(k.wallet, [S.createBurnCheckedInstruction(src, mint, owner, b.tokens, decimals, [], prog)]));
    return { sigs, text: `bought back ${fmt} $${c.symbol} with ${sol.toFixed(4)} SOL and burned them` };
  }
  const hs = await holders(c); if (!hs.length) { sigs.push(await sendIxs(k.wallet, [S.createBurnCheckedInstruction(src, mint, owner, b.tokens, decimals, [], prog)])); return { sigs, text: `bought back ${fmt} $${c.symbol}; no holders yet, so they were burned` }; }
  const top = hs.slice(0, 16), tot = top.reduce((s, h) => s + h.amount, 0n);
  const drops = top.map(h => ({ h, amt: b.tokens * h.amount / tot })).filter(d => d.amt > 0n);
  for (let i = 0; i < drops.length; i += 6) {
    sigs.push(await sendIxs(k.wallet, drops.slice(i, i + 6).flatMap(d => [S.createTransferCheckedInstruction(src, mint, new PublicKey(d.h.account), owner, d.amt, decimals, [], prog)])));
  }
  return { sigs, text: `bought back ${fmt} $${c.symbol} with ${sol.toFixed(4)} SOL and airdropped them to ${drops.length} holders` };
}

// ---------- one tick for one live coin ----------
async function tickCoin(c, deadline) {
  const k = await keys(c.id);
  if (k.wallet.publicKey.toBase58() !== c.wallet) throw new Error('key mismatch');
  try { await claim(c, k); } catch (e) { await L.log(c.id, 'error', 'claim failed: ' + String(e.message).slice(0, 160)); }
  const m = await WD.coinMarket(c.mint).catch(() => ({ ok: false }));
  if (m.ok) await L.q(`UPDATE wr_coins SET mcap_usd=$2, complete=$3 WHERE id=$1`, [c.id, m.mcapUsd, !!m.complete]);
  const st = await L.q(`SELECT * FROM wr_state WHERE id=$1 ORDER BY rule`, [c.id]);
  for (let i = 0; i < c.rules.length; i++) {
    if (Date.now() > deadline) break;
    const r = c.rules[i]; const s = st.find(x => x.rule === i) || { streak: 0, armed: true, last_key: null, last_fire: null, fails: 0 };
    const ev = await WD.evaluate(r, { since: c.live_at, mint: c.mint });
    if (!ev.ok) { await L.q(`UPDATE wr_state SET reading=$3 WHERE id=$1 AND rule=$2`, [c.id, i, ev.text]); continue; }
    const cooled = !s.last_fire || Date.now() - new Date(s.last_fire) >= r.cool * 36e5;
    let fire = false, streak = s.streak, armed = s.armed;
    if (W.isEvent(r)) fire = ev.now && ev.key && ev.key !== s.last_key && cooled;
    else {
      const spaced = !s.last_read || Date.now() - new Date(s.last_read) > 45000;
      streak = ev.now ? (spaced ? s.streak + 1 : Math.max(1, s.streak)) : 0;
      if (!ev.now) armed = true;
      fire = ev.now && armed && streak >= 2 && cooled;   // a level has to hold for two reads, and fires once per crossing
    }
    await L.q(`UPDATE wr_state SET streak=$3, armed=$4, last_read=now(), reading=$5 WHERE id=$1 AND rule=$2`, [c.id, i, streak, armed, ev.text]);
    if (!fire) continue;
    const pot = await chest(c); const lam = Math.floor(pot * r.pct / 100);
    const mark = async (txt, extra = {}) => {
      await L.q(`UPDATE wr_state SET last_fire=now(), last_key=$3, armed=false, fails=0 WHERE id=$1 AND rule=$2`, [c.id, i, ev.key || s.last_key]);
      await L.q(`UPDATE wr_coins SET fires=fires+1, last_fire_at=now(), spent=spent+$2 WHERE id=$1`, [c.id, extra.spent || 0]);
      await L.log(c.id, 'fire', txt, { rule: i, src: ev.src, sol: extra.spent ? extra.spent / LAMPORTS : null, sig: extra.sig });
    };
    if (lam < MIN_ACTION) { await mark(`rule ${i + 1} fired (${ev.text}) but the chest is ${(pot / LAMPORTS).toFixed(4)} SOL, too small to act`); continue; }
    try {
      const out = await act(c, k, r, lam);
      await mark(`rule ${i + 1} fired: ${ev.text}. ${out.text}`, { spent: out.skip ? 0 : lam, sig: out.sigs[out.sigs.length - 1] });
      for (const sg of out.sigs.slice(0, -1)) await L.log(c.id, 'tx', `rule ${i + 1} step`, { rule: i, sig: sg });
    } catch (e) {
      const fails = (s.fails || 0) + 1;
      await L.q(`UPDATE wr_state SET fails=$3 WHERE id=$1 AND rule=$2`, [c.id, i, fails]);
      await L.log(c.id, 'error', `rule ${i + 1} fired but the action failed (try ${fails}/3): ${String(e.message).slice(0, 140)}`, { rule: i, sig: e.sig });
      if (fails >= 3) await mark(`rule ${i + 1} gave up after 3 failed tries; it re-arms on the next crossing`);
    }
  }
  await L.q(`UPDATE wr_coins SET ticked_at=now() WHERE id=$1`, [c.id]);
}

// ---------- the tick: launches waiting for deposits, then live coins, oldest-ticked first ----------
async function tick(budgetMs = 40000) {
  await L.ready();
  const lock = await L.q(`INSERT INTO wr_meta (k, v) VALUES ('tick', $1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v WHERE wr_meta.v::bigint < $2 RETURNING v`, [String(Date.now()), Date.now() - 50000]);
  if (!lock.length) return { ok: true, skipped: 'another tick is running or ran under a minute ago' };
  const deadline = Date.now() + budgetMs; const done = { launches: 0, coins: 0, errors: 0 };
  const pend = await L.q(`SELECT * FROM wr_coins WHERE state IN ('waiting','creating') OR (state IN ('expired','failed') AND refund_sig IS NULL) ORDER BY created_at LIMIT 20`);
  for (const c of pend) { if (Date.now() > deadline) break; try { await advance(c); done.launches++; } catch { done.errors++; } }
  const live = await L.q(`SELECT * FROM wr_coins WHERE state='live' ORDER BY ticked_at NULLS FIRST LIMIT 30`);
  for (const c of live) { if (Date.now() > deadline - 8000) break; try { await tickCoin(c, deadline); done.coins++; } catch (e) { done.errors++; await L.log(c.id, 'error', 'tick: ' + String(e.message).slice(0, 160)); } }
  return { ok: true, ...done, at: new Date().toISOString() };
}

module.exports = { keys, newId, need, advance, tick, blockhash, sendRaw, confirm, portal, waiting, chest, holders, RESERVE, CREATE_COST, MIN_DEV, MAX_DEV, LAMPORTS };
