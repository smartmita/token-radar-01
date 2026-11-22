/**
 * Shared empirical valuation, peer token-rate, and costed farm-plan engine.
 * Executed identically by Node (lib/model.ts) and the browser dashboard.
 */
((root) => {
  'use strict';

  const DAY_MS = 86_400_000, DEF_CAP = 1000, POOL_SHARE = 0.08, TVL_EXP = 0.78, CARRY_RATE = 0.04;
  const VER_RE = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
  const WRAP_RE = /\b(?:wrapped|staked|staking)\b/i;
  const CEX_RE = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const EXCL_CATS = new Set([
    'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
    'Liquid Staking', 'Liquid Restaking', 'Restaked BTC',
    'Staking Pool', 'Stablecoin Wrapper', 'CEX',
  ]);
  const GAS = Object.fromEntries(
    'Solana:.005,Sui:.005,Aptos:.005,Ripple:.005,Stellar:.005,Sonic:.01,Mantle:.01,Plasma:.01,Unichain:.01,Gnosis:.01,Hyperliquid L1:.01,Hyperliquid:.01,Base:.02,Arbitrum:.02,Optimism:.02,OP_Mainnet:.02,Ink:.02,Monad:.02,Berachain:.02,Robinhood Chain:.02,Tempo:.02,Abstract:.02,Soneium:.02,Polygon:.03,Linea:.03,Scroll:.03,Starknet:.03,Blast:.03,zkSync Era:.03,zkSync:.03,Avalanche:.05,Binance:.06,BSC:.06,Cardano:.08,Rootstock:.15,Tron:.45,Bitcoin:2.5,Ethereum:3.5'
      .split(',').map((s) => { const [k, v] = s.split(':'); return [k, Number(v)]; }),
  );

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const quantile = (sorted, q) => {
    if (!sorted.length) return 0;
    const i = clamp(q, 0, 1) * (sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
  };
  const medianOf = (nums) => (nums.length ? quantile([...nums].sort((a, b) => a - b), 0.5) : 0.25);

  function sectorOf(cat) {
    const s = String(cat || '').toLowerCase();
    if (/(?:curator|allocator|yield|rwa|basis|cedefi)/.test(s)) return 'Yield & Allocators';
    if (/(?:lend|cdp|collateral|credit)/.test(s)) return 'Credit & CDP';
    if (/(?:dex|liquidity|deriv|option|prediction|perp)/.test(s)) return 'Trading & Perps';
    return 'Infra & Other';
  }

  function spearmanCorr(a, b) {
    if (a.length < 3 || a.length !== b.length) return 0;
    const rk = (arr) => {
      const p = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v), out = new Array(arr.length);
      for (let i = 0; i < p.length;) {
        let j = i + 1; while (j < p.length && p[j].v === p[i].v) j++;
        for (let k = i; k < j; k++) out[p[k].i] = (i + 1 + j) / 2;
        i = j;
      }
      return out;
    };
    const ra = rk(a), rb = rk(b), n = a.length;
    const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const xa = ra[i] - ma, xb = rb[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
    return da > 0 && db > 0 ? r4(num / Math.sqrt(da * db)) : 0;
  }

  function solveLinear(A, b) {
    const d = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const diag = Math.abs(M[c][c]) > 1e-12 ? M[c][c] : 1e-12;
      for (let k = c; k <= d; k++) M[c][k] /= diag;
      for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r) => r[d]);
  }

  function ageDaysOf(asOf, listedAt) {
    if (!listedAt) return null;
    const end = Date.parse(`${asOf}T00:00:00Z`), start = Date.parse(`${listedAt}T00:00:00Z`);
    return Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / DAY_MS)) : null;
  }

  const isNoToken = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
  const hasToken = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
  const isCleanPre = (p) => isNoToken(p) && !(p.category && EXCL_CATS.has(p.category)) && !VER_RE.test(p.name) && !WRAP_RE.test(p.name) && !CEX_RE.test(p.name);

  /** Fits Huber IRLS log(mcap) ~ dLogTvl + asinh(7d/10) + dLogAge with hierarchical sector->category EB shrinkage. */
  function fitValuationModel(train, asOf, lams = [0, 3, 12, 8], kSec = 16, kCat = 12) {
    const meanLt = train.length ? train.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / train.length : Math.log(5e7);
    const ages = train.map((p) => ageDaysOf(asOf, p.listed_at)).filter((a) => a !== null);
    const medAge = ages.length ? medianOf(ages) : 365, refAge = Math.log(medAge + 30);
    const feat = (p) => [1, Math.log(Math.max(1, p.tvl_usd)) - meanLt, Math.asinh((p.change_7d ?? 0) / 10), Math.log((ageDaysOf(asOf, p.listed_at) ?? medAge) + 30) - refAge];

    let w = [meanLt + Math.log(0.25), 0.48, 0.05, -0.1];
    const secAdj = new Map(), catAdj = new Map();
    if (train.length >= 6) {
      const X = train.map(feat), y = train.map((p) => Math.log(Math.max(1, p.mcap_usd))), d = 4, wt = new Array(train.length).fill(1);
      for (let it = 0; it < 14; it++) {
        const A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
        for (let i = 0; i < X.length; i++) for (let j = 0; j < d; j++) { b[j] += wt[i] * X[i][j] * y[i]; for (let k = 0; k < d; k++) A[j][k] += wt[i] * X[i][j] * X[i][k]; }
        for (let j = 0; j < d; j++) A[j][j] += lams[j];
        w = solveLinear(A, b);
        for (let i = 0; i < X.length; i++) { const err = Math.abs(y[i] - (w[0] + w[1] * X[i][1] + w[2] * X[i][2] + w[3] * X[i][3])); wt[i] = err <= 1.4 ? 1 : 1.4 / err; }
      }
      const sRes = new Map(), cRes = new Map();
      train.forEach((p, i) => {
        const res = clamp(y[i] - (w[0] + w[1] * X[i][1] + w[2] * X[i][2] + w[3] * X[i][3]), -1.8, 1.8);
        const sec = sectorOf(p.category), cat = p.category || 'Uncategorized';
        if (!sRes.has(sec)) sRes.set(sec, []);
        if (!cRes.has(cat)) cRes.set(cat, []);
        sRes.get(sec).push(res); cRes.get(cat).push({ res, sec });
      });
      for (const [sec, arr] of sRes) secAdj.set(sec, clamp(arr.reduce((a, b) => a + b, 0) / (arr.length + kSec), -0.35, 0.35));
      for (const [cat, items] of cRes) {
        const prior = secAdj.get(items[0].sec) || 0;
        catAdj.set(cat, clamp(prior + items.reduce((s, x) => s + (x.res - prior), 0) / (items.length + kCat), -0.5, 0.5));
      }
    }
    return {
      w, meanLogTvl: meanLt, medianAge: medAge,
      predictComponents: (p) => {
        const f = feat(p), baseSizeLog = w[0] + w[1] * f[1];
        const growthLog = clamp(w[2] * f[2], -0.3, 0.3), ageLog = clamp(w[3] * f[3], -0.45, 0.45);
        const cat = p.category || 'Uncategorized', sec = sectorOf(p.category);
        const catLog = catAdj.has(cat) ? catAdj.get(cat) : (secAdj.get(sec) || 0);
        return {
          logPred: baseSizeLog + growthLog + ageLog + catLog, baseSizeLog,
          growthMult: r4(Math.exp(growthLog)), maturityMult: r4(Math.exp(ageLog)), catAdjMult: r4(Math.exp(catLog)),
          sector: sec, adjSource: catAdj.has(cat) ? 'category' : (secAdj.has(sec) ? 'sector' : 'global'),
        };
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

  /** Fits Ridge logistic model for empirical peer token prevalence. */
  function fitTokenOddsModel(train, asOf) {
    if (train.length < 10) return { w: new Array(7).fill(0), predictProb: () => 0.5 };
    const meanLt = train.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / train.length;
    const ages = train.map((p) => ageDaysOf(asOf, p.listed_at)).filter((a) => a !== null);
    const medAge = ages.length ? medianOf(ages) : 500, gRate = clamp(train.filter(hasToken).length / train.length, 0.05, 0.95);
    const logit = (p) => Math.log(clamp(p, 0.03, 0.97) / (1 - clamp(p, 0.03, 0.97)));
    const catSt = new Map();
    for (const p of train) { const c = p.category || 'Uncategorized', cur = catSt.get(c) || { tok: 0, n: 0 }; cur.n++; if (hasToken(p)) cur.tok++; catSt.set(c, cur); }
    const catRate = (c) => { const st = catSt.get(c || 'Uncategorized'); return st ? (st.tok + 8 * gRate) / (st.n + 8) : gRate; };
    const feat = (p) => { const a = ageDaysOf(asOf, p.listed_at); return [1, Math.log(Math.max(1, p.tvl_usd)) - meanLt, Math.log((a ?? medAge) + 30) - Math.log(medAge + 30), a === null ? 1 : 0, Math.log(Math.max(1, p.chains.length)), Math.asinh((p.change_7d ?? 0) / 10), logit(catRate(p.category)) - logit(gRate)]; };
    const d = 7, w = new Array(d).fill(0), lam = [0, 2, 2, 2, 2, 2, 2];
    for (let it = 0; it < 24; it++) {
      const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const p of train) {
        const x = feat(p), y = hasToken(p) ? 1 : 0, pr = 1 / (1 + Math.exp(-clamp(x.reduce((s, v, j) => s + v * w[j], 0), -18, 18))), wt = Math.max(1e-4, pr * (1 - pr));
        for (let j = 0; j < d; j++) { g[j] += (pr - y) * x[j]; for (let k = 0; k < d; k++) H[j][k] += wt * x[j] * x[k]; }
      }
      for (let j = 0; j < d; j++) { g[j] += lam[j] * w[j]; H[j][j] += lam[j]; }
      const step = solveLinear(H, g); for (let j = 0; j < d; j++) w[j] -= step[j];
    }
    return { w, predictProb: (p) => 1 / (1 + Math.exp(-clamp(feat(p).reduce((s, v, j) => s + v * w[j], 0), -18, 18))) };
  }

  const isYieldBearing = (cat) => /(?:lend|cdp|rwa|basis|yield|curator|allocator|dex|liquidity|farm|restak)/i.test(String(cat || ''));

  function pickCheapestChain(chains) {
    if (!chains || !chains.length) return { chain: 'Ethereum', txFee: 3.5, chainCount: 1 };
    let best = chains[0], fee = GAS[best] ?? 0.08;
    for (const c of chains) { const f = GAS[c] ?? 0.08; if (f < fee) { fee = f; best = c; } }
    return { chain: best, txFee: r2(Math.max(0.01, fee)), chainCount: chains.length };
  }

  /** Computes dilution-, bridge-, slippage-, and outflow-adjusted net farming EV. */
  function computeFarmEconomics(row, budgetUsd) {
    const cap = Math.max(100, Number(budgetUsd) || DEF_CAP), odds = (row.token_odds_pct || 0) / 100;
    const effTvl = Math.pow(Math.max(1, row.tvl_usd / 1e6), TVL_EXP) * 1e6, isYield = isYieldBearing(row.category);
    const carry = r2(cap * (isYield ? 0.005 : CARRY_RATE) * (row.hold_days / 365));
    const slippage = r2(cap * (/(?:dex|liquidity|deriv|perp)/i.test(String(row.category || '')) ? 0.0012 : 0.0004));
    const c7 = row.change_7d, outMult = c7 !== null && c7 < -15 ? clamp(1 + (c7 + 15) / 100, 0.25, 1) : 1;
    const gross = r2((cap / (effTvl + cap)) * (POOL_SHARE * row.implied_value_usd) * odds * outMult);
    const bridge = Number(row.est_bridge_usd) || 0, cost = r2(row.est_gas_usd + bridge + slippage + carry);
    const netEv = r2(gross - cost), roi = r2((netEv / cap) * 100);
    let verdict = 'SKIP';
    if (c7 !== null && c7 <= -30) verdict = 'SKIP';
    else if (c7 !== null && c7 < -15) verdict = netEv > 0 ? 'SELECTIVE' : 'SKIP';
    else if (netEv >= 12 && roi >= 1.2) verdict = 'STRONG FARM';
    else if (netEv > 0) verdict = 'FARM';
    else if (netEv > -6 && gross > row.est_gas_usd + bridge) verdict = 'SELECTIVE';
    return { ...row, dyn_cap: cap, dyn_carry: carry, dyn_slippage: slippage, dyn_bridge: bridge, dyn_cost: cost, dyn_gross: gross, dyn_ev: netEv, dyn_roi: roi, dyn_verdict: verdict, dyn_yield_offset: isYield };
  }

  /** Generates protocol-specific, fully costed farming steps (3..12 steps, 20..600 chars). */
  function buildFarmPlan(p, ageDays, impliedUsd, tokenOdds, capital = DEF_CAP) {
    const { chain, txFee, chainCount } = pickCheapestChain(p.chains);
    const c7 = p.change_7d, baseHold = ageDays === null ? 45 : (ageDays < 150 ? 60 : ageDays < 365 ? 45 : 30);
    const holdDays = c7 !== null && c7 < -15 ? Math.max(baseHold, 45) : baseHold;
    const stepDays = txFee >= 1 ? 14 : 7, epochs = Math.max(2, Math.ceil(holdDays / stepDays));
    const needsBridge = chain !== 'Ethereum' && p.chains.includes('Ethereum') && chainCount > 1;
    const bridgeUsd = needsBridge ? r2(chain === 'Solana' ? 0.85 : 0.45) : 0;
    const entryTxs = c7 !== null && c7 < -10 ? 2 : 1, txCount = 2 + entryTxs + epochs + 1, estGas = r2(txFee * txCount);
    const econ = computeFarmEconomics({ tvl_usd: p.tvl_usd, implied_value_usd: impliedUsd, token_odds_pct: r2(tokenOdds * 100), category: p.category, change_7d: c7, hold_days: holdDays, est_gas_usd: estGas, est_bridge_usd: bridgeUsd }, capital);
    const cat = String(p.category || '').toLowerCase(), tranche = entryTxs > 1 ? `$${Math.round(capital / 2)} x 2 weekly tranches` : `$${capital} single tranche`;

    let act, maint;
    if (/(?:curator|allocator|rwa|basis|yield)/.test(cat)) { act = `Deposit ${tranche} in ${p.name} vault (${chain})`; maint = `Verify epoch points & compound yield every ${stepDays}d (${epochs} snapshots)`; }
    else if (/(?:lend|cdp|collateral)/.test(cat)) { act = `Supply ${tranche} USDC on ${p.name} (${chain}) at <35% LTV`; maint = `Rebalance LTV & accrue snapshots every ${stepDays}d (${epochs} checks)`; }
    else if (/(?:dex|liquidity|farm)/.test(cat)) { act = `Add ${tranche} to correlated stable/major LP on ${p.name} (${chain})`; maint = `Swap $25+ & harvest fees every ${stepDays}d (${epochs} epochs)`; }
    else if (/(?:deriv|option|prediction|perp)/.test(cat)) { act = `Post ${tranche} margin on ${p.name} (${chain}) for delta-neutral fills`; maint = `Place 1 hedged maker fill every ${stepDays}d (${epochs} epochs)`; }
    else { act = `Stake ${tranche} in ${p.name} core contract (${chain})`; maint = `Log 1 on-chain action every ${stepDays}d (${epochs} epochs)`; }

    const chainHint = chainCount > 1 ? `cheapest of ${chainCount} chains` : 'native chain';
    const s1 = needsBridge ? `Bridge $${capital} USDC to ${chain} (${chainHint}) + $${Math.max(2, Math.ceil(estGas * 2))} gas. Cost: $${bridgeUsd.toFixed(2)} bridge + $${(txFee * 2).toFixed(2)} gas (2 txs). Time: 15m.` : `Fund wallet on ${chain} (${chainHint}) with $${capital} USDC + $${Math.max(1, Math.ceil(estGas * 2))} gas. Cost: $${(txFee * 2).toFixed(2)} gas (2 txs). Time: 10m.`;
    const s2 = `${act}. Cost: $${capital} principal + $${(txFee * entryTxs).toFixed(2)} gas + $${econ.dyn_slippage.toFixed(2)} spread. Time: ${entryTxs > 1 ? '20m (2 fills)' : '12m'}.`;
    const s3 = `${maint}. Cost: $${(txFee * epochs).toFixed(2)} gas (${epochs} txs). Time: ${epochs * 5}m total.`;
    const flowNote = c7 !== null && c7 < -10 ? `defensive pacing (${c7.toFixed(1)}% 7d); exit if 7d < -25%` : (c7 !== null && c7 > 10 ? `capture +${c7.toFixed(1)}% 7d inflow early` : `steady TVL (${c7 !== null ? (c7 >= 0 ? '+' : '') + c7.toFixed(1) + '%' : 'n/a'} 7d)`);
    const s4 = `Hold ${holdDays}d (${flowNote}). Cost: $${econ.dyn_carry.toFixed(2)} ${econ.dyn_yield_offset ? 'net carry drag' : '4% APR carry'}. Time: ${holdDays}d.`;
    const s5 = `Withdraw $${capital} & claim post-TGE on ${chain}. Cost: $${txFee.toFixed(2)} gas (1 tx). Time: 10m. Total cost: $${econ.dyn_cost.toFixed(2)}, Net EV: ${econ.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(econ.dyn_ev).toFixed(2)}.`;
    return { steps: [s1, s2, s3, s4, s5], capitalUsd: capital, estGasUsd: estGas, estBridgeUsd: bridgeUsd, estSlippageUsd: econ.dyn_slippage, carryCostUsd: econ.dyn_carry, totalCostUsd: econ.dyn_cost, grossAirdropUsd: econ.dyn_gross, netEvUsd: econ.dyn_ev, netRoiPct: econ.dyn_roi, holdDays, farmChain: chain, txCount, txFeeUsd: txFee, verdict: econ.dyn_verdict };
  }

  function decomposeImpliedValue(row, coeffs) {
    const baseSizeVal = Math.exp(coeffs.intercept + coeffs.beta_log_tvl * (Math.log(Math.max(1, row.tvl_usd)) - coeffs.mean_log_tvl));
    return { baseSizeVal, reportedVal: row.implied_value_usd, p25Val: row.implied_low_usd, p75Val: row.implied_high_usd, elasticity: coeffs.beta_log_tvl };
  }

  const partitionProtocols = (d) => ({ preTokenCount: d.rows.length, watchlistCount: d.watchlist_count, earlyCount: d.early_count, excludedCount: d.excluded_pretoken_count, liveCompsCount: d.live.length, liveTotalCount: d.live_token_count });

  /** Builds ranked pre-token board, full-model CV metrics, and separated live comparables. */
  function buildRadar(snapshot) {
    const wlSet = new Set(snapshot.watchlist);
    const liveComps = snapshot.protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0 && !(p.category && EXCL_CATS.has(p.category))).sort((a, b) => a.slug.localeCompare(b.slug));
    const oofErr = [], cvPreds = [], cvOrd = [];
    for (let f = 0; f < 5; f++) {
      const tr = liveComps.filter((_, i) => i % 5 !== f), te = liveComps.filter((_, i) => i % 5 === f), m = fitValuationModel(tr, snapshot.as_of);
      for (const p of te) { const lp = m.predictComponents(p).logPred; oofErr.push(Math.log(p.mcap_usd) - lp); cvPreds.push(Math.exp(lp)); cvOrd.push(p); }
    }
    const cv5Metrics = scoreHoldout('5-Fold Out-of-Fold CV', liveComps, cvOrd, cvPreds);
    const withAge = liveComps.map((p) => ({ p, a: ageDaysOf(snapshot.as_of, p.listed_at) })).filter((x) => x.a !== null).sort((x, y) => y.a - x.a || x.p.slug.localeCompare(y.p.slug));
    const cut = Math.max(10, Math.floor(withAge.length * 0.7));
    const tTrain = [...withAge.slice(0, cut).map((x) => x.p), ...liveComps.filter((p) => ageDaysOf(snapshot.as_of, p.listed_at) === null)], tTest = withAge.slice(cut).map((x) => x.p);
    const tModel = fitValuationModel(tTrain, snapshot.as_of);
    const temporalMetrics = scoreHoldout('30% Newest-Listed Holdout', tTrain, tTest, tTest.map((p) => Math.exp(tModel.predictComponents(p).logPred)));
    const fullVal = fitValuationModel(liveComps, snapshot.as_of), sortedErr = [...oofErr].sort((a, b) => a - b);
    const q25 = sortedErr.length > 5 ? quantile(sortedErr, 0.25) : -0.7, q75 = sortedErr.length > 5 ? quantile(sortedErr, 0.75) : 0.7;

    const cleanUniv = snapshot.protocols.filter((p) => !(p.category && EXCL_CATS.has(p.category))).sort((a, b) => a.slug.localeCompare(b.slug));
    const oofP = [], oofY = [];
    for (let f = 0; f < 5; f++) {
      const lm = fitTokenOddsModel(cleanUniv.filter((_, i) => i % 5 !== f), snapshot.as_of);
      for (const p of cleanUniv.filter((_, i) => i % 5 === f)) { oofP.push(lm.predictProb(p)); oofY.push(hasToken(p) ? 1 : 0); }
    }
    let wins = 0, posN = 0, brier = 0;
    for (let i = 0; i < oofP.length; i++) { brier += (oofP[i] - oofY[i]) ** 2; if (oofY[i] === 1) { posN++; for (let j = 0; j < oofP.length; j++) if (oofY[j] === 0) wins += oofP[i] > oofP[j] ? 1 : (oofP[i] === oofP[j] ? 0.5 : 0); } }
    const negN = oofP.length - posN, fullOdds = fitTokenOddsModel(cleanUniv, snapshot.as_of);

    const catCounts = new Map();
    for (const p of liveComps) catCounts.set(p.category || 'Uncategorized', (catCounts.get(p.category || 'Uncategorized') || 0) + 1);
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p])), selected = new Map();
    for (const slug of snapshot.watchlist) if (bySlug.has(slug)) selected.set(slug, bySlug.get(slug));
    let excluded = 0;
    for (const p of snapshot.protocols) {
      if (selected.has(p.slug)) continue;
      if (isCleanPre(p) && p.tvl_usd < snapshot.floor_usd) selected.set(p.slug, p);
      else if (isNoToken(p)) excluded++;
    }

    const ranked = [...selected.values()].map((p) => {
      const vc = fullVal.predictComponents(p), implied = clamp(Math.round(Math.exp(vc.logPred)), 1, 1e14);
      const odds = fullOdds.predictProb(p), age = ageDaysOf(snapshot.as_of, p.listed_at), isWl = wlSet.has(p.slug);
      const farm = buildFarmPlan(p, age, implied, odds, DEF_CAP);
      return { p, isWl, age, implied, low: clamp(Math.round(Math.exp(vc.logPred + q25)), 1, implied), high: clamp(Math.round(Math.exp(vc.logPred + q75)), implied, 1e14), oddsPct: r2(odds * 100), probWtd: Math.max(1, Math.round(implied * odds)), baseVal: Math.round(Math.exp(vc.baseSizeLog)), mult: r4(implied / Math.max(1, p.tvl_usd)), catN: catCounts.get(p.category || 'Uncategorized') || 0, vc, farm };
    }).sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

    const toRow = (x, idx, forBoard) => {
      const val = { applied_multiple: x.mult, category_samples: x.catN, category_adj_mult: x.vc.catAdjMult, growth_multiplier: x.vc.growthMult, maturity_multiplier: x.vc.maturityMult };
      const base = { rank: idx + 1, slug: x.p.slug, name: x.p.name, category: x.p.category, sector: x.vc.sector, adj_source: x.vc.adjSource, chains: x.p.chains, cohort: x.isWl ? 'watchlist' : 'early', tvl_usd: x.p.tvl_usd, change_7d: x.p.change_7d, listed_at: x.p.listed_at, age_days: x.age, implied_value_usd: x.implied, implied_low_usd: x.low, implied_high_usd: x.high, token_odds_pct: x.oddsPct, prob_weighted_fdv_usd: x.probWtd, est_capital_usd: x.farm.capitalUsd, est_gas_usd: x.farm.estGasUsd, est_bridge_usd: x.farm.estBridgeUsd, est_slippage_usd: x.farm.estSlippageUsd, carry_cost_usd: x.farm.carryCostUsd, total_cost_usd: x.farm.totalCostUsd, gross_airdrop_usd: x.farm.grossAirdropUsd, net_ev_usd: x.farm.netEvUsd, net_roi_pct: x.farm.netRoiPct, hold_days: x.farm.holdDays, farm_chain: x.farm.farmChain, farm_verdict: x.farm.verdict, farm_steps: x.farm.steps };
      return forBoard ? { ...base, token_status: 'pre-token', mcap_usd: x.p.mcap_usd, gecko_id: x.p.gecko_id, symbol: x.p.symbol, valuation: { base_size_fdv_usd: x.baseVal, ...val } } : { ...base, tx_count: x.farm.txCount, tx_fee_usd: x.farm.txFeeUsd, ...val };
    };

    const board = ranked.map((x, i) => toRow(x, i, true)), rows = ranked.map((x, i) => toRow(x, i, false));
    const liveAll = snapshot.protocols.filter((p) => !isNoToken(p));
    const live = liveComps.slice().sort((a, b) => b.mcap_usd - a.mcap_usd).map((p) => ({
      slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, sector: sectorOf(p.category), chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, mcap_tvl_ratio: r4(p.mcap_usd / p.tvl_usd), change_7d: p.change_7d, age_days: ageDaysOf(snapshot.as_of, p.listed_at),
    }));

    return {
      board,
      radar: {
        as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model_name: 'Hierarchical Huber IRLS + Peer Rate v5',
        coefficients: { intercept: r4(fullVal.w[0]), beta_log_tvl: r4(fullVal.w[1]), beta_growth_asinh: r4(fullVal.w[2]), beta_log_age: r4(fullVal.w[3]), mean_log_tvl: r4(fullVal.meanLogTvl), median_age_days: Math.round(fullVal.medianAge), oof_q25_log_err: r4(q25), oof_q75_log_err: r4(q75), global_median_mult: r4(medianOf(liveComps.map((p) => p.mcap_usd / p.tvl_usd))) },
        validation: {
          cv_5fold: cv5Metrics, temporal_holdout: temporalMetrics, token_odds_universe: cleanUniv.length, token_odds_live_count: cleanUniv.filter(hasToken).length,
          token_odds_cv_auc: posN > 0 && negN > 0 ? r4(wins / (posN * negN)) : 0.5, token_odds_cv_brier: oofP.length ? r4(brier / oofP.length) : 0.25,
          token_odds_weights: { intercept: r4(fullOdds.w[0]), log_tvl: r4(fullOdds.w[1]), log_age: r4(fullOdds.w[2]), missing_age: r4(fullOdds.w[3]), log_chains: r4(fullOdds.w[4]), growth_asinh: r4(fullOdds.w[5]), category_prior: r4(fullOdds.w[6]) },
        },
        total_protocols: snapshot.protocols.length, watchlist_count: snapshot.watchlist.length, early_count: board.filter((r) => r.cohort === 'early').length,
        excluded_pretoken_count: excluded, live_token_count: liveAll.length, rows, live,
      },
    };
  }

  root.RadarEngine = { fitValuationModel, fitTokenOddsModel, buildFarmPlan, computeFarmEconomics, buildRadar, decomposeImpliedValue, partitionProtocols, isYieldBearingCategory: isYieldBearing, sectorOf };
})(typeof globalThis !== 'undefined' ? globalThis : window);
