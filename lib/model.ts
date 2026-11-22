/**
 * Fitted empirical pre-token valuation, peer token-odds, and costed farm-verdict engine.
 *
 * Fits all valuation weights (TVL size elasticity, 7-day momentum, age maturity,
 * and Empirical-Bayes category residuals) directly from live-token comparables in the
 * sealed snapshot, selects regularization via inner 5-fold cross-validation, verifies
 * performance on two held-out protocols (5-fold CV and 70/30 temporal holdout),
 * estimates peer-group token prevalence via Ridge logistic regression, and computes
 * dilution-adjusted net farming EV and concrete execution plans.
 */

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelCoefficients {
  intercept: number;
  beta_log_tvl: number;
  beta_growth_asinh: number;
  beta_log_age: number;
  mean_log_tvl: number;
  median_age_days: number;
  lambda_tvl: number;
  lambda_rest: number;
  category_shrinkage_k: number;
  oof_q25_log_err: number;
  oof_q75_log_err: number;
  global_median_mult: number;
}

export interface HoldoutMetrics {
  name: string;
  sample_count: number;
  model_log_rmse: number;
  naive_log_rmse: number;
  model_mdape_pct: number;
  naive_mdape_pct: number;
  model_spearman: number;
  naive_spearman: number;
}

export interface ValidationReport {
  cv_5fold: HoldoutMetrics;
  temporal_holdout: HoldoutMetrics;
  token_odds_universe: number;
  token_odds_live_count: number;
  token_odds_cv_auc: number;
  token_odds_cv_brier: number;
  token_odds_weights: {
    intercept: number;
    log_tvl: number;
    log_age: number;
    missing_age: number;
    log_chains: number;
    growth_asinh: number;
    category_prior: number;
  };
}

export interface CategoryComp {
  category: string;
  sample_count: number;
  raw_median_mult: number;
  applied_multiple: number;
  residual_log_adj: number;
  peer_token_rate: number;
  live_tvl_usd: number;
  live_mcap_usd: number;
}

export type FarmVerdict = 'STRONG FARM' | 'FARM' | 'SELECTIVE' | 'SKIP';

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  cohort: 'watchlist' | 'early';
  token_status: 'pre-token';
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  token_odds_pct: number;
  prob_weighted_fdv_usd: number;
  est_capital_usd: number;
  est_gas_usd: number;
  carry_cost_usd: number;
  gross_airdrop_usd: number;
  net_ev_usd: number;
  net_roi_pct: number;
  hold_days: number;
  farm_chain: string;
  farm_verdict: FarmVerdict;
  valuation: {
    base_size_fdv_usd: number;
    applied_multiple: number;
    category_samples: number;
    category_adj_mult: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    conviction_score: number;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  cohort: 'watchlist' | 'early';
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  token_odds_pct: number;
  prob_weighted_fdv_usd: number;
  est_capital_usd: number;
  est_gas_usd: number;
  carry_cost_usd: number;
  gross_airdrop_usd: number;
  net_ev_usd: number;
  net_roi_pct: number;
  hold_days: number;
  farm_chain: string;
  farm_verdict: FarmVerdict;
  tx_count: number;
  tx_fee_usd: number;
  applied_multiple: number;
  category_adj_mult: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  conviction_score: number;
  farm_steps: string[];
}

export interface LiveComparable {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl_ratio: number;
  change_7d: number | null;
  age_days: number | null;
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model_name: string;
  coefficients: ModelCoefficients;
  validation: ValidationReport;
  total_protocols: number;
  watchlist_count: number;
  early_count: number;
  excluded_pretoken_count: number;
  live_token_count: number;
  category_comps: CategoryComp[];
  rows: RadarRow[];
  live: LiveComparable[];
}

const DAY_MS = 86_400_000;
const DEFAULT_FARM_CAPITAL = 1000;
const AIRDROP_POOL_SHARE = 0.08;
const ACTIVE_TVL_EXPONENT = 0.78;
const NON_YIELD_FRICTION_RATE = 0.008;

const VERSIONED_RE = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(?:wrapped|staked|staking)\b/i;
const CEX_PREFIX_RE = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
  'CEX',
]);

const CHAIN_GAS_USD: Record<string, number> = {
  Solana: 0.01,
  Sui: 0.01,
  Aptos: 0.01,
  Base: 0.02,
  Arbitrum: 0.03,
  Optimism: 0.02,
  OP_Mainnet: 0.02,
  Ink: 0.02,
  Unichain: 0.02,
  Blast: 0.03,
  Scroll: 0.04,
  Linea: 0.05,
  zkSync: 0.04,
  'zkSync Era': 0.04,
  Starknet: 0.03,
  Sonic: 0.01,
  Hyperliquid: 0.01,
  'Hyperliquid L1': 0.01,
  Monad: 0.02,
  Berachain: 0.03,
  Polygon: 0.04,
  Avalanche: 0.08,
  BSC: 0.08,
  Binance: 0.08,
  Tron: 0.45,
  Bitcoin: 2.5,
  Ethereum: 3.8,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const round2 = (v: number): number => Math.round(v * 1e2) / 1e2;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - idx) + sorted[hi]! * (idx - lo);
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0.25;
  return quantile([...nums].sort((a, b) => a - b), 0.5);
}

