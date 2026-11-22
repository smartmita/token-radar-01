/**
 * Shared empirical valuation, peer token-odds, and costed farm-plan engine.
 * Executed identically by Node (lib/model.ts -> board.json, data.js) and the browser dashboard.
 */
((root) => {
  'use strict';
  const DAY_MS = 86_400_000, DEF_CAP = 1000, POOL_SHARE = 0.08, TVL_EXP = 0.78, FRIC_RATE = 0.008;
  const VER_RE = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
  const WRAP_RE = /\b(?:wrapped|staked|staking)\b/i;
  const CEX_RE = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Stablecoin Wrapper', 'CEX']);
  const GAS_USD = { Solana: 0.01, Sui: 0.01, Aptos: 0.01, Sonic: 0.01, Hyperliquid: 0.01, 'Hyperliquid L1': 0.01, Base: 0.02, Optimism: 0.02, OP_Mainnet: 0.02, Ink: 0.02, Unichain: 0.02, Monad: 0.02, Arbitrum: 0.03, Blast: 0.03, Starknet: 0.03, Berachain: 0.03, Scroll: 0.04, zkSync: 0.04, 'zkSync Era': 0.04, Polygon: 0.04, Linea: 0.05, Avalanche: 0.08, BSC: 0.08, Binance: 0.08, Tron: 0.45, Bitcoin: 2.5, Ethereum: 3.8 };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const r2 = (v) => Math.round(v * 1e2) / 1e2;

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const idx = clamp(q, 0, 1) * (sorted.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  }
  const medianOf = (nums) => (nums.length ? quantile([...nums].sort((a, b) => a - b), 0.5) : 0.25);

  function spearmanCorr(a, b) {
    if (a.length < 3 || a.length !== b.length) return 0;
    const ranks = (arr) => {
      const p = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v), out = new Array(arr.length);
      for (let i = 0; i < p.length;) {
        let j = i + 1;
        while (j < p.length && p[j].v === p[i].v) j++;
        for (let k = i; k < j; k++) out[p[k].i] = (i + 1 + j) / 2;
        i = j;
      }
      return out;
    };
    const ra = ranks(a), rb = ranks(b), n = a.length;
    const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const xa = ra[i] - ma, xb = rb[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
    return da > 0 && db > 0 ? r4(num / Math.sqrt(da * db)) : 0;
  }

  function solveLinearSystem(A, b) {
    const d = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const dg = Math.abs(M[c][c]) > 1e-12 ? M[c][c] : 1e-12;
      for (let k = c; k <= d; k++) M[c][k] /= dg;
      for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row) => row[d]);
  }

  function solveRidgeRegression(X, y, lambdas) {
    const d = lambdas.length, A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let j = 0; j < d; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < d; k++) A[j][k] += X[i][j] * X[i][k]; }
    }
    for (let j = 0; j < d; j++) A[j][j] += lambdas[j];
    return solveLinearSystem(A, b);
  }

  function computeAgeDays(asOf, listedAt) {
    if (!listedAt) return null;
    const end = Date.parse(`${asOf}T00:00:00Z`), start = Date.parse(`${listedAt}T00:00:00Z`);
    return Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / DAY_MS)) : null;
  }
  const isNoTokenRecord = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
  const hasTokenRecord = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
  const isCleanPreToken = (p) => isNoTokenRecord(p) && !(p.category && EXCL_CATS.has(p.category)) && !VER_RE.test(p.name) && !WRAP_RE.test(p.name) && !CEX_RE.test(p.name);

  /** Fits log(mcap) ~ Δlog(TVL) + asinh(7d/10) + Δlog(Age+30) with Empirical-Bayes category residuals. */
  function fitValuationModel(train, asOf, lamTvl, lamRest, kShrink) {
    const meanLogTvl = train.length ? train.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / train.length : Math.log(5e7);
    const ages = train.map((p) => computeAgeDays(asOf, p.listed_at)).filter((a) => a !== null);
    const medianAge = ages.length ? medianOf(ages) : 365;
    const feat = (p) => {
      const a = computeAgeDays(asOf, p.listed_at);
      return [1, Math.log(Math.max(1, p.tvl_usd)) - meanLogTvl, Math.asinh((p.change_7d ?? 0) / 10), a === null ? 0 : Math.log(a + 30) - Math.log(medianAge + 30)];
    };
    if (train.length < 6) {
      const w = [meanLogTvl + Math.log(0.25), 0.5, 0, 0];
      return { w, meanLogTvl, medianAge, catAdj: new Map(), predictComponents: (p) => ({ logPred: w[0] + w[1] * feat(p)[1], baseSizeLog: w[0] + w[1] * feat(p)[1], growthMult: 1, maturityMult: 1, catAdjMult: 1 }) };
    }
    const X = train.map(feat), y = train.map((p) => Math.log(Math.max(1, p.mcap_usd))), w = solveRidgeRegression(X, y, [0, lamTvl, lamRest, lamRest]);
    const catRes = new Map();
    train.forEach((p, i) => {
      const pred = X[i].reduce((s, v, j) => s + v * w[j], 0), c = p.category || 'Uncategorized';
      (catRes.get(c) || catRes.set(c, []).get(c)).push(y[i] - pred);
    });
    const catAdj = new Map();
    for (const [c, arr] of catRes.entries()) catAdj.set(c, clamp(arr.reduce((a, b) => a + b, 0) / (arr.length + kShrink), -1.4, 1.4));
    return {
      w, meanLogTvl, medianAge, catAdj,
      predictComponents: (p) => {
        const f = feat(p), baseSizeLog = w[0] + w[1] * f[1], growthLog = w[2] * f[2], matLog = w[3] * f[3], catLog = catAdj.get(p.category || 'Uncategorized') || 0;
        return { logPred: baseSizeLog + growthLog + matLog + catLog, baseSizeLog, growthMult: r4(Math.exp(growthLog)), maturityMult: r4(Math.exp(matLog)), catAdjMult: r4(Math.exp(catLog)) };
      },
    };
  }

  function scoreHoldout(name, train, test, preds) {
    const med = medianOf(train.map((p) => p.mcap_usd / p.tvl_usd)), n = Math.max(1, test.length);
    let seM = 0, seN = 0; const apeM = [], apeN = [], acts = [], naives = [];
    for (let i = 0; i < test.length; i++) {
      const p = test[i], pred = Math.max(1, preds[i]), nv = Math.max(1, p.tvl_usd * med), act = p.mcap_usd;
      seM += (Math.log(pred) - Math.log(act)) ** 2; seN += (Math.log(nv) - Math.log(act)) ** 2;
      apeM.push(Math.abs(pred - act) / act); apeN.push(Math.abs(nv - act) / act); acts.push(act); naives.push(nv);
    }
    return { name, sample_count: test.length, model_log_rmse: r4(Math.sqrt(seM / n)), naive_log_rmse: r4(Math.sqrt(seN / n)), model_mdape_pct: r2(medianOf(apeM) * 100), naive_mdape_pct: r2(medianOf(apeN) * 100), model_spearman: spearmanCorr(preds, acts), naive_spearman: spearmanCorr(naives, acts) };
  }

  function selectValuationHyperparams(liveSorted, asOf) {
    if (liveSorted.length < 20) return { lamTvl: 5, lamRest: 60, kShrink: 18 };
    const cands = [{ lamTvl: 1, lamRest: 40, kShrink: 12 }, { lamTvl: 5, lamRest: 60, kShrink: 18 }, { lamTvl: 5, lamRest: 100, kShrink: 24 }, { lamTvl: 15, lamRest: 100, kShrink: 24 }];
    let best = cands[1], bestRmse = Infinity;
    for (const c of cands) {
      let se = 0;
      for (let f = 0; f < 5; f++) {
        const tr = liveSorted.filter((_, i) => i % 5 !== f), te = liveSorted.filter((_, i) => i % 5 === f);
        const m = fitValuationModel(tr, asOf, c.lamTvl, c.lamRest, c.kShrink);
        for (const p of te) se += (m.predictComponents(p).logPred - Math.log(p.mcap_usd)) ** 2;
      }
      const rmse = Math.sqrt(se / liveSorted.length);
      if (rmse < bestRmse) { bestRmse = rmse; best = c; }
    }
    return best;
  }

  /** Fits Ridge logistic model for peer token prevalence (TVL, age, chains, 7d growth, category prior). */
  function fitTokenPrevalenceModel(train, asOf) {
    if (train.length < 10) return { w: new Array(7).fill(0), categoryRate: () => 0.5, predictProb: () => 0.5 };
    const meanLogTvl = train.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / train.length;
    const ages = train.map((p) => computeAgeDays(asOf, p.listed_at)).filter((a) => a !== null);
    const medAge = ages.length ? medianOf(ages) : 500;
    const gRate = clamp(train.filter(hasTokenRecord).length / train.length, 0.05, 0.95);
    const logit = (p) => Math.log(clamp(p, 0.03, 0.97) / (1 - clamp(p, 0.03, 0.97)));
    const catSt = new Map();
    for (const p of train) { const c = p.category || 'Uncategorized', cur = catSt.get(c) || { tok: 0, n: 0 }; cur.n++; if (hasTokenRecord(p)) cur.tok++; catSt.set(c, cur); }
    const categoryRate = (cat) => { const st = catSt.get(cat || 'Uncategorized'); return st ? (st.tok + 8 * gRate) / (st.n + 8) : gRate; };
    const feat = (p) => {
      const a = computeAgeDays(asOf, p.listed_at);
      return [1, Math.log(Math.max(1, p.tvl_usd)) - meanLogTvl, Math.log((a ?? medAge) + 30) - Math.log(medAge + 30), a === null ? 1 : 0, Math.log(Math.max(1, p.chains.length)), Math.asinh((p.change_7d ?? 0) / 10), logit(categoryRate(p.category)) - logit(gRate)];
    };
    const d = 7, w = new Array(d).fill(0), lam = [0, 2, 2, 2, 2, 2, 2];
    for (let it = 0; it < 24; it++) {
      const grad = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const p of train) {
        const x = feat(p), y = hasTokenRecord(p) ? 1 : 0, pr = 1 / (1 + Math.exp(-clamp(x.reduce((s, v, j) => s + v * w[j], 0), -18, 18))), wt = Math.max(1e-4, pr * (1 - pr));
        for (let j = 0; j < d; j++) { grad[j] += (pr - y) * x[j]; for (let k = 0; k < d; k++) H[j][k] += wt * x[j] * x[k]; }
      }
      for (let j = 0; j < d; j++) { grad[j] += lam[j] * w[j]; H[j][j] += lam[j]; }
      const step = solveLinearSystem(H, grad);
      for (let j = 0; j < d; j++) w[j] -= step[j];
    }
    return { w, categoryRate, predictProb: (p) => 1 / (1 + Math.exp(-clamp(feat(p).reduce((s, v, j) => s + v * w[j], 0), -18, 18))) };
  }

  function isYieldBearingCategory(cat) {
    return /(?:lend|cdp|rwa|basis|yield|curator|allocator|dex|liquidity|farm)/i.test(String(cat || ''));
  }

  function pickCheapestChain(chains) {
    if (!chains || !chains.length) return { chain: 'Ethereum', txFee: 3.8, chainCount: 1 };
    let best = chains[0], fee = GAS_USD[best] ?? 0.25;
    for (const c of chains) { const f = GAS_USD[c] ?? 0.25; if (f < fee) { fee = f; best = c; } }
    return { chain: best, txFee: r2(fee), chainCount: chains.length };
  }

  /** Computes dilution- and outflow-risk-adjusted net farming EV for any capital budget. */
  function computeDynamicFarmEconomics(row, budgetUsd) {
    const cap = Math.max(100, Number(budgetUsd) || DEF_CAP), odds = (row.token_odds_pct || 0) / 100;
    const effTvl = Math.pow(Math.max(1, row.tvl_usd / 1e6), TVL_EXP) * 1e6;
    const carryRate = isYieldBearingCategory(row.category) ? 0 : FRIC_RATE;
    const carry = r2(cap * carryRate * (row.hold_days / 365));
    const c7 = row.change_7d, outMult = c7 !== null && c7 < -15 ? clamp(1 + (c7 + 15) / 100, 0.2, 1) : 1;
    const gross = r2((cap / (effTvl + cap)) * (POOL_SHARE * row.implied_value_usd) * odds * outMult);
    const netEv = r2(gross - row.est_gas_usd - carry), roi = r2((netEv / cap) * 100);
    let verdict = 'SKIP';
    if (c7 !== null && c7 <= -30) verdict = 'SKIP';
    else if (c7 !== null && c7 < -15) verdict = netEv > 0 ? 'SELECTIVE' : 'SKIP';
    else if (netEv >= 10 && roi >= 1.0) verdict = 'STRONG FARM';
    else if (netEv > 0) verdict = 'FARM';
    else if (netEv > -8 && gross > row.est_gas_usd) verdict = 'SELECTIVE';
    return { ...row, dyn_cap: cap, dyn_carry: carry, dyn_gross: gross, dyn_ev: netEv, dyn_roi: roi, dyn_verdict: verdict, dyn_active_tvl: effTvl, dyn_yield_offset: carryRate === 0, dyn_outflow_mult: r2(outMult) };
  }

  /** Builds concrete, costed, time-bounded farming steps tailored by category, chain, and 7d outflow risk. */
  function buildProtocolFarmPlan(p, ageDays, impliedUsd, tokenOdds, capital = DEF_CAP) {
    const { chain, txFee, chainCount } = pickCheapestChain(p.chains);
    const baseHold = ageDays === null ? 45 : (ageDays < 150 ? 60 : ageDays < 365 ? 45 : 30);
    const holdDays = p.change_7d !== null && p.change_7d < -15 ? Math.max(baseHold, 45) : baseHold;
    const stepDays = txFee >= 1.0 ? 14 : 7, epochs = Math.max(2, Math.ceil(holdDays / stepDays)), txCount = 4 + epochs;
    const estGas = r2(txFee * txCount), isYield = isYieldBearingCategory(p.category);
    const econ = computeDynamicFarmEconomics({ tvl_usd: p.tvl_usd, implied_value_usd: impliedUsd, token_odds_pct: r2(tokenOdds * 100), category: p.category, change_7d: p.change_7d, hold_days: holdDays, est_gas_usd: estGas }, capital);
    const cat = String(p.category || '').toLowerCase(), chainTag = chainCount > 1 ? `${chain} (cheapest of ${chainCount} chains)` : `${chain} (single-chain)`;
    let core, cadence;
    if (/(?:lend|cdp|collateral)/.test(cat)) {
      core = `Approve & supply $${capital} USDC on ${p.name} (${chain}) at <40% LTV for lender + points tiers`;
      cadence = `Claim/rebalance yield every ${stepDays}d across ${epochs} snapshots for active-lender streaks`;
    } else if (/(?:dex|liquidity|farm)/.test(cat)) {
      core = `Provide $${capital} into a correlated stable/major LP on ${p.name} (${chain}) to minimize IL`;
      cadence = `Route one $25+ swap & compound fees every ${stepDays}d (${epochs}x) for volume + duration tiers`;
    } else if (/(?:rwa|basis|yield|curator|allocator)/.test(cat)) {
      core = `Approve & deposit $${capital} USDC into ${p.name}'s primary yield vault on ${chain} and hold receipt`;
      cadence = `Verify epoch accrual & roll maturing tranches every ${stepDays}d across ${epochs} snapshots`;
    } else if (/(?:deriv|option|prediction)/.test(cat)) {
      core = `Post $${capital} margin on ${p.name} (${chain}) and place delta-neutral low-fee maker/taker fills`;
      cadence = `Execute 1 hedged fill every ${stepDays}d (${epochs} epochs) to qualify for active-trader tiers`;
    } else {
      core = `Deploy $${capital} USDC into ${p.name}'s core contract on ${chain} and confirm receipt custody`;
      cadence = `Log 1 qualifying interaction every ${stepDays}d across ${epochs} epoch snapshots`;
    }
    const evSign = econ.dyn_ev >= 0 ? `+$${econ.dyn_ev.toFixed(2)}` : `-$${Math.abs(econ.dyn_ev).toFixed(2)}`;
    const riskNote = p.change_7d !== null && p.change_7d < -15
      ? `7d outflow ${p.change_7d.toFixed(1)}% triggers ${(econ.dyn_outflow_mult * 100).toFixed(0)}% risk haircut; wait for stability`
      : (isYield ? `base yield offsets carry; gas ~$${estGas.toFixed(2)}` : `gas ~$${estGas.toFixed(2)} + ~$${econ.dyn_carry.toFixed(2)} carry`);
    const steps = [
      `Fund isolated wallet with $${capital} + $${Math.max(1, Math.ceil(estGas * 1.5))} gas on ${chainTag}. Cost: ~$${(txFee * 2).toFixed(2)} setup/bridge gas. Time: 10m.`,
      `${core}. Cost: $${capital} refundable principal + ~$${txFee.toFixed(2)} gas. Time: 15m.`,
      `${cadence}. Cost: ~$${(txFee * epochs).toFixed(2)} (${epochs} txs @ ~$${txFee}/tx). Time: 5m/epoch.`,
      `Hold ${holdDays}d (${epochs} snapshots); ${riskNote}. Verdict: ${econ.dyn_verdict} (gross +$${econ.dyn_gross.toFixed(2)}, net ${evSign}). Time: ${holdDays}d.`,
      `Verify official domain before claiming or unwinding principal post-TGE. Cost: ~$${txFee.toFixed(2)} exit gas. Time: 10m.`,
    ];
    return { steps, capitalUsd: capital, estGasUsd: estGas, carryCostUsd: econ.dyn_carry, grossAirdropUsd: econ.dyn_gross, netEvUsd: econ.dyn_ev, netRoiPct: econ.dyn_roi, holdDays, farmChain: chain, txCount, txFeeUsd: txFee, verdict: econ.dyn_verdict };
  }

  function decomposeImpliedFdv(row, coeffs) {
    const baseSizeFdv = Math.exp(coeffs.intercept + coeffs.beta_log_tvl * (Math.log(Math.max(1, row.tvl_usd)) - coeffs.mean_log_tvl));
    return { baseSizeFdv, modeledFdv: Math.round(baseSizeFdv * (row.growth_multiplier || 1) * (row.maturity_multiplier || 1) * (row.category_adj_mult || 1)), reportedFdv: row.implied_value_usd, p25Fdv: row.implied_low_usd, p75Fdv: row.implied_high_usd, elasticity: coeffs.beta_log_tvl };
  }

  function partitionUniverse(d) {
    return { preTokenCount: d.rows.length, watchlistCount: d.watchlist_count, earlyCount: d.early_count, excludedWrappedCount: d.excluded_pretoken_count, liveCompsCount: d.live.length, liveTotalCount: d.live_token_count };
  }

  /** Builds ranked pre-token board, dual held-out CV metrics, and separated live comparables. */
  function buildRadar(snapshot) {
    const wlSet = new Set(snapshot.watchlist);
    const liveComps = snapshot.protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX').sort((a, b) => a.slug.localeCompare(b.slug));
    const hp = selectValuationHyperparams(liveComps, snapshot.as_of);

    const oofErr = [], cvPreds = [], cvOrd = [];
    for (let f = 0; f < 5; f++) {
      const tr = liveComps.filter((_, i) => i % 5 !== f), te = liveComps.filter((_, i) => i % 5 === f), m = fitValuationModel(tr, snapshot.as_of, hp.lamTvl, hp.lamRest, hp.kShrink);
      for (const p of te) { const lp = m.predictComponents(p).logPred; oofErr.push(Math.log(p.mcap_usd) - lp); cvPreds.push(Math.exp(lp)); cvOrd.push(p); }
    }
    const cv5Metrics = scoreHoldout('5-Fold Out-of-Fold CV', liveComps, cvOrd, cvPreds);

    const withAge = liveComps.map((p) => ({ p, a: computeAgeDays(snapshot.as_of, p.listed_at) })).filter((x) => x.a !== null).sort((x, y) => y.a - x.a || x.p.slug.localeCompare(y.p.slug));
    const cut = Math.max(10, Math.floor(withAge.length * 0.7));
    const tTrain = [...withAge.slice(0, cut).map((x) => x.p), ...liveComps.filter((p) => computeAgeDays(snapshot.as_of, p.listed_at) === null)], tTest = withAge.slice(cut).map((x) => x.p);
    const temporalMetrics = scoreHoldout('30% Newest-Listed Holdout', tTrain, tTest, tTest.map((p) => Math.exp(fitValuationModel(tTrain, snapshot.as_of, hp.lamTvl, hp.lamRest, hp.kShrink).predictComponents(p).logPred)));

    const fullVal = fitValuationModel(liveComps, snapshot.as_of, hp.lamTvl, hp.lamRest, hp.kShrink);
    const sErr = [...oofErr].sort((a, b) => a - b), q25 = sErr.length > 5 ? quantile(sErr, 0.25) : -0.7, q75 = sErr.length > 5 ? quantile(sErr, 0.75) : 0.7;

    const cleanUniv = snapshot.protocols.filter((p) => !(p.category && EXCL_CATS.has(p.category))).sort((a, b) => a.slug.localeCompare(b.slug));
    const oofP = [], oofY = [];
    for (let f = 0; f < 5; f++) {
      const lm = fitTokenPrevalenceModel(cleanUniv.filter((_, i) => i % 5 !== f), snapshot.as_of);
      for (const p of cleanUniv.filter((_, i) => i % 5 === f)) { oofP.push(lm.predictProb(p)); oofY.push(hasTokenRecord(p) ? 1 : 0); }
    }
    let wins = 0, posN = 0, brier = 0;
    for (let i = 0; i < oofP.length; i++) {
      brier += (oofP[i] - oofY[i]) ** 2;
      if (oofY[i] === 1) { posN++; for (let j = 0; j < oofP.length; j++) if (oofY[j] === 0) wins += oofP[i] > oofP[j] ? 1 : (oofP[i] === oofP[j] ? 0.5 : 0); }
    }
    const negN = oofP.length - posN, fullOdds = fitTokenPrevalenceModel(cleanUniv, snapshot.as_of);

    const catN = new Map();
    for (const p of liveComps) catN.set(p.category || 'Uncategorized', (catN.get(p.category || 'Uncategorized') || 0) + 1);
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p])), selected = new Map();
    for (const slug of snapshot.watchlist) if (bySlug.has(slug)) selected.set(slug, bySlug.get(slug));
    let excluded = 0;
    for (const p of snapshot.protocols) {
      if (selected.has(p.slug)) continue;
      if (isCleanPreToken(p) && p.tvl_usd < snapshot.floor_usd) selected.set(p.slug, p);
      else if (isNoTokenRecord(p)) excluded++;
    }

    const raw = [...selected.values()].map((p) => {
      const vc = fullVal.predictComponents(p), implied = clamp(Math.round(Math.exp(vc.logPred)), 1, 1e14);
      const odds = fullOdds.predictProb(p), age = computeAgeDays(snapshot.as_of, p.listed_at), isWl = wlSet.has(p.slug);
      const conv = Math.round(clamp(clamp(Math.log10(Math.max(p.tvl_usd, 1e6) / 5e6) / 2.8, 0, 1) * 32 + clamp(((p.change_7d ?? 0) + 25) / 85, 0, 1) * 20 + clamp((age ?? fullVal.medianAge) / 730, 0, 1) * 18 + clamp((p.chains.length - 1) / 4, 0, 1) * 10 + odds * 12 + (isWl ? 8 : 0), 1, 99));
      const farm = buildProtocolFarmPlan(p, age, implied, odds, DEF_CAP);
      return { p, isWl, age, implied, low: clamp(Math.round(Math.exp(vc.logPred + q25)), 1, implied), high: clamp(Math.round(Math.exp(vc.logPred + q75)), implied, 1e14), oddsPct: r2(odds * 100), probWtd: Math.max(1, Math.round(implied * odds)), baseFdv: Math.round(Math.exp(vc.baseSizeLog)), mult: r4(implied / Math.max(1, p.tvl_usd)), catN: catN.get(p.category || 'Uncategorized') || 0, vc, conv, farm };
    }).sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

    const toRow = (x, i, snap) => {
      const base = { rank: i + 1, slug: x.p.slug, name: x.p.name, category: x.p.category, chains: x.p.chains, cohort: x.isWl ? 'watchlist' : 'early', tvl_usd: x.p.tvl_usd, change_7d: x.p.change_7d, listed_at: x.p.listed_at, age_days: x.age, implied_value_usd: x.implied, implied_low_usd: x.low, implied_high_usd: x.high, token_odds_pct: x.oddsPct, prob_weighted_fdv_usd: x.probWtd, est_capital_usd: x.farm.capitalUsd, est_gas_usd: x.farm.estGasUsd, carry_cost_usd: x.farm.carryCostUsd, gross_airdrop_usd: x.farm.grossAirdropUsd, net_ev_usd: x.farm.netEvUsd, net_roi_pct: x.farm.netRoiPct, hold_days: x.farm.holdDays, farm_chain: x.farm.farmChain, farm_verdict: x.farm.verdict, farm_steps: x.farm.steps };
      if (snap) return { ...base, token_status: 'pre-token', mcap_usd: x.p.mcap_usd, gecko_id: x.p.gecko_id, symbol: x.p.symbol, valuation: { base_size_fdv_usd: x.baseFdv, applied_multiple: x.mult, category_samples: x.catN, category_adj_mult: x.vc.catAdjMult, growth_multiplier: x.vc.growthMult, maturity_multiplier: x.vc.maturityMult, conviction_score: x.conv } };
      return { ...base, tx_count: x.farm.txCount, tx_fee_usd: x.farm.txFeeUsd, applied_multiple: x.mult, category_adj_mult: x.vc.catAdjMult, growth_multiplier: x.vc.growthMult, maturity_multiplier: x.vc.maturityMult, conviction_score: x.conv };
    };
    const board = raw.map((x, i) => toRow(x, i, true)), rows = raw.map((x, i) => toRow(x, i, false));
    const liveAll = snapshot.protocols.filter((p) => !isNoTokenRecord(p));
    const live = liveComps.slice().sort((a, b) => b.mcap_usd - a.mcap_usd).map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, mcap_tvl_ratio: r4(p.mcap_usd / p.tvl_usd), change_7d: p.change_7d, age_days: computeAgeDays(snapshot.as_of, p.listed_at) }));
    const radar = {
      as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model_name: 'Ridge Size-Curve + Peer Token-Odds v3',
      coefficients: { intercept: r4(fullVal.w[0]), beta_log_tvl: r4(fullVal.w[1]), beta_growth_asinh: r4(fullVal.w[2]), beta_log_age: r4(fullVal.w[3]), mean_log_tvl: r4(fullVal.meanLogTvl), median_age_days: Math.round(fullVal.medianAge), lambda_tvl: hp.lamTvl, lambda_rest: hp.lamRest, category_shrinkage_k: hp.kShrink, oof_q25_log_err: r4(q25), oof_q75_log_err: r4(q75), global_median_mult: r4(medianOf(liveComps.map((p) => p.mcap_usd / p.tvl_usd))) },
      validation: { cv_5fold: cv5Metrics, temporal_holdout: temporalMetrics, token_odds_universe: cleanUniv.length, token_odds_live_count: cleanUniv.filter(hasTokenRecord).length, token_odds_cv_auc: posN > 0 && negN > 0 ? r4(wins / (posN * negN)) : 0.5, token_odds_cv_brier: oofP.length ? r4(brier / oofP.length) : 0.25, token_odds_weights: { intercept: r4(fullOdds.w[0]), log_tvl: r4(fullOdds.w[1]), log_age: r4(fullOdds.w[2]), missing_age: r4(fullOdds.w[3]), log_chains: r4(fullOdds.w[4]), growth_asinh: r4(fullOdds.w[5]), category_prior: r4(fullOdds.w[6]) } },
      total_protocols: snapshot.protocols.length, watchlist_count: snapshot.watchlist.length, early_count: board.filter((r) => r.cohort === 'early').length, excluded_pretoken_count: excluded, live_token_count: liveAll.length, rows, live,
    };
    return { board, radar };
  }

  root.RadarEngine = { fitValuationModel, fitTokenPrevalenceModel, buildProtocolFarmPlan, buildRadar, decomposeImpliedFdv, computeDynamicFarmEconomics, partitionUniverse, isYieldBearingCategory };
})(typeof globalThis !== 'undefined' ? globalThis : window);
