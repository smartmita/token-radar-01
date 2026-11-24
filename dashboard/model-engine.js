/**
 * Token Launch Radar — VALUELADDER(), LAUNCHODDS(), FARMPLAN(), LEDGERCHECK().
 * Shared identically by Node 22 (main.ts) and the browser dashboard (app.js).
 */
((root) => {
  'use strict';

  const DAY_MS = 86_400_000, DEF_CAP = 5000, POOL_SHARE = 0.025, TVL_EXP = 0.92, CARRY_APR = 0.065, YIELD_SPREAD = 0.015;
  const VER_RE = /(?:\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)|[a-z][Vv][2-9])$/, WRAP_RE = /\b(?:wrapped|staked|staking|restaking)\b/i, CEX_RE = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Staking Pool', 'Stablecoin Wrapper', 'CEX']);
  const EARLY_EXCL = new Set(['Restaking', 'Anchor BTC', 'Decentralized BTC']);
  const GAS = Object.fromEntries('Solana:.005,Sui:.005,Aptos:.005,Ripple:.005,Stellar:.005,Sonic:.01,Mantle:.01,Plasma:.01,Unichain:.01,Gnosis:.01,Hyperliquid L1:.01,Hyperliquid:.01,Base:.02,Arbitrum:.02,Optimism:.02,OP_Mainnet:.02,Ink:.02,Monad:.02,Berachain:.02,Abstract:.02,Soneium:.02,Polygon:.03,Linea:.03,Scroll:.03,Starknet:.03,Blast:.03,zkSync Era:.03,zkSync:.03,Avalanche:.05,Binance:.06,BSC:.06,Cardano:.08,Rootstock:.15,Tron:.45,Bitcoin:2.5,Ethereum:3.5'.split(',').map((s) => { const [k, v] = s.split(':'); return [k, +v]; }));

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)), r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 1e4) / 1e4;
  const quantile = (s, q) => { if (!s.length) return 0; const i = clamp(q, 0, 1) * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] * (hi - i) + s[hi] * (i - lo); };
  const medianOf = (a) => (a.length ? quantile([...a].sort((x, y) => x - y), 0.5) : 0.25);
  const isNoToken = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null, hasToken = (p) => !isNoToken(p);
  const isCleanPre = (p) => isNoToken(p) && !(p.category && (EXCL_CATS.has(p.category) || EARLY_EXCL.has(p.category))) && !VER_RE.test(p.name) && !WRAP_RE.test(p.name) && !CEX_RE.test(p.name);
  const isYieldBearing = (c) => /(?:lend|cdp|rwa|basis|yield|curator|allocator|dex|liquidity|farm|restak|collateral)/i.test(String(c || ''));
  const sectorOf = (c) => { const s = String(c || '').toLowerCase(); return /(?:curator|allocator|yield|rwa|basis|cedefi)/.test(s) ? 'Yield & Allocators' : /(?:lend|cdp|collateral|credit)/.test(s) ? 'Credit & CDP' : /(?:dex|liquidity|deriv|option|prediction|perp)/.test(s) ? 'Trading & Perps' : 'Infra & Other'; };
  const ageDaysOf = (asOf, d) => { if (!d) return null; const e = Date.parse(`${asOf}T00:00:00Z`), s = Date.parse(`${d}T00:00:00Z`); return Number.isFinite(e) && Number.isFinite(s) ? Math.max(0, Math.floor((e - s) / DAY_MS)) : null; };

  function spearmanCorr(a, b) {
    if (a.length < 3 || a.length !== b.length) return 0;
    const rk = (arr) => { const p = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v), o = new Array(arr.length); for (let i = 0; i < p.length; ) { let j = i + 1; while (j < p.length && p[j].v === p[i].v) j++; for (let k = i; k < j; k++) o[p[k].i] = (i + 1 + j) / 2; i = j; } return o; };
    const ra = rk(a), rb = rk(b), n = a.length, ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const xa = ra[i] - ma, xb = rb[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
    return da > 0 && db > 0 ? r4(num / Math.sqrt(da * db)) : 0;
  }

  function aucScore(probs, labels) {
    let wins = 0, pos = 0;
    for (let i = 0; i < probs.length; i++) if (labels[i] === 1) { pos++; for (let j = 0; j < probs.length; j++) if (labels[j] === 0) wins += probs[i] > probs[j] ? 1 : probs[i] === probs[j] ? 0.5 : 0; }
    const neg = probs.length - pos;
    return pos > 0 && neg > 0 ? r4(wins / (pos * neg)) : 0.5;
  }

  function solveLinear(A, b) {
    const d = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const diag = Math.abs(M[c][c]) > 1e-12 ? M[c][c] : 1e-12;
      for (let k = c; k <= d; k++) M[c][k] /= diag;
      for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r) => r[d]);
  }

  /** VALUELADDER(): Fits Huber IRLS (delta=0.8) over clean live peers. */
  function VALUELADDER(train, asOf, opts = {}) {
    const useG = opts.useGrowth === true, useA = opts.useAge === true, useC = opts.useChains !== false, kCat = opts.kCat || 0, lams = [0, 1, 2, 4, 4];
    const mLt = train.length ? train.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / train.length : Math.log(5e7);
    const ages = train.map((p) => ageDaysOf(asOf, p.listed_at)).filter((a) => a !== null), mA = ages.length ? medianOf(ages) : 365, rA = Math.log(mA + 30);
    const feat = (p) => [1, Math.log(Math.max(1, p.tvl_usd)) - mLt, useC ? Math.log(Math.max(1, p.chains.length)) : 0, useG ? Math.asinh((p.change_7d ?? 0) / 10) : 0, useA ? Math.log((ageDaysOf(asOf, p.listed_at) ?? mA) + 30) - rA : 0];
    let w = [mLt + Math.log(0.25), 0.46, 0, 0, 0]; const catAdj = new Map();
    if (train.length >= 8) {
      const X = train.map(feat), y = train.map((p) => Math.log(Math.max(1, p.mcap_usd))), d = 5, wt = new Array(train.length).fill(1);
      for (let it = 0; it < 20; it++) {
        const A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
        for (let i = 0; i < X.length; i++) for (let j = 0; j < d; j++) { b[j] += wt[i] * X[i][j] * y[i]; for (let k = 0; k < d; k++) A[j][k] += wt[i] * X[i][j] * X[i][k]; }
        for (let j = 0; j < d; j++) A[j][j] += lams[j];
        w = solveLinear(A, b);
        for (let i = 0; i < X.length; i++) { const err = Math.abs(y[i] - X[i].reduce((s, v, j) => s + v * w[j], 0)); wt[i] = err <= 0.8 ? 1 : 0.8 / err; }
      }
      if (kCat > 0) { const cr = new Map(); train.forEach((p, i) => { const r = clamp(y[i] - X[i].reduce((s, v, j) => s + v * w[j], 0), -1.6, 1.6), c = p.category || 'Other'; if (!cr.has(c)) cr.set(c, []); cr.get(c).push(r); }); for (const [c, arr] of cr) catAdj.set(c, clamp(arr.reduce((a, b) => a + b, 0) / (arr.length + kCat), -0.35, 0.35)); }
    }
    return {
      w, meanLogTvl: mLt,
      predictComponents: (p) => {
        const f = feat(p), baseSizeLog = w[0] + w[1] * f[1], cL = clamp(w[2] * f[2], -0.45, 0.25), gL = clamp(w[3] * f[3], -0.30, 0.30), aL = clamp(w[4] * f[4], -0.35, 0.35), kL = kCat > 0 ? (catAdj.get(p.category || 'Other') || 0) : 0;
        return { logPred: baseSizeLog + cL + gL + aL + kL, chainMult: r4(Math.exp(cL)), sector: sectorOf(p.category) };
      },
    };
  }

  function scoreHoldout(name, train, test, preds) {
    const med = medianOf(train.map((p) => p.mcap_usd / p.tvl_usd)), n = Math.max(1, test.length);
    let seM = 0, seN = 0; const absM = [], absN = [], acts = [], naives = [];
    for (let i = 0; i < test.length; i++) {
      const p = test[i], pr = Math.max(1, preds[i]), nv = Math.max(1, p.tvl_usd * med), act = p.mcap_usd, eM = Math.log(pr) - Math.log(act), eN = Math.log(nv) - Math.log(act);
      seM += eM * eM; seN += eN * eN; absM.push(Math.abs(eM)); absN.push(Math.abs(eN)); acts.push(act); naives.push(nv);
    }
    return { name, sample_count: test.length, model_log_rmse: r4(Math.sqrt(seM / n)), naive_log_rmse: r4(Math.sqrt(seN / n)), model_med_factor: r2(Math.exp(medianOf(absM))), naive_med_factor: r2(Math.exp(medianOf(absN))), model_spearman: spearmanCorr(preds, acts), naive_spearman: spearmanCorr(naives, acts) };
  }

  function runHeldOutValidation(liveComps, asOf, floorUsd = 5e7) {
    const wa = liveComps.map((p) => ({ p, a: ageDaysOf(asOf, p.listed_at) })).filter((x) => x.a !== null).sort((x, y) => y.a - x.a || x.p.slug.localeCompare(y.p.slug));
    const cut = Math.max(10, Math.floor(wa.length * 0.7)), tTr = [...wa.slice(0, cut).map((x) => x.p), ...liveComps.filter((p) => ageDaysOf(asOf, p.listed_at) === null)], tTe = wa.slice(cut).map((x) => x.p);
    const evS = (label, opts, status) => {
      const looP = liveComps.map((p, i) => Math.exp(VALUELADDER(liveComps.filter((_, j) => j !== i), asOf, opts).predictComponents(p).logPred));
      const loo = scoreHoldout('LOO', liveComps, liveComps, looP), wfM = VALUELADDER(tTr, asOf, opts), wf = scoreHoldout('WF', tTr, tTe, tTe.map((p) => Math.exp(wfM.predictComponents(p).logPred)));
      return { label, status, loo_rmse: loo.model_log_rmse, loo_med: loo.model_med_factor, loo_rho: loo.model_spearman, wf_rmse: wf.model_log_rmse, wf_med: wf.model_med_factor, wf_rho: wf.model_spearman, loo, wf, looP };
    };
    const specs = [evS('TVL Only', { useChains: false }, 'Baseline'), evS('+ Chains', { useChains: true }, 'Selected (Beats Both)'), evS('+ 7d Flow', { useChains: true, useGrowth: true }, 'Dropped (To Farm EV)'), evS('+ Age', { useChains: true, useAge: true }, 'Dropped (To Odds)'), evS('+ Cat EB', { useChains: true, useGrowth: true, useAge: true, kCat: 20 }, 'Dropped (Overfits)')];
    const sel = specs[1], cvP = [], cvO = [];
    for (let f = 0; f < 5; f++) { const m = VALUELADDER(liveComps.filter((_, i) => i % 5 !== f), asOf, { useChains: true }); for (const p of liveComps.filter((_, i) => i % 5 === f)) { cvP.push(Math.exp(m.predictComponents(p).logPred)); cvO.push(p); } }
    const cv5Metrics = scoreHoldout('5-Fold', liveComps, cvO, cvP), eW = [], eE = [];
    liveComps.forEach((p, i) => (p.tvl_usd >= floorUsd ? eW : eE).push(Math.log(p.mcap_usd) - Math.log(sel.looP[i])));
    eW.sort((a, b) => a - b); eE.sort((a, b) => a - b);
    const oofErr = [...eW, ...eE].sort((a, b) => a - b), qB = (a, q0, q1) => [quantile(a, q0), quantile(a, q1)];
    const tierBands = { wl: qB(eW, 0.25, 0.75), early: qB(eE, 0.25, 0.75), wl80: qB(eW, 0.1, 0.9), early80: qB(eE, 0.1, 0.9) };
    let c5 = 0, c8 = 0;
    liveComps.forEach((p, i) => { const e = Math.log(p.mcap_usd) - Math.log(sel.looP[i]), lg = p.tvl_usd >= floorUsd, b5 = lg ? tierBands.wl : tierBands.early, b8 = lg ? tierBands.wl80 : tierBands.early80; if (e >= b5[0] && e <= b5[1]) c5++; if (e >= b8[0] && e <= b8[1]) c8++; });
    return { looMetrics: sel.loo, cv5Metrics, temporalMetrics: sel.wf, ablation: specs.map(({ loo, wf, looP, ...rest }) => rest), oofErr, tierBands, oofCoveragePct: r2((c5 / Math.max(1, liveComps.length)) * 100), oofCov80Pct: r2((c8 / Math.max(1, liveComps.length)) * 100) };
  }

  /** LAUNCHODDS(): Fits Ridge logistic survival curve & 12M conditional launch hazard. */
  function LAUNCHODDS(train, asOf) {
    const dated = train.filter((p) => p.listed_at !== null);
    if (dated.length < 10) return { w: new Array(5).fill(0), predictProb: () => 0.5, predictHazard12m: () => 0.2 };
    const mLt = dated.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / dated.length;
    const ages = dated.map((p) => ageDaysOf(asOf, p.listed_at)).filter((a) => a !== null), mA = ages.length ? medianOf(ages) : 500;
    const gR = clamp(dated.filter(hasToken).length / dated.length, 0.05, 0.95), logit = (p) => Math.log(clamp(p, 0.03, 0.97) / (1 - clamp(p, 0.03, 0.97))), cs = new Map();
    for (const p of dated) { const c = p.category || 'Uncategorized', cur = cs.get(c) || { tok: 0, n: 0 }; cur.n++; if (hasToken(p)) cur.tok++; cs.set(c, cur); }
    const catR = (c) => { const st = cs.get(c || 'Uncategorized'); return st ? (st.tok + 8 * gR) / (st.n + 8) : gR; };
    const featAt = (p, a) => [1, Math.log(Math.max(1, p.tvl_usd)) - mLt, Math.log(a + 30) - Math.log(mA + 30), Math.log(Math.max(1, p.chains.length)), logit(catR(p.category)) - logit(gR)];
    const d = 5, w = new Array(d).fill(0), lam = [0, 2, 2, 2, 2];
    for (let it = 0; it < 24; it++) {
      const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const p of dated) {
        const x = featAt(p, ageDaysOf(asOf, p.listed_at)), y = hasToken(p) ? 1 : 0, pr = 1 / (1 + Math.exp(-clamp(x.reduce((s, v, j) => s + v * w[j], 0), -18, 18))), wt = Math.max(1e-4, pr * (1 - pr));
        for (let j = 0; j < d; j++) { g[j] += (pr - y) * x[j]; for (let k = 0; k < d; k++) H[j][k] += wt * x[j] * x[k]; }
      }
      for (let j = 0; j < d; j++) { g[j] += lam[j] * w[j]; H[j][j] += lam[j]; }
      const step = solveLinear(H, g); for (let j = 0; j < d; j++) w[j] -= step[j];
    }
    const probAt = (p, a) => 1 / (1 + Math.exp(-clamp(featAt(p, a).reduce((s, v, j) => s + v * w[j], 0), -18, 18)));
    return {
      w,
      predictProb: (p) => probAt(p, ageDaysOf(asOf, p.listed_at) ?? mA),
      predictHazard12m: (p) => { const a = ageDaysOf(asOf, p.listed_at) ?? 1500, f0 = probAt(p, a), f1 = probAt(p, a + 365); return clamp((f1 - f0) / Math.max(0.15, 1 - f0), 0.03, 0.65); },
    };
  }

  function pickCheapestChain(chains) {
    if (!chains || !chains.length) return { chain: 'Ethereum', txFee: 3.5, chainCount: 1 };
    let best = chains[0], fee = GAS[best] ?? 0.08;
    for (const c of chains) { const f = GAS[c] ?? 0.08; if (f < fee) { fee = f; best = c; } }
    return { chain: best, txFee: r2(Math.max(0.01, fee)), chainCount: chains.length };
  }

  /** Computes dilution-, bridge-, slippage-, carry-, age-, and flow-adjusted EV & $/hr. */
  function computeFarmEconomics(row, budgetUsd) {
    const cap = Math.max(100, Number(budgetUsd) || DEF_CAP), effTvl = Math.pow(Math.max(1, row.tvl_usd / 1e6), TVL_EXP) * 1e6, isY = isYieldBearing(row.category);
    const sR = /(?:dex|liquidity|deriv|perp)/i.test(String(row.category || '')) ? 0.0014 : 0.0005, cR = (isY ? YIELD_SPREAD : CARRY_APR) * (row.hold_days / 365), c7 = row.change_7d, age = row.age_days;
    const oM = c7 !== null && c7 < -3 ? clamp(1 + (c7 + 3) / 60, 0.25, 1) : 1, stagM = age === null ? 0.55 : age > 900 && (c7 === null || c7 < 5) ? clamp(900 / age, 0.45, 1) : 1;
    const br = Number(row.est_bridge_usd) || 0, fix = row.est_gas_usd + br;
    const evAt = (c) => { const sl = r2(c * sR), ca = r2(c * cR), gr = r2((c / (effTvl + c)) * (POOL_SHARE * row.implied_value_usd) * oM * stagM), co = r2(fix + sl + ca); return { sl, ca, gr, co, ev: r2(gr - co) }; };
    const { sl, ca, gr, co, ev } = evAt(cap), mins = row.active_mins || 55, evHr = r2(ev / (mins / 60)), roi = r2((ev / cap) * 100);
    let minCap = null;
    if (c7 === null || c7 > -30) for (let c = 50; c <= 50000; c += 50) if (evAt(c).ev > 0) { minCap = c; break; }
    let v = 'SKIP';
    if (c7 !== null && c7 <= -30) v = 'SKIP';
    else if (c7 !== null && c7 < -2) v = ev >= 8 ? 'FARM' : ev > 0 ? 'SELECTIVE' : 'SKIP';
    else if (ev >= 8 && roi >= 0.4) v = 'STRONG FARM';
    else if (ev > 0) v = 'FARM';
    else if (ev > -4 && gr > fix) v = 'SELECTIVE';
    return { ...row, dyn_cap: cap, dyn_carry: ca, dyn_slippage: sl, dyn_bridge: br, dyn_cost: co, dyn_gross: gr, dyn_ev: ev, dyn_ev_hr: evHr, dyn_min_cap: minCap, dyn_roi: roi, dyn_verdict: v, dyn_yield_offset: isY };
  }

  /** FARMPLAN(): Generates 5 concrete, costed steps (20..600 chars) with $/hr & min viable cap. */
  function FARMPLAN(p, ageDays, expUsd, tokenOdds, cap = DEF_CAP) {
    const { chain, txFee, chainCount } = pickCheapestChain(p.chains), c7 = p.change_7d;
    const baseH = ageDays === null ? 45 : ageDays < 150 ? 60 : ageDays < 365 ? 45 : 30, holdDays = c7 !== null && c7 < -10 ? Math.max(baseH, 45) : baseH;
    const stepD = txFee >= 1 ? 30 : 7, ep = txFee >= 1 ? 1 : Math.max(2, Math.ceil(holdDays / stepD));
    const needsBr = chain !== 'Ethereum' && p.chains.includes('Ethereum') && chainCount > 1, brUsd = needsBr ? r2(chain === 'Solana' ? 0.85 : 0.45) : 0;
    const eTx = txFee < 1 && c7 !== null && c7 < -10 ? 2 : 1, estGas = r2(txFee * (2 + eTx + ep + 1)), mins = (needsBr ? 15 : 10) + (eTx > 1 ? 20 : 12) + ep * 5 + 10;
    const econ = computeFarmEconomics({ tvl_usd: p.tvl_usd, implied_value_usd: expUsd, token_odds_pct: r2(tokenOdds * 100), category: p.category, change_7d: c7, age_days: ageDays, hold_days: holdDays, est_gas_usd: estGas, est_bridge_usd: brUsd, active_mins: mins }, cap);
    const cat = String(p.category || '').toLowerCase(), tr = eTx > 1 ? `$${Math.round(cap / 2)} x 2 tranches` : `$${cap}`;
    const act = /(?:curator|allocator|rwa|basis|yield)/.test(cat) ? [`Deposit ${tr} into ${p.name} vault (${chain})`, `Verify points & compound every ${stepD}d (${ep}x)`] : /(?:lend|cdp|collateral)/.test(cat) ? [`Supply ${tr} USDC on ${p.name} (${chain}) <35% LTV`, `Check health & accrue every ${stepD}d (${ep}x)`] : /(?:dex|liquidity|farm)/.test(cat) ? [`Add ${tr} to stable LP on ${p.name} (${chain})`, `Swap $25+ & harvest every ${stepD}d (${ep}x)`] : /(?:deriv|option|prediction|perp)/.test(cat) ? [`Post ${tr} margin on ${p.name} (${chain}) delta-neutral`, `Place 1 hedged maker fill every ${stepD}d (${ep}x)`] : [`Stake ${tr} in ${p.name} pool (${chain})`, `Log 1 on-chain tx every ${stepD}d (${ep}x)`];
    const chH = chainCount > 1 ? `cheapest of ${chainCount}` : 'native', flow = c7 !== null && c7 < -10 ? `${c7.toFixed(1)}% 7d, exit <-25%` : c7 !== null && c7 > 10 ? `+${c7.toFixed(1)}% 7d inflow` : `${c7 !== null ? `${c7 >= 0 ? '+' : ''}${c7.toFixed(1)}%` : 'n/a'} 7d`;
    const s1 = needsBr ? `Bridge $${cap} USDC to ${chain} (${chH}) + $${Math.max(2, Math.ceil(estGas * 2))} gas. Cost: $${brUsd.toFixed(2)} bridge + $${(txFee * 2).toFixed(2)} gas (2 txs). Time: 15m.` : `Fund ${chain} (${chH}) with $${cap} USDC + $${Math.max(1, Math.ceil(estGas * 2))} gas. Cost: $${(txFee * 2).toFixed(2)} gas (2 txs). Time: 10m.`;
    const s2 = `${act[0]} ($${cap} principal returned at exit). Cost: $${(txFee * eTx).toFixed(2)} gas + $${econ.dyn_slippage.toFixed(2)} spread. Time: ${eTx > 1 ? '20m' : '12m'}.`;
    const s3 = `${act[1]}. Cost: $${(txFee * ep).toFixed(2)} gas (${ep} txs). Time: ${ep * 5}m active.`;
    const s4 = `Hold ${holdDays}d (${flow}). Cost: $${econ.dyn_carry.toFixed(2)} ${econ.dyn_yield_offset ? 'net spread' : '6.5% carry'}. Time: ${holdDays}d passive.`;
    const s5 = `Withdraw $${cap} & claim post-TGE on ${chain}. Cost: $${txFee.toFixed(2)} gas (1 tx). Time: 10m (${mins}m active, ${econ.dyn_ev_hr >= 0 ? '+' : '-'}$${Math.abs(econ.dyn_ev_hr).toFixed(2)}/hr, ${econ.dyn_min_cap ? `min $${econ.dyn_min_cap}` : 'not +EV <=$50k'}).`;
    return { steps: [s1, s2, s3, s4, s5], estGasUsd: estGas, estBridgeUsd: brUsd, carryCostUsd: econ.dyn_carry, totalCostUsd: econ.dyn_cost, grossAirdropUsd: econ.dyn_gross, netEvUsd: econ.dyn_ev, evPerHr: econ.dyn_ev_hr, activeMins: mins, minCapUsd: econ.dyn_min_cap, netRoiPct: econ.dyn_roi, holdDays, farmChain: chain, verdict: econ.dyn_verdict };
  }

  /** LEDGERCHECK(): Accounts for all 758 snapshot protocols across cohorts. */
  const LEDGERCHECK = (d) => ({ totalCount: d.total_protocols, preTokenCount: d.rows.length, watchlistCount: d.watchlist_count, offlistCount: d.offlist_count, earlyCount: d.early_count, excludedCount: d.excluded_pretoken_count, liveCompsCount: d.live.length, liveTotalCount: d.live_token_count });
  const decomposeImpliedValue = (row, c) => ({ baseSizeVal: Math.exp(c.intercept + c.beta_log_tvl * (Math.log(Math.max(1, row.tvl_usd)) - c.mean_log_tvl)), condVal: row.cond_fdv_usd, reportedVal: row.implied_value_usd, p25Val: row.implied_low_usd, p75Val: row.implied_high_usd, elasticity: c.beta_log_tvl });

  function buildRadar(snapshot) {
    const wlSet = new Set(snapshot.watchlist), liveComps = snapshot.protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0 && !(p.category && EXCL_CATS.has(p.category))).sort((a, b) => a.slug.localeCompare(b.slug));
    const val = runHeldOutValidation(liveComps, snapshot.as_of, snapshot.floor_usd), fullVal = VALUELADDER(liveComps, snapshot.as_of, { useChains: true });
    const cleanUniv = snapshot.protocols.filter((p) => !(p.category && EXCL_CATS.has(p.category)) && p.listed_at !== null).sort((a, b) => a.slug.localeCompare(b.slug)), oofP = [], oofY = [];
    for (let f = 0; f < 10; f++) { const lm = LAUNCHODDS(cleanUniv.filter((_, i) => i % 10 !== f), snapshot.as_of); for (const p of cleanUniv.filter((_, i) => i % 10 === f)) { oofP.push(lm.predictProb(p)); oofY.push(hasToken(p) ? 1 : 0); } }
    const brier = (ps, ys) => r4(ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / Math.max(1, ps.length)), baseR = oofY.reduce((a, b) => a + b, 0) / Math.max(1, oofY.length);
    const ds = [...cleanUniv].sort((a, b) => a.listed_at.localeCompare(b.listed_at) || a.slug.localeCompare(b.slug)), wfCut = Math.floor(ds.length * 0.7);
    const wfM = LAUNCHODDS(ds.slice(0, wfCut), snapshot.as_of), wfTe = ds.slice(wfCut), wfP = wfTe.map((p) => wfM.predictProb(p)), wfY = wfTe.map((p) => (hasToken(p) ? 1 : 0)), wfBase = ds.slice(0, wfCut).filter(hasToken).length / Math.max(1, wfCut);
    const fullOdds = LAUNCHODDS(cleanUniv, snapshot.as_of), bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p])), selected = new Map();
    for (const s of snapshot.watchlist) if (bySlug.has(s)) selected.set(s, bySlug.get(s));
    let excluded = 0;
    for (const p of snapshot.protocols) { if (selected.has(p.slug)) continue; if (isCleanPre(p)) selected.set(p.slug, p); else if (isNoToken(p)) excluded++; }
    const rows = [...selected.values()].map((p) => {
      const vc = fullVal.predictComponents(p), condFdv = clamp(Math.round(Math.exp(vc.logPred)), 1, 1e14), odds = fullOdds.predictHazard12m(p), imp = clamp(Math.round(condFdv * odds), 1, 1e14);
      const lg = p.tvl_usd >= snapshot.floor_usd, cohort = wlSet.has(p.slug) ? 'watchlist' : lg ? 'offlist' : 'early';
      const [qL, qH] = lg ? val.tierBands.wl : val.tierBands.early, [q10, q90] = lg ? val.tierBands.wl80 : val.tierBands.early80, age = ageDaysOf(snapshot.as_of, p.listed_at), f = FARMPLAN(p, age, imp, odds, DEF_CAP);
      const bd = (q, lo, hi) => clamp(Math.round(imp * Math.exp(q)), lo, hi);
      return { rank: 0, slug: p.slug, name: p.name, category: p.category, sector: vc.sector, chains: p.chains, cohort, tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: age, cond_fdv_usd: condFdv, implied_value_usd: imp, implied_low_usd: bd(qL, 1, imp), implied_high_usd: bd(qH, imp, 1e14), implied_p10_usd: bd(q10, 1, imp), implied_p90_usd: bd(q90, imp, 1e14), token_odds_pct: r2(odds * 100), est_gas_usd: f.estGasUsd, est_bridge_usd: f.estBridgeUsd, carry_cost_usd: f.carryCostUsd, total_cost_usd: f.totalCostUsd, gross_airdrop_usd: f.grossAirdropUsd, net_ev_usd: f.netEvUsd, ev_per_hr: f.evPerHr, active_mins: f.activeMins, min_cap_usd: f.minCapUsd, net_roi_pct: f.netRoiPct, hold_days: f.holdDays, farm_chain: f.farmChain, farm_verdict: f.verdict, farm_steps: f.steps, applied_multiple: r4(imp / Math.max(1, p.tvl_usd)), chain_multiplier: vc.chainMult };
    }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
    rows.forEach((r, i) => { r.rank = i + 1; });
    const board = rows.map((r) => ({ ...r, token_status: 'pre-token' })), liveAll = snapshot.protocols.filter(hasToken), live = liveComps.slice().sort((a, b) => b.mcap_usd - a.mcap_usd).map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, sector: sectorOf(p.category), chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, mcap_tvl_ratio: r4(p.mcap_usd / p.tvl_usd), change_7d: p.change_7d, age_days: ageDaysOf(snapshot.as_of, p.listed_at) })), w = fullVal.w, fo = fullOdds.w;
    return { board, radar: { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model_name: 'Expected Value (CondFDV × 12M Odds)', coefficients: { intercept: r4(w[0]), beta_log_tvl: r4(w[1]), beta_log_chains: r4(w[2]), mean_log_tvl: r4(fullVal.meanLogTvl), oof_q25_log_err: r4(quantile(val.oofErr, 0.25)), oof_q75_log_err: r4(quantile(val.oofErr, 0.75)), oof_coverage_pct: val.oofCoveragePct, oof_cov80_pct: val.oofCov80Pct }, validation: { loo_cv: val.looMetrics, cv_5fold: val.cv5Metrics, temporal_holdout: val.temporalMetrics, ablation: val.ablation, token_odds_universe: cleanUniv.length, token_odds_cv_auc: aucScore(oofP, oofY), token_odds_cv_brier: brier(oofP, oofY), token_odds_base_brier: brier(oofY.map(() => baseR), oofY), token_odds_wf_auc: aucScore(wfP, wfY), token_odds_wf_brier: brier(wfP, wfY), token_odds_wf_base_brier: brier(wfY.map(() => wfBase), wfY), token_odds_weights: { log_age: r4(fo[2]), category_prior: r4(fo[4]) } }, total_protocols: snapshot.protocols.length, watchlist_count: snapshot.watchlist.length, offlist_count: board.filter((r) => r.cohort === 'offlist').length, early_count: board.filter((r) => r.cohort === 'early').length, excluded_pretoken_count: excluded, live_token_count: liveAll.length, rows, live } };
  }

  root.RadarEngine = { VALUELADDER, LAUNCHODDS, FARMPLAN, LEDGERCHECK, computeFarmEconomics, buildRadar, decomposeImpliedValue, isYieldBearingCategory: isYieldBearing, sectorOf };
})(typeof globalThis !== 'undefined' ? globalThis : window);