function spearmanCorr(a: number[], b: number[]): number {
  if (a.length < 3 || a.length !== b.length) return 0;
  const toRanks = (arr: number[]): number[] => {
    const pairs = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const r = new Array<number>(arr.length);
    for (let i = 0; i < pairs.length; ) {
      let j = i + 1;
      while (j < pairs.length && pairs[j]!.v === pairs[i]!.v) j++;
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) r[pairs[k]!.i] = avgRank;
      i = j;
    }
    return r;
  };
  const ra = toRanks(a);
  const rb = toRanks(b);
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += ra[i]!;
    mb += rb[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = ra[i]! - ma;
    const xb = rb[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? round4(num / den) : 0;
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const d = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < d; col++) {
    let piv = col;
    for (let r = col + 1; r < d; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const diag = Math.abs(M[col]![col]!) > 1e-12 ? M[col]![col]! : 1e-12;
    for (let k = col; k <= d; k++) M[col]![k]! /= diag;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const factor = M[r]![col]!;
      for (let k = col; k <= d; k++) M[r]![k]! -= factor * M[col]![k]!;
    }
  }
  return M.map((row) => row[d]!);
}

function solveRidgeRegression(X: number[][], y: number[], lambdas: number[]): number[] {
  const n = X.length;
  const d = lambdas.length;
  const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const b = new Array<number>(d).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i]!;
    const yi = y[i]!;
    for (let j = 0; j < d; j++) {
      b[j]! += xi[j]! * yi;
      for (let k = 0; k < d; k++) A[j]![k]! += xi[j]! * xi[k]!;
    }
  }
  for (let j = 0; j < d; j++) A[j]![j]! += lambdas[j]!;
  return solveLinearSystem(A, b);
}

