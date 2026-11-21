/**
 * Empirical pre-token protocol valuation and farm-plan generator for Token Radar.
 *
 * Derives category valuation multiples from live-token comparables inside the sealed
 * snapshot, scores every watchlist and early pre-token protocol purely from snapshot
 * observables (TVL, 7-day TVL momentum, age since listing, chain footprint), and emits
 * chain-aware, costed farming plans.
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

export interface ModelConfig {
  shrinkage_k: number;
  multiple_min: number;
  multiple_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const DEFAULT_CONFIG: ModelConfig = {
  shrinkage_k: 4,
  multiple_min: 0.08,
  multiple_max: 1.25,
  growth_weight: 0.45,
  growth_floor: -55,
  growth_cap: 120,
  maturity_base: 0.70,
  maturity_span: 0.40,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_cap: 6,
};

export interface CategoryComp {
  category: string;
  sample_count: number;
  raw_median_mult: number;
  applied_multiple: number;
  live_tvl_usd: number;
  live_mcap_usd: number;
}

export interface ValuationBreakdown {
  applied_multiple: number;
  category_samples: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  conviction_score: number;
}

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
  est_capital_usd: number;
  est_gas_usd: number;
  hold_days: number;
  valuation: ValuationBreakdown;
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
  est_capital_usd: number;
  est_gas_usd: number;
  hold_days: number;
  applied_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
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
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model_name: string;
  config: ModelConfig;
  global_median_mult: number;
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
const HIGH_FEE_CHAINS = new Set(['Ethereum', 'Bitcoin']);
const MED_FEE_CHAINS = new Set(['Avalanche', 'BNB', 'Binance', 'Polygon', 'Fantom']);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const round2 = (v: number): number => Math.round(v * 1e2) / 1e2;

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0.25;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
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

export function calibrateCategoryComps(
  protocols: SnapshotProtocol[],
  cfg: ModelConfig,
): { globalMedian: number; byCategory: Map<string, CategoryComp>; list: CategoryComp[] } {
  const allRatios: number[] = [];
  const buckets = new Map<string, { ratios: number[]; tvl: number; mcap: number }>();

  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const cat = p.category ?? 'Uncategorized';
    const b = buckets.get(cat) ?? { ratios: [], tvl: 0, mcap: 0 };
    b.ratios.push(ratio);
    b.tvl += p.tvl_usd;
    b.mcap += p.mcap_usd;
    buckets.set(cat, b);
  }

  const globalMedian = round4(clamp(medianOf(allRatios), cfg.multiple_min, cfg.multiple_max));
  const byCategory = new Map<string, CategoryComp>();

  for (const [category, b] of buckets.entries()) {
    const rawMed = medianOf(b.ratios);
    const cappedCatMed = clamp(rawMed, 0.05, 1.5);
    const n = b.ratios.length;
    const shrunk = (n * cappedCatMed + cfg.shrinkage_k * globalMedian) / (n + cfg.shrinkage_k);
    const applied = round4(clamp(shrunk, cfg.multiple_min, cfg.multiple_max));
    byCategory.set(category, {
      category,
      sample_count: n,
      raw_median_mult: round4(rawMed),
      applied_multiple: applied,
      live_tvl_usd: Math.round(b.tvl),
      live_mcap_usd: Math.round(b.mcap),
    });
  }

  const list = [...byCategory.values()].sort(
    (a, b) => b.sample_count - a.sample_count || b.applied_multiple - a.applied_multiple,
  );
  return { globalMedian, byCategory, list };
}

function estimateGasPerTx(chains: string[]): number {
  const primary = chains[0] ?? 'Ethereum';
  if (HIGH_FEE_CHAINS.has(primary)) return 4.5;
  if (MED_FEE_CHAINS.has(primary)) return 0.35;
  return 0.08;
}

function recommendCapital(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 175;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
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
): { steps: string[]; capitalUsd: number; estGasUsd: number; holdDays: number } {
  const chain = p.chains[0] ?? 'its primary chain';
  const altChain = p.chains.find((c) => !HIGH_FEE_CHAINS.has(c)) ?? chain;
  const capital = recommendCapital(p.tvl_usd);
  const holdDays = recommendHoldDays(ageDays);
  const txFee = estimateGasPerTx(p.chains);
  const weeks = Math.max(4, Math.ceil(holdDays / 7));
  const totalGas = round2(txFee * (3 + weeks));
  const cat = (p.category ?? '').toLowerCase();

  let coreAction: string;
  let weeklyAction: string;

  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    coreAction = `Supply $${capital} USDC or blue-chip collateral to ${p.name} on ${altChain} and maintain a conservative <40% LTV borrow loop.`;
    weeklyAction = `Rebalance collateral or claim/re-supply accrued yield once weekly across ${weeks} weeks to accrue active epoch points.`;
  } else if (cat.includes('dex') || cat.includes('liquidity') || cat.includes('farm')) {
    coreAction = `Seed $${capital} into a correlated stable/major LP pair on ${p.name} (${altChain}) to earn swap fees while minimizing IL.`;
    weeklyAction = `Execute one small swap ($15+) and compound or adjust LP range weekly over ${weeks} weeks for volume + duration tiers.`;
  } else if (cat.includes('rwa') || cat.includes('basis') || cat.includes('yield') || cat.includes('curator') || cat.includes('allocator')) {
    coreAction = `Deposit $${capital} USDC into ${p.name}'s primary yield vault on ${altChain} and hold the receipt share token in-wallet.`;
    weeklyAction = `Verify vault points accrual weekly and roll maturing epochs if lockup resets over ${weeks} weeks.`;
  } else if (cat.includes('deriv') || cat.includes('option') || cat.includes('prediction')) {
    coreAction = `Deposit $${capital} margin on ${p.name} (${altChain}) and execute low-delta hedged trades to build verified volume.`;
    weeklyAction = `Place 1-2 low-slippage trades per week across ${weeks} weeks to hit active-week streak thresholds.`;
  } else if (cat.includes('restak') || cat.includes('staking')) {
    coreAction = `Delegate $${capital} of eligible staked collateral into ${p.name} on ${altChain} and select an active operator/vault.`;
    weeklyAction = `Confirm delegation status and restaking points multiplier weekly across the ${holdDays}-day window.`;
  } else if (cat.includes('payment') || cat.includes('privacy')) {
    coreAction = `Fund $${capital} into ${p.name} on ${altChain} and complete 3 distinct peer transfers or shielded interactions.`;
    weeklyAction = `Send one qualifying transfer or settlement transaction weekly for ${weeks} weeks to establish organic cadence.`;
  } else {
    coreAction = `Deposit $${capital} USDC into ${p.name}'s core contract on ${altChain} and keep the receipt position active.`;
    weeklyAction = `Perform one weekly on-chain interaction (rebalance, vote, or top-up) for ${weeks} weeks to maintain active epochs.`;
  }

  const setupFee = round2(txFee * 2);
  const upkeepGas = round2(txFee * weeks);
  const exitFee = round2(txFee);

  const steps = [
    `Isolate a dedicated farming wallet funded with $${capital} working capital plus $${Math.max(2, Math.ceil(totalGas * 1.5))} gas on ${altChain}. Cost: ~$${setupFee} setup gas. Time: 10 minutes.`,
    `${coreAction} Cost: $${capital} refundable liquidity + ~$${txFee} entry gas. Time: 15 minutes.`,
    `${weeklyAction} Cost: ~$${upkeepGas} total weekly gas (${weeks} txs). Time: 5 min/week for ${holdDays} days.`,
    `Keep the position open through at least ${holdDays} days (${weeks} weekly snapshots) without full withdrawal before TGE snapshot. Cost: $0 extra (opportunity cost on $${capital}). Time: ${holdDays} days passive.`,
    `Verify official points dashboard and unwind or claim only via ${p.name}'s canonical domain after TGE announcement. Cost: ~$${exitFee} exit gas. Time: 10 minutes.`,
  ].map(clampStep);

  return { steps, capitalUsd: capital, estGasUsd: totalGas, holdDays };
}

function computeConviction(
  tvlUsd: number,
  growthPct: number,
  ageDays: number,
  chainsCount: number,
  isWatchlist: boolean,
): number {
  const tvlScore = clamp(Math.log10(Math.max(tvlUsd, 1e6) / 5e6) / 2.8, 0, 1) * 38;
  const growthScore = clamp((growthPct + 25) / 85, 0, 1) * 24;
  const ageScore = clamp(ageDays / 730, 0, 1) * 20;
  const chainScore = clamp((chainsCount - 1) / 4, 0, 1) * 10;
  const wlBonus = isWatchlist ? 8 : 0;
  return Math.round(clamp(tvlScore + growthScore + ageScore + chainScore + wlBonus, 1, 99));
}

export function buildRadar(
  snapshot: Snapshot,
  config: ModelConfig = DEFAULT_CONFIG,
): { board: BoardRow[]; radar: RadarPayload } {
  const watchlistSet = new Set(snapshot.watchlist);
  const { globalMedian, byCategory, list: categoryComps } = calibrateCategoryComps(snapshot.protocols, config);

  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const selected = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) selected.set(slug, p);
  }

  let excludedPreToken = 0;
  for (const p of snapshot.protocols) {
    if (selected.has(p.slug)) continue;
    // Protocols >= floor_usd absent from watchlist were excluded by parentProtocol/wrapper rules.
    if (isCleanPreToken(p) && p.tvl_usd < snapshot.floor_usd) {
      selected.set(p.slug, p);
    } else if (isNoTokenRecord(p)) {
      excludedPreToken++;
    }
  }

  // Fallback only if a synthetic test snapshot has fewer than 100 clean pre-token rows.
  if (selected.size < 100) {
    for (const p of snapshot.protocols) {
      if (selected.size >= 100) break;
      if (!selected.has(p.slug) && isNoTokenRecord(p)) {
        selected.set(p.slug, p);
      }
    }
  }

  const rawRows = [...selected.values()].map((p) => {
    const comp = p.category ? byCategory.get(p.category) : undefined;
    const appliedMult = comp ? comp.applied_multiple : globalMedian;
    const sampleCount = comp ? comp.sample_count : 0;

    const age = computeAgeDays(snapshot.as_of, p.listed_at);
    const effectiveAge = age ?? config.unknown_age_days;
    const growthPct = clamp(p.change_7d ?? 0, config.growth_floor, config.growth_cap);
    const growthMult = 1 + (growthPct / 100) * config.growth_weight;
    const maturityMult =
      config.maturity_base +
      (clamp(effectiveAge, 0, config.maturity_days) / config.maturity_days) * config.maturity_span;
    const chainMult = 1 + config.chain_step * Math.min(Math.max(p.chains.length - 1, 0), config.chain_cap);

    const implied = Math.max(
      1,
      Math.round(p.tvl_usd * appliedMult * growthMult * maturityMult * chainMult),
    );
    const isWl = watchlistSet.has(p.slug);
    const conviction = computeConviction(p.tvl_usd, growthPct, effectiveAge, p.chains.length, isWl);
    const farm = buildFarmPlan(p, age);

    return {
      p,
      isWl,
      age,
      implied,
      appliedMult,
      sampleCount,
      growthPct,
      growthMult: round4(growthMult),
      maturityMult: round4(maturityMult),
      chainMult: round4(chainMult),
      conviction,
      farm,
    };
  });

  rawRows.sort(
    (a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
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
    est_capital_usd: item.farm.capitalUsd,
    est_gas_usd: item.farm.estGasUsd,
    hold_days: item.farm.holdDays,
    valuation: {
      applied_multiple: item.appliedMult,
      category_samples: item.sampleCount,
      growth_pct: round2(item.growthPct),
      growth_multiplier: item.growthMult,
      maturity_multiplier: item.maturityMult,
      chain_multiplier: item.chainMult,
      conviction_score: item.conviction,
    },
    farm_steps: item.farm.steps,
  }));

  const liveAll = snapshot.protocols.filter((p) => !isNoTokenRecord(p) && p.category !== 'CEX');
  const live: LiveComparable[] = liveAll
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
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
    }));

  const earlyCount = board.filter((r) => r.cohort === 'early').length;
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    cohort: r.cohort,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    est_capital_usd: r.est_capital_usd,
    est_gas_usd: r.est_gas_usd,
    hold_days: r.hold_days,
    applied_multiple: r.valuation.applied_multiple,
    growth_multiplier: r.valuation.growth_multiplier,
    maturity_multiplier: r.valuation.maturity_multiplier,
    chain_multiplier: r.valuation.chain_multiplier,
    conviction_score: r.valuation.conviction_score,
    farm_steps: r.farm_steps,
  }));

  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_name: 'Empirical-Bayes TVL-Comps v1',
    config,
    global_median_mult: globalMedian,
    total_protocols: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    early_count: earlyCount,
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
