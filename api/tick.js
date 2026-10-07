// GET /api/tick   one engine pass: launches waiting on deposits, then live coins (claim fees, read the world, fire rules).
// Anyone may call it: it is locked so only one pass runs at a time, at most once every 50 seconds. A GitHub Actions
// schedule calls it every five minutes, and every visit to the site nudges it too.
const L = require('./_lib');
const E = require('./_engine');
module.exports = async (req, res) => {
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'engine offline: no database' });
  try { L.send(res, 200, await E.tick(Number(L.query(req).budget) > 0 ? Math.min(45000, Number(L.query(req).budget)) : 40000)); }
  catch (e) { L.send(res, 200, { ok: false, error: String(e && e.message).slice(0, 200) }); }
};
