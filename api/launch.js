// GET  /api/launch?op=config            what launching costs and whether it is open
// POST /api/launch?op=prepare           record the coin and its rulebook; returns the coin's own wallet and the deposit it needs
// GET  /api/launch?op=status&id=        where a launch is (and moves it forward: a full deposit starts the coin)
// GET  /api/launch?op=blockhash         for the wallet that signs the deposit
// POST /api/launch?op=relay {tx}        sends a signed deposit, for wallets that can sign but not send
// GET  /api/launch?op=selftest[&mint=]  builds and simulates a create, a buy and a claim with a throwaway key (no funds move)
const crypto = require('crypto');
const L = require('./_lib');
const E = require('./_engine');
const W = require('../assets/js/rules.js');

const SOL = n => +(n / 1e9).toFixed(4);
async function upload(img, f, site, id) {
  // 1) pump.fun's own IPFS upload, when it still takes them  2) Pinata, when the house has a key  3) this site
  try {
    const fd = new FormData();
    fd.append('file', new Blob([img], { type: 'image/jpeg' }), 'coin.jpg');
    for (const [k, v] of Object.entries({ name: f.name, symbol: f.symbol, description: f.description, twitter: f.twitter || '', telegram: '', website: f.website, showName: 'true' })) fd.append(k, v);
    if (!L.MOCK) {
      const r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: fd, signal: AbortSignal.timeout(12000) });
      const j = await r.json().catch(() => null);
      if (j && j.metadataUri && /^https?:\/\//.test(j.metadataUri)) return { uri: j.metadataUri, via: 'pump.fun ipfs' };
    }
  } catch {}
  const jwt = (process.env.PINATA_JWT || '').trim();
  if (jwt && !L.MOCK) {
    try {
      const put = async (blob, name) => { const fd = new FormData(); fd.append('network', 'public'); fd.append('file', blob, name);
        const r = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt }, body: fd, signal: AbortSignal.timeout(15000) });
        const j = await r.json(); if (!j || !j.data || !j.data.cid) throw new Error('pinata'); return 'https://ipfs.io/ipfs/' + j.data.cid; };
      const image = await put(new Blob([img], { type: 'image/jpeg' }), 'coin.jpg');
      const meta = await put(new Blob([JSON.stringify({ name: f.name, symbol: f.symbol, description: f.description, image, showName: true, createdOn: site, twitter: f.twitter || undefined, website: f.website })], { type: 'application/json' }), 'meta.json');
      return { uri: meta, via: 'pinata ipfs' };
    } catch {}
  }
  return { uri: site + '/m/' + id, via: 'wrld' };
}