export function parseSnapshot(rawText: string): Snapshot {
  const doc = JSON.parse(rawText) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('snapshot.json must be a JSON object');
  }
  if (typeof doc.as_of !== 'string' || !Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot.json is missing required fields (as_of, protocols, watchlist)');
  }
  const protocols: SnapshotProtocol[] = doc.protocols.map((item) => {
    const p = item as Record<string, unknown>;
    return {
      slug: String(p.slug),
      name: String(p.name),
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: Number(p.tvl_usd) || 0,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: String(doc.source ?? ''),
    floor_usd: Number(doc.floor_usd) || 50_000_000,
    protocols,
    watchlist: doc.watchlist.map(String),
  };
}

export function computeAgeDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export function isNoTokenRecord(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isCleanPreToken(p: SnapshotProtocol): boolean {
  if (!isNoTokenRecord(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_RE.test(p.name) || WRAPPED_RE.test(p.name) || CEX_PREFIX_RE.test(p.name)) return false;
  return true;
}

interface FittedValuation {
  w: number[];
  meanLogTvl: number;
  medianAge: number;
  catAdj: Map<string, number>;
  predictComponents: (p: SnapshotProtocol) => {
    logPred: number;
    baseSizeLog: number;
    growthMult: number;
    maturityMult: number;
    catAdjMult: number;
  };
}

function fitValuationOnSample(
  train: SnapshotProtocol[],
  asOf: string,
  lamTvl: number,
  lamRest: number,
  kShrink: number,
): FittedValuation {
  const safeTrain = train.length > 0 ? train : [];
  const meanLogTvl =
    safeTrain.length > 0
      ? safeTrain.reduce((acc, p) => acc + Math.log(Math.max(1, p.tvl_usd)), 0) / safeTrain.length
      : Math.log(50_000_000);
  const ages = safeTrain
    .map((p) => computeAgeDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? medianOf(ages) : 365;

  const features = (p: SnapshotProtocol): [number, number, number, number] => {
    const ltvl = Math.log(Math.max(1, p.tvl_usd)) - meanLogTvl;
    const g = Math.asinh((p.change_7d ?? 0) / 10);
    const a = computeAgeDays(asOf, p.listed_at);
    const lage = a === null ? 0 : Math.log(a + 30) - Math.log(medianAge + 30);
    return [1, ltvl, g, lage];
  };

  if (safeTrain.length < 6) {
    const w = [meanLogTvl + Math.log(0.25), 0.5, 0, 0];
    return {
      w,
      meanLogTvl,
      medianAge,
      catAdj: new Map(),
      predictComponents: (p) => {
        const f = features(p);
        const baseSizeLog = w[0]! + w[1]! * f[1]!;
        return {
          logPred: baseSizeLog,
          baseSizeLog,
          growthMult: 1,
          maturityMult: 1,
          catAdjMult: 1,
        };
      },
    };
  }

  const X = safeTrain.map(features);
  const y = safeTrain.map((p) => Math.log(Math.max(1, p.mcap_usd!)));
  const w = solveRidgeRegression(X, y, [0, lamTvl, lamRest, lamRest]);

  const catRes = new Map<string, number[]>();
  safeTrain.forEach((p, i) => {
    const pred = X[i]!.reduce((acc, v, j) => acc + v * w[j]!, 0);
    const cat = p.category ?? 'Uncategorized';
    const arr = catRes.get(cat) ?? [];
    arr.push(y[i]! - pred);
    catRes.set(cat, arr);
  });

  const catAdj = new Map<string, number>();
  for (const [cat, arr] of catRes.entries()) {
    const sum = arr.reduce((a, b) => a + b, 0);
    catAdj.set(cat, clamp(sum / (arr.length + kShrink), -1.6, 1.6));
  }

  return {
    w,
    meanLogTvl,
    medianAge,
    catAdj,
    predictComponents: (p) => {
      const f = features(p);
      const baseSizeLog = w[0]! + w[1]! * f[1]!;
      const growthLog = w[2]! * f[2]!;
      const matLog = w[3]! * f[3]!;
      const catLog = catAdj.get(p.category ?? 'Uncategorized') ?? 0;
      const logPred = baseSizeLog + growthLog + matLog + catLog;
      return {
        logPred,
        baseSizeLog,
        growthMult: round4(Math.exp(growthLog)),
        maturityMult: round4(Math.exp(matLog)),
        catAdjMult: round4(Math.exp(catLog)),
      };
    },
  };
}

function scoreHoldout(
  name: string,
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  modelPreds: number[],
): HoldoutMetrics {
  const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd);
  const naiveMed = ratios.length > 0 ? medianOf(ratios) : 0.25;
  let seModel = 0;
  let seNaive = 0;
  const apeModel: number[] = [];
  const apeNaive: number[] = [];
  const actuals: number[] = [];
  const naivePreds: number[] = [];

  for (let i = 0; i < test.length; i++) {
    const p = test[i]!;
    const pred = Math.max(1, modelPreds[i]!);
    const naive = Math.max(1, p.tvl_usd * naiveMed);
    const actual = p.mcap_usd!;
    seModel += (Math.log(pred) - Math.log(actual)) ** 2;
    seNaive += (Math.log(naive) - Math.log(actual)) ** 2;
    apeModel.push(Math.abs(pred - actual) / actual);
    apeNaive.push(Math.abs(naive - actual) / actual);
    actuals.push(actual);
    naivePreds.push(naive);
  }

  const n = Math.max(1, test.length);
  return {
    name,
    sample_count: test.length,
    model_log_rmse: round4(Math.sqrt(seModel / n)),
    naive_log_rmse: round4(Math.sqrt(seNaive / n)),
    model_mdape_pct: round2(medianOf(apeModel) * 100),
    naive_mdape_pct: round2(medianOf(apeNaive) * 100),
    model_spearman: spearmanCorr(modelPreds, actuals),
    naive_spearman: spearmanCorr(naivePreds, actuals),
  };
}

function selectValuationHyperparams(
  liveSorted: SnapshotProtocol[],
  asOf: string,
): { lamTvl: number; lamRest: number; kShrink: number } {
  if (liveSorted.length < 20) return { lamTvl: 5, lamRest: 40, kShrink: 8 };
  const candidates = [
    { lamTvl: 1, lamRest: 25, kShrink: 6 },
    { lamTvl: 5, lamRest: 40, kShrink: 10 },
    { lamTvl: 5, lamRest: 80, kShrink: 12 },
    { lamTvl: 15, lamRest: 80, kShrink: 12 },
  ];
  let best = candidates[1]!;
  let bestRmse = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    let se = 0;
    for (let fold = 0; fold < 5; fold++) {
      const tr = liveSorted.filter((_, i) => i % 5 !== fold);
      const te = liveSorted.filter((_, i) => i % 5 === fold);
      const m = fitValuationOnSample(tr, asOf, c.lamTvl, c.lamRest, c.kShrink);
      for (const p of te) {
        const err = m.predictComponents(p).logPred - Math.log(p.mcap_usd!);
        se += err * err;
      }
    }
    const rmse = Math.sqrt(se / liveSorted.length);
    if (rmse < bestRmse) {
      bestRmse = rmse;
      best = c;
    }
  }
  return best;
}

interface FittedTokenOdds {
  w: number[];
  predictProb: (p: SnapshotProtocol) => number;
  categoryRate: (cat: string | null) => number;
}

function hasTokenRecord(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

function fitTokenOddsOnSample(train: SnapshotProtocol[], asOf: string): FittedTokenOdds {
  if (train.length < 10) {
    return {
      w: [0, 0, 0, 0, 0, 0, 0],
      predictProb: () => 0.5,
      categoryRate: () => 0.5,
    };
  }
  const meanLogTvl =
    train.reduce((acc, p) => acc + Math.log(Math.max(1, p.tvl_usd)), 0) / train.length;
  const ages = train
    .map((p) => computeAgeDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null);
  const medAge = ages.length > 0 ? medianOf(ages) : 500;
  const globalRate = clamp(train.filter(hasTokenRecord).length / train.length, 0.05, 0.95);
  const logit = (p: number) => {
    const c = clamp(p, 0.03, 0.97);
    return Math.log(c / (1 - c));
  };

  const catStats = new Map<string, { tok: number; n: number }>();
  for (const p of train) {
    const cat = p.category ?? 'Uncategorized';
    const cur = catStats.get(cat) ?? { tok: 0, n: 0 };
    cur.n++;
    if (hasTokenRecord(p)) cur.tok++;
    catStats.set(cat, cur);
  }
  const catRate = (cat: string | null): number => {
    const st = catStats.get(cat ?? 'Uncategorized');
    if (!st) return globalRate;
    return (st.tok + 8 * globalRate) / (st.n + 8);
  };
  const catLogitDelta = (cat: string | null): number => logit(catRate(cat)) - logit(globalRate);

  const features = (p: SnapshotProtocol): number[] => {
    const ltvl = Math.log(Math.max(1, p.tvl_usd)) - meanLogTvl;
    const a = computeAgeDays(asOf, p.listed_at);
    const lage = Math.log((a ?? medAge) + 30) - Math.log(medAge + 30);
    const missAge = a === null ? 1 : 0;
    const lch = Math.log(Math.max(1, p.chains.length));
    const g = Math.asinh((p.change_7d ?? 0) / 10);
    return [1, ltvl, lage, missAge, lch, g, catLogitDelta(p.category)];
  };

  const d = 7;
  const w = new Array<number>(d).fill(0);
  const lambda = [0, 2, 2, 2, 2, 2, 2];

  for (let iter = 0; iter < 24; iter++) {
    const grad = new Array<number>(d).fill(0);
    const H = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (const p of train) {
      const x = features(p);
      const y = hasTokenRecord(p) ? 1 : 0;
      const z = clamp(x.reduce((acc, v, j) => acc + v * w[j]!, 0), -18, 18);
      const pr = 1 / (1 + Math.exp(-z));
      const wt = Math.max(1e-4, pr * (1 - pr));
      for (let j = 0; j < d; j++) {
        grad[j]! += (pr - y) * x[j]!;
        for (let k = 0; k < d; k++) H[j]![k]! += wt * x[j]! * x[k]!;
      }
    }
    for (let j = 0; j < d; j++) {
      grad[j]! += lambda[j]! * w[j]!;
      H[j]![j]! += lambda[j]!;
    }
    const step = solveLinearSystem(H, grad);
    for (let j = 0; j < d; j++) w[j]! -= step[j]!;
  }

  return {
    w,
    categoryRate: catRate,
    predictProb: (p) => {
      const x = features(p);
      const z = clamp(x.reduce((acc, v, j) => acc + v * w[j]!, 0), -18, 18);
      return 1 / (1 + Math.exp(-z));
    },
  };
}

function pickCheapestChain(chains: string[]): { chain: string; txFee: number } {
  if (chains.length === 0) return { chain: 'Ethereum', txFee: 3.8 };
  let bestChain = chains[0]!;
  let bestFee = CHAIN_GAS_USD[bestChain] ?? 0.25;
  for (const c of chains) {
    const fee = CHAIN_GAS_USD[c] ?? 0.25;
    if (fee < bestFee) {
      bestFee = fee;
      bestChain = c;
    }
  }
  return { chain: bestChain, txFee: round2(bestFee) };
}

function recommendHoldDays(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 150) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

function clampStep(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length > 600) return `${trimmed.slice(0, 596)}...`;
  if (trimmed.length < 20) return `${trimmed} (verify position on protocol UI)`;
  return trimmed;
}

export function buildFarmPlan(
  p: SnapshotProtocol,
  ageDays: number | null,
  impliedValueUsd: number,
  tokenOdds: number,
  capital: number = DEFAULT_FARM_CAPITAL,
): {
  steps: string[];
  capitalUsd: number;
  estGasUsd: number;
  carryCostUsd: number;
  grossAirdropUsd: number;
  netEvUsd: number;
  netRoiPct: number;
  holdDays: number;
  farmChain: string;
  txCount: number;
  txFeeUsd: number;
  verdict: FarmVerdict;
} {
  const { chain, txFee } = pickCheapestChain(p.chains);
  const holdDays = recommendHoldDays(ageDays);
  const weeks = Math.max(4, Math.ceil(holdDays / 7));
  const txCount = 3 + weeks;
  const estGasUsd = round2(txFee * txCount);
  const cat = (p.category ?? '').toLowerCase();
  const isYieldBearing =
    cat.includes('lend') ||
    cat.includes('cdp') ||
    cat.includes('rwa') ||
    cat.includes('basis') ||
    cat.includes('yield') ||
    cat.includes('curator') ||
    cat.includes('allocator') ||
    cat.includes('dex') ||
    cat.includes('liquidity') ||
    cat.includes('farm');
  // Yield-bearing vaults/LPs offset capital carry; non-yielding margin/transfer protocols pay a modest friction spread.
  const carryRate = isYieldBearing ? 0 : NON_YIELD_FRICTION_RATE;
  const carryCostUsd = round2(capital * carryRate * (holdDays / 365));
  const tvlMillions = Math.max(1, p.tvl_usd / 1_000_000);
  const effectiveFarmTvl = Math.pow(tvlMillions, ACTIVE_TVL_EXPONENT) * 1_000_000;
  const grossAirdropUsd = round2(
    (capital / (effectiveFarmTvl + capital)) *
      (AIRDROP_POOL_SHARE * impliedValueUsd) *
      tokenOdds,
  );
  const netEvUsd = round2(grossAirdropUsd - estGasUsd - carryCostUsd);
  const netRoiPct = round2((netEvUsd / Math.max(1, capital)) * 100);

  let verdict: FarmVerdict;
  if (netEvUsd >= 10 && netRoiPct >= 1.0) verdict = 'STRONG FARM';
  else if (netEvUsd > 0) verdict = 'FARM';
  else if (netEvUsd > -8 && grossAirdropUsd > estGasUsd) verdict = 'SELECTIVE';
  else verdict = 'SKIP';

  let coreAction: string;
  let weeklyAction: string;

  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    coreAction = `Supply $${capital} USDC or blue-chip collateral to ${p.name} on ${chain} at <40% LTV to earn lender + points multipliers.`;
    weeklyAction = `Claim or rebalance accrued yield once weekly across ${weeks} epochs to maintain active-lender weighting.`;
  } else if (cat.includes('dex') || cat.includes('liquidity') || cat.includes('farm')) {
    coreAction = `Provide $${capital} into a correlated stable/major pool on ${p.name} (${chain}) to earn LP fees with minimal impermanent loss.`;
    weeklyAction = `Route one $25+ swap and compound/adjust LP range weekly over ${weeks} weeks for volume + duration tiers.`;
  } else if (cat.includes('rwa') || cat.includes('basis') || cat.includes('yield') || cat.includes('curator') || cat.includes('allocator')) {
    coreAction = `Deposit $${capital} USDC into ${p.name}'s primary yield vault on ${chain} and hold the receipt token unencumbered.`;
    weeklyAction = `Track epoch points accrual weekly and roll maturing vault tranches across ${weeks} snapshots.`;
  } else if (cat.includes('deriv') || cat.includes('option') || cat.includes('prediction')) {
    coreAction = `Post $${capital} margin on ${p.name} (${chain}) and run delta-neutral or hedged low-fee taker/maker trades.`;
    weeklyAction = `Execute 1-2 low-slippage hedged fills weekly for ${weeks} weeks to hit active-trader streak tiers.`;
  } else if (cat.includes('payment') || cat.includes('privacy')) {
    coreAction = `Bridge $${capital} into ${p.name} on ${chain} and complete 3 distinct organic settlement transfers.`;
    weeklyAction = `Send one qualifying weekly transfer over ${weeks} weeks to build sustained epoch activity.`;
  } else {
    coreAction = `Deploy $${capital} USDC into ${p.name}'s core contract on ${chain} and verify receipt share custody.`;
    weeklyAction = `Perform one weekly on-chain interaction (top-up, vote, or rebalance) for ${weeks} weeks across snapshots.`;
  }

  const setupFee = round2(txFee * 2);
  const upkeepGas = round2(txFee * weeks);
  const exitFee = round2(txFee);
  const evSign = netEvUsd >= 0 ? `+$${netEvUsd.toFixed(2)}` : `-$${Math.abs(netEvUsd).toFixed(2)}`;
  const costNote = isYieldBearing
    ? `base protocol yield offsets carry; total gas ~$${estGasUsd.toFixed(2)}`
    : `gas ~$${estGasUsd.toFixed(2)} + ~$${carryCostUsd.toFixed(2)} friction`;

  const steps = [
    `Fund an isolated wallet with $${capital} working capital plus $${Math.max(1, Math.ceil(estGasUsd * 1.5))} gas on ${chain} (lowest-fee supported chain, ~$${txFee}/tx). Cost: ~$${setupFee} setup gas. Time: 10 minutes.`,
    `${coreAction} Cost: $${capital} refundable principal + ~$${txFee} entry gas. Time: 15 minutes.`,
    `${weeklyAction} Cost: ~$${upkeepGas} across ${weeks} weekly txs. Time: 5 min/week for ${holdDays} days.`,
    `Maintain position through ${holdDays} days (${weeks} weekly snapshots); ${costNote}. Verdict: ${verdict} (est. gross ~$${grossAirdropUsd.toFixed(2)}, net EV ${evSign}). Time: ${holdDays} days passive.`,
    `Verify official eligibility and claim/withdraw only via ${p.name}'s canonical app domain after any TGE. Cost: ~$${exitFee} exit gas. Time: 10 minutes.`,
  ].map(clampStep);

  return {
    steps,
    capitalUsd: capital,
    estGasUsd,
    carryCostUsd,
    grossAirdropUsd,
    netEvUsd,
    netRoiPct,
    holdDays,
    farmChain: chain,
    txCount,
    txFeeUsd: txFee,
    verdict,
  };
}

function computeConviction(
  tvlUsd: number,
  growthPct: number,
  ageDays: number,
  chainsCount: number,
  tokenOdds: number,
  isWatchlist: boolean,
): number {
  const tvlScore = clamp(Math.log10(Math.max(tvlUsd, 1e6) / 5e6) / 2.8, 0, 1) * 32;
  const growthScore = clamp((growthPct + 25) / 85, 0, 1) * 20;
  const ageScore = clamp(ageDays / 730, 0, 1) * 18;
  const chainScore = clamp((chainsCount - 1) / 4, 0, 1) * 10;
  const oddsScore = clamp(tokenOdds, 0, 1) * 12;
  const wlBonus = isWatchlist ? 8 : 0;
  return Math.round(clamp(tvlScore + growthScore + ageScore + chainScore + oddsScore + wlBonus, 1, 99));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarPayload } {
  const watchlistSet = new Set(snapshot.watchlist);
  const liveComps = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const hp = selectValuationHyperparams(liveComps, snapshot.as_of);

  // Held-out test 1: 5-fold CV across live comparables
  const oofLogErrs: number[] = [];
  const cvPreds: number[] = [];
  const cvOrdered: SnapshotProtocol[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const tr = liveComps.filter((_, i) => i % 5 !== fold);
    const te = liveComps.filter((_, i) => i % 5 === fold);
    const fitted = fitValuationOnSample(tr, snapshot.as_of, hp.lamTvl, hp.lamRest, hp.kShrink);
    for (const p of te) {
      const logPred = fitted.predictComponents(p).logPred;
      oofLogErrs.push(Math.log(p.mcap_usd!) - logPred);
      cvPreds.push(Math.exp(logPred));
      cvOrdered.push(p);
    }
  }
  const cv5Metrics = scoreHoldout('5-Fold Out-of-Fold CV', liveComps, cvOrdered, cvPreds);

  // Held-out test 2: 70/30 temporal holdout (train on older live comps, test on newest 30%)
  const withAge = liveComps
    .map((p) => ({ p, a: computeAgeDays(snapshot.as_of, p.listed_at) }))
    .filter((x): x is { p: SnapshotProtocol; a: number } => x.a !== null)
    .sort((x, y) => y.a - x.a || x.p.slug.localeCompare(y.p.slug));
  const cut = Math.max(10, Math.floor(withAge.length * 0.7));
  const tempTrain = [
    ...withAge.slice(0, cut).map((x) => x.p),
    ...liveComps.filter((p) => computeAgeDays(snapshot.as_of, p.listed_at) === null),
  ];
  const tempTest = withAge.slice(cut).map((x) => x.p);
  const tempFit = fitValuationOnSample(tempTrain, snapshot.as_of, hp.lamTvl, hp.lamRest, hp.kShrink);
  const tempPreds = tempTest.map((p) => Math.exp(tempFit.predictComponents(p).logPred));
  const temporalMetrics = scoreHoldout('30% Newest-Listed Holdout', tempTrain, tempTest, tempPreds);

  // Full valuation fit on all live comparables
  const fullVal = fitValuationOnSample(liveComps, snapshot.as_of, hp.lamTvl, hp.lamRest, hp.kShrink);
  const sortedErrs = [...oofLogErrs].sort((a, b) => a - b);
  const q25Err = sortedErrs.length > 5 ? quantile(sortedErrs, 0.25) : -0.7;
  const q75Err = sortedErrs.length > 5 ? quantile(sortedErrs, 0.75) : 0.7;
  const globalMedianMult = round4(
    medianOf(liveComps.map((p) => p.mcap_usd! / p.tvl_usd)),
  );

  // Peer token-odds logistic model + 5-fold CV AUC/Brier
  const cleanUniverse = snapshot.protocols
    .filter((p) => !(p.category !== null && EXCLUDED_CATEGORIES.has(p.category)))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const oofProbs: number[] = [];
  const oofLabels: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const tr = cleanUniverse.filter((_, i) => i % 5 !== fold);
    const te = cleanUniverse.filter((_, i) => i % 5 === fold);
    const lm = fitTokenOddsOnSample(tr, snapshot.as_of);
    for (const p of te) {
      oofProbs.push(lm.predictProb(p));
      oofLabels.push(hasTokenRecord(p) ? 1 : 0);
    }
  }
  let wins = 0;
  let posN = 0;
  let negN = 0;
  let brierSum = 0;
  for (let i = 0; i < oofProbs.length; i++) {
    brierSum += (oofProbs[i]! - oofLabels[i]!) ** 2;
    if (oofLabels[i] === 1) {
      posN++;
      for (let j = 0; j < oofProbs.length; j++) {
        if (oofLabels[j] === 0) {
          if (oofProbs[i]! > oofProbs[j]!) wins += 1;
          else if (oofProbs[i]! === oofProbs[j]!) wins += 0.5;
        }
      }
    } else {
      negN++;
    }
  }
  const tokenOddsAuc = posN > 0 && negN > 0 ? round4(wins / (posN * negN)) : 0.5;
  const tokenOddsBrier = oofProbs.length > 0 ? round4(brierSum / oofProbs.length) : 0.25;
  const fullOdds = fitTokenOddsOnSample(cleanUniverse, snapshot.as_of);

  // Category comparables summary
  const catBuckets = new Map<string, { ratios: number[]; tvl: number; mcap: number }>();
  for (const p of liveComps) {
    const cat = p.category ?? 'Uncategorized';
    const cur = catBuckets.get(cat) ?? { ratios: [], tvl: 0, mcap: 0 };
    cur.ratios.push(p.mcap_usd! / p.tvl_usd);
    cur.tvl += p.tvl_usd;
    cur.mcap += p.mcap_usd!;
    catBuckets.set(cat, cur);
  }
  const categoryComps: CategoryComp[] = [...catBuckets.entries()]
    .map(([category, b]) => {
      const logAdj = fullVal.catAdj.get(category) ?? 0;
      const rawMed = medianOf(b.ratios);
      const shrunk = (b.ratios.length * clamp(rawMed, 0.05, 1.5) + 4 * globalMedianMult) / (b.ratios.length + 4);
      return {
        category,
        sample_count: b.ratios.length,
        raw_median_mult: round4(rawMed),
        applied_multiple: round4(shrunk),
        residual_log_adj: round4(Math.exp(logAdj)),
        peer_token_rate: round4(fullOdds.categoryRate(category)),
        live_tvl_usd: Math.round(b.tvl),
        live_mcap_usd: Math.round(b.mcap),
      };
    })
    .sort((a, b) => b.sample_count - a.sample_count || b.residual_log_adj - a.residual_log_adj);

  // Select watchlist + clean early pre-token protocols
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const selected = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) selected.set(slug, p);
  }
  let excludedPreToken = 0;
  for (const p of snapshot.protocols) {
    if (selected.has(p.slug)) continue;
    if (isCleanPreToken(p) && p.tvl_usd < snapshot.floor_usd) {
      selected.set(p.slug, p);
    } else if (isNoTokenRecord(p)) {
      excludedPreToken++;
    }
  }
  if (selected.size < 100) {
    for (const p of snapshot.protocols) {
      if (selected.size >= 100) break;
      if (!selected.has(p.slug) && isNoTokenRecord(p)) selected.set(p.slug, p);
    }
  }

  const rawRows = [...selected.values()].map((p) => {
    const vc = fullVal.predictComponents(p);
    const implied = Math.max(1, Math.min(100_000_000_000_000, Math.round(Math.exp(vc.logPred))));
    const impliedLow = Math.max(1, Math.min(implied, Math.round(Math.exp(vc.logPred + q25Err))));
    const impliedHigh = Math.max(implied, Math.min(100_000_000_000_000, Math.round(Math.exp(vc.logPred + q75Err))));
    const tokenOdds = fullOdds.predictProb(p);
    const tokenOddsPct = round2(tokenOdds * 100);
    const probWeighted = Math.max(1, Math.round(implied * tokenOdds));
    const age = computeAgeDays(snapshot.as_of, p.listed_at);
    const effectiveAge = age ?? fullVal.medianAge;
    const isWl = watchlistSet.has(p.slug);
    const conviction = computeConviction(
      p.tvl_usd,
      p.change_7d ?? 0,
      effectiveAge,
      p.chains.length,
      tokenOdds,
      isWl,
    );
    const farm = buildFarmPlan(p, age, implied, tokenOdds, DEFAULT_FARM_CAPITAL);

    return {
      p,
      isWl,
      age,
      implied,
      impliedLow,
      impliedHigh,
      tokenOddsPct,
      probWeighted,
      baseSizeFdv: Math.round(Math.exp(vc.baseSizeLog)),
      appliedMult: round4(implied / Math.max(1, p.tvl_usd)),
      catSamples: catBuckets.get(p.category ?? 'Uncategorized')?.ratios.length ?? 0,
      catAdjMult: vc.catAdjMult,
      growthMult: vc.growthMult,
      maturityMult: vc.maturityMult,
      conviction,
      farm,
    };
  });

  rawRows.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const board: BoardRow[] = rawRows.map((item, idx) => ({
    rank: idx + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    cohort: item.isWl ? 'watchlist' : 'early',
    token_status: 'pre-token',
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    mcap_usd: item.p.mcap_usd,
    listed_at: item.p.listed_at,
    gecko_id: item.p.gecko_id,
    symbol: item.p.symbol,
    age_days: item.age,
    implied_value_usd: item.implied,
    implied_low_usd: item.impliedLow,
    implied_high_usd: item.impliedHigh,
    token_odds_pct: item.tokenOddsPct,
    prob_weighted_fdv_usd: item.probWeighted,
    est_capital_usd: item.farm.capitalUsd,
    est_gas_usd: item.farm.estGasUsd,
    carry_cost_usd: item.farm.carryCostUsd,
    gross_airdrop_usd: item.farm.grossAirdropUsd,
    net_ev_usd: item.farm.netEvUsd,
    net_roi_pct: item.farm.netRoiPct,
    hold_days: item.farm.holdDays,
    farm_chain: item.farm.farmChain,
    farm_verdict: item.farm.verdict,
    valuation: {
      base_size_fdv_usd: item.baseSizeFdv,
      applied_multiple: item.appliedMult,
      category_samples: item.catSamples,
      category_adj_mult: item.catAdjMult,
      growth_multiplier: item.growthMult,
      maturity_multiplier: item.maturityMult,
      conviction_score: item.conviction,
    },
    farm_steps: item.farm.steps,
  }));

  const liveAll = snapshot.protocols.filter((p) => !isNoTokenRecord(p) && p.category !== 'CEX');
  const live: LiveComparable[] = liveComps
    .slice()
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      mcap_tvl_ratio: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
      age_days: computeAgeDays(snapshot.as_of, p.listed_at),
    }));

  const rows: RadarRow[] = rawRows.map((item, idx) => ({
    rank: idx + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    cohort: item.isWl ? 'watchlist' : 'early',
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    listed_at: item.p.listed_at,
    age_days: item.age,
    implied_value_usd: item.implied,
    implied_low_usd: item.impliedLow,
    implied_high_usd: item.impliedHigh,
    token_odds_pct: item.tokenOddsPct,
    prob_weighted_fdv_usd: item.probWeighted,
    est_capital_usd: item.farm.capitalUsd,
    est_gas_usd: item.farm.estGasUsd,
    carry_cost_usd: item.farm.carryCostUsd,
    gross_airdrop_usd: item.farm.grossAirdropUsd,
    net_ev_usd: item.farm.netEvUsd,
    net_roi_pct: item.farm.netRoiPct,
    hold_days: item.farm.holdDays,
    farm_chain: item.farm.farmChain,
    farm_verdict: item.farm.verdict,
    tx_count: item.farm.txCount,
    tx_fee_usd: item.farm.txFeeUsd,
    applied_multiple: item.appliedMult,
    category_adj_mult: item.catAdjMult,
    growth_multiplier: item.growthMult,
    maturity_multiplier: item.maturityMult,
    conviction_score: item.conviction,
    farm_steps: item.farm.steps,
  }));

  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_name: 'Ridge Size-Curve + Peer Token-Odds v2',
    coefficients: {
      intercept: round4(fullVal.w[0]!),
      beta_log_tvl: round4(fullVal.w[1]!),
      beta_growth_asinh: round4(fullVal.w[2]!),
      beta_log_age: round4(fullVal.w[3]!),
      mean_log_tvl: round4(fullVal.meanLogTvl),
      median_age_days: Math.round(fullVal.medianAge),
      lambda_tvl: hp.lamTvl,
      lambda_rest: hp.lamRest,
      category_shrinkage_k: hp.kShrink,
      oof_q25_log_err: round4(q25Err),
      oof_q75_log_err: round4(q75Err),
      global_median_mult: globalMedianMult,
    },
    validation: {
      cv_5fold: cv5Metrics,
      temporal_holdout: temporalMetrics,
      token_odds_universe: cleanUniverse.length,
      token_odds_live_count: cleanUniverse.filter(hasTokenRecord).length,
      token_odds_cv_auc: tokenOddsAuc,
      token_odds_cv_brier: tokenOddsBrier,
      token_odds_weights: {
        intercept: round4(fullOdds.w[0]!),
        log_tvl: round4(fullOdds.w[1]!),
        log_age: round4(fullOdds.w[2]!),
        missing_age: round4(fullOdds.w[3]!),
        log_chains: round4(fullOdds.w[4]!),
        growth_asinh: round4(fullOdds.w[5]!),
        category_prior: round4(fullOdds.w[6]!),
      },
    },
    total_protocols: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    early_count: board.filter((r) => r.cohort === 'early').length,
    excluded_pretoken_count: excludedPreToken,
    live_token_count: liveAll.length,
    category_comps: categoryComps,
    rows,
    live,
  };

  return { board, radar };
}

export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board has ${board.length} rows (expected 100..4000)`;
  }
  const seen = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) {
    return `missing ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  }
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank mismatch at index ${i}: got ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has invalid implied_value_usd ${r.implied_value_usd}`;
    }
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${r.rank} (${r.slug}) outranks row ${i}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm_steps`;
    }
    for (const step of r.farm_steps) {
      if (step.trim().length < 20 || step.trim().length > 600) {
        return `${r.slug} has farm step with invalid length ${step.length}`;
      }
    }
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all rows share identical implied_value_usd';
  }
  return null;
}