async function prepare(req, res) {
  if (L.limited('prep:' + L.ip(req), 8, 600000)) return L.send(res, 200, { ok: false, error: 'Too many launches from here. Wait a few minutes.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'The engine’s records are offline, so launching is paused.' });
  const b = await L.body(req, 2.5 * 1024 * 1024);
  if (b.tooBig) return L.send(res, 200, { ok: false, error: 'That picture is too big. Use one under 1.5 MB.' });
  const launcher = String(b.launcher || '').trim();
  if (!L.isAddr(launcher)) return L.send(res, 200, { ok: false, error: 'Connect a wallet (or paste your address) so the first buy and any refund have somewhere to go.' });
  const name = L.clean(b.name, 32), symbol = L.clean(b.symbol, 10).replace(/^\$/, '').toUpperCase();
  const description = L.clean(b.description, 500);
  if (!name || Buffer.byteLength(name) > 32) return L.send(res, 200, { ok: false, error: 'Give the coin a name of up to 32 characters.' });
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return L.send(res, 200, { ok: false, error: 'The ticker is 1–10 letters or numbers.' });
  if (L.BANNED.test(name + ' ' + symbol + ' ' + description)) return L.send(res, 200, { ok: false, error: 'Pick other words. Those break the house rules.' });
  const tw = String(b.twitter || '').trim(), web = String(b.website || '').trim();
  if (tw && !/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?$/.test(tw)) return L.send(res, 200, { ok: false, error: 'The X link should look like https://x.com/yourcoin.' });
  if (web && !/^https:\/\/[^\s"'<>]{3,200}$/.test(web)) return L.send(res, 200, { ok: false, error: 'The website should start with https://.' });
  const dev = Number(b.devBuy);
  if (!(dev >= E.MIN_DEV && dev <= E.MAX_DEV)) return L.send(res, 200, { ok: false, error: `The first buy is between ${E.MIN_DEV} and ${E.MAX_DEV} SOL.` });
  let rules; try { rules = W.normalizeBook(b.rules); } catch (e) { return L.send(res, 200, { ok: false, error: e.rule ? e.message : 'The rulebook didn’t read right.' }); }
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
  if (!m) return L.send(res, 200, { ok: false, error: 'Add a picture for the coin.' });
  let img; try { img = await require('sharp')(Buffer.from(m[2], 'base64')).rotate().resize(512, 512, { fit: 'cover' }).flatten({ background: '#f6f3ec' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer(); }
  catch { return L.send(res, 200, { ok: false, error: 'That picture couldn’t be read. Try a PNG or JPG.' }); }
  try {
    await L.ready();
    const id = E.newId(); const k = await E.keys(id);
    const wallet = k.wallet.publicKey.toBase58(), mint = k.mint.publicKey.toBase58();
    const fp = crypto.createHash('sha256').update(W.canon(rules)).digest('hex').slice(0, 12);
    const site = L.origin(req);
    const desc = (description ? description + '\n\n' : '') + `Wired to the world on wrld: ${rules.length} rule${rules.length > 1 ? 's' : ''}, rulebook ${fp}. ${site.replace(/^https?:\/\//, '')}/coin?m=${mint}`;
    const up = await upload(img, { name, symbol, description: desc, twitter: tw, website: web || site + '/coin?m=' + mint }, site, id);
    const needL = E.need(dev);
    await L.q(`INSERT INTO wr_coins (id, wallet, mint, launcher, name, symbol, description, twitter, website, img, meta_uri, dev_buy, need, rules, fp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, wallet, mint, launcher, name, symbol, desc, tw || null, web || null, img, up.uri, dev, needL, JSON.stringify(rules), fp]);
    await L.log(id, 'launch', `rulebook ${fp} recorded for $${symbol}; waiting for ${SOL(needL)} SOL`);
    L.send(res, 200, { ok: true, id, wallet, mint, need: needL, needSol: SOL(needL), fp, uri: up.uri, via: up.via, rules: rules.map(W.line) });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The launch didn’t save. Try again.' }); }
}

async function status(req, res) {
  const id = String(L.query(req).id || '');
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id) || !L.dbReady()) return L.send(res, 200, { ok: false, error: 'No such launch.' });
  await L.ready();
  let r = await L.q('SELECT * FROM wr_coins WHERE id=$1', [id]);
  if (!r.length) return L.send(res, 200, { ok: false, error: 'No such launch.' });
  let c = r[0], bal = null, note = null;
  if (['waiting', 'creating', 'failed', 'expired'].includes(c.state)) {
    try { const a = await E.advance(c); if (a && a.balance != null) bal = a.balance; if (a && a.error) note = a.error; } catch (e) { note = String(e.message).slice(0, 160); }
    c = (await L.q('SELECT * FROM wr_coins WHERE id=$1', [id]))[0];
  }
  if (bal == null && c.state === 'waiting') bal = await L.balance(c.wallet).catch(() => null);
  const logs = await L.q(`SELECT kind, text, sig, at FROM wr_log WHERE id=$1 ORDER BY n DESC LIMIT 12`, [id]);
  L.send(res, 200, { ok: true, id: c.id, state: c.state, wallet: c.wallet, mint: c.mint, symbol: c.symbol, need: Number(c.need), needSol: SOL(Number(c.need)), balance: bal,
    create_sig: c.create_sig, out_sig: c.out_sig, refund_sig: c.refund_sig, err: c.err, note, logs });
}

async function relay(req, res) {
  if (L.limited('relay:' + L.ip(req), 10, 600000)) return L.send(res, 200, { ok: false, error: 'Too many from here.' });
  const b = await L.body(req, 4096);
  try {
    const { Transaction, SystemProgram } = require('@solana/web3.js');
    const buf = Buffer.from(String(b.tx || ''), 'base64'); const tx = Transaction.from(buf);
    const to = tx.instructions.filter(i => i.programId.equals(SystemProgram.programId)).map(i => i.keys[1] && i.keys[1].pubkey.toBase58()).filter(Boolean);
    if (!to.length) return L.send(res, 200, { ok: false, error: 'That isn’t a deposit.' });
    await L.ready();
    const ok = await L.q(`SELECT 1 FROM wr_coins WHERE wallet = ANY($1) AND state='waiting'`, [to]);
    if (!ok.length) return L.send(res, 200, { ok: false, error: 'That deposit isn’t for a launch that is waiting.' });
    const sig = await E.sendRaw(buf);
    L.send(res, 200, { ok: true, sig });
  } catch (e) { L.send(res, 200, { ok: false, error: 'Sending failed: ' + String(e.message).slice(0, 140) }); }
}

async function selftest(req, res) {
  if (L.limited('st:' + L.ip(req), 6, 600000)) return L.send(res, 200, { ok: false, error: 'Wait a few minutes.' });
  const { Keypair } = require('@solana/web3.js');
  const sim = async tx => { const j = await L.rpcRaw('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }]);
    const v = j.result && j.result.value; return { err: v ? v.err : j.error && j.error.message, logs: v && v.logs ? v.logs.slice(-4) : [] }; };
  const out = {}; const w = Keypair.generate(), mk = Keypair.generate();
  const step = async (name, fn) => { const t0 = Date.now(); try { out[name] = { ok: true, ...(await fn()), ms: Date.now() - t0 }; } catch (e) { out[name] = { ok: false, error: String(e.message).slice(0, 200), ms: Date.now() - t0 }; } };
  await step('create', async () => { const tx = await E.portal({ publicKey: w.publicKey.toBase58(), action: 'create', tokenMetadata: { name: 'wrld selftest', symbol: 'TEST', uri: L.origin(req) + '/m/selftest' }, mint: mk.publicKey.toBase58(), denominatedInSol: 'true', amount: 0.01, slippage: 10, priorityFee: 0.0001, pool: 'pump' }, [mk, w]);
    return { bytes: tx.serialize().length, signers: tx.signatures.length, sim: await sim(tx) }; });
  const mint = L.isAddr(String(L.query(req).mint || '')) ? String(L.query(req).mint) : null;
  if (mint) await step('buy', async () => { const tx = await E.portal({ publicKey: w.publicKey.toBase58(), action: 'buy', mint, denominatedInSol: 'true', amount: 0.01, slippage: 15, priorityFee: 0.0001, pool: 'auto' }, [w]); return { bytes: tx.serialize().length, sim: await sim(tx) }; });
  await step('claim', async () => { const tx = await E.portal({ publicKey: w.publicKey.toBase58(), action: 'collectCreatorFee', priorityFee: 0.00001, pool: 'pump' }, [w]); return { bytes: tx.serialize().length, sim: await sim(tx) }; });
  await step('keys', async () => { if (!L.dbReady()) return { db: false }; const a = await E.keys('selftest-x'), b2 = await E.keys('selftest-x'); return { stable: a.wallet.publicKey.equals(b2.wallet.publicKey), distinct: !a.wallet.publicKey.equals(a.mint.publicKey) }; });
  L.send(res, 200, { ok: true, note: 'throwaway keys, nothing is sent; insufficient-funds errors in the simulation are expected', ...out });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  const op = String(L.query(req).op || 'config');
  try {
    if (req.method === 'POST' && op === 'prepare') return prepare(req, res);
    if (req.method === 'POST' && op === 'relay') return relay(req, res);
    if (op === 'status') return status(req, res);
    if (op === 'blockhash') return L.send(res, 200, { ok: true, ...(await E.blockhash()) });
    if (op === 'selftest') return selftest(req, res);
    L.send(res, 200, { ok: true, open: L.dbReady(), feeBps: L.FEE_BPS, feeTaken: !!L.STUDIO, reserveSol: E.RESERVE / 1e9, createSol: E.CREATE_COST / 1e9, minDev: E.MIN_DEV, maxDev: E.MAX_DEV,
      xApi: !!(process.env.X_BEARER || '').trim() }, L.CACHE(60));
  } catch (e) { L.send(res, 200, { ok: false, error: 'Something broke: ' + String(e && e.message).slice(0, 120) }); }
};
