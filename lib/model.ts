/**
 * Node 22 bridge to dashboard/model-engine.js so CLI output (board.json, data.js)
 * and the browser dashboard execute the exact same valuation and farm-plan code.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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
  est_bridge_usd: number;
  est_slippage_usd: number;
  carry_cost_usd: number;
  total_cost_usd: number;
  gross_airdrop_usd: number;
  net_ev_usd: number;
  net_roi_pct: number;
  hold_days: number;
  farm_chain: string;
  farm_verdict: string;
  sector: string;
  adj_source: string;
  valuation: {
    base_size_fdv_usd: number;
    applied_multiple: number;
    category_samples: number;
    category_adj_mult: number;
    growth_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model_name: string;
  coefficients: {
    intercept: number;
    beta_log_tvl: number;
    beta_growth_asinh: number;
    beta_log_age: number;
    mean_log_tvl: number;
    median_age_days: number;
    oof_q25_log_err: number;
    oof_q75_log_err: number;
    global_median_mult: number;
  };
  validation: {
    cv_5fold: {
      model_log_rmse: number;
      naive_log_rmse: number;
    };
  };
  watchlist_count: number;
  early_count: number;
  live_token_count: number;
  rows: unknown[];
  live: unknown[];
}

interface RadarEngineApi {
  buildRadar: (snapshot: Snapshot) => { board: BoardRow[]; radar: RadarPayload };
}

let cachedEngine: RadarEngineApi | null = null;

function loadEngine(): RadarEngineApi {
  if (cachedEngine) return cachedEngine;
  const enginePath = join(fileURLToPath(new URL('..', import.meta.url)), 'dashboard', 'model-engine.js');
  const code = readFileSync(enginePath, 'utf8');
  const sandbox: Record<string, unknown> = { Math, Number, String, Array, Map, Set, Date, JSON, Object };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'dashboard/model-engine.js' });
  cachedEngine = sandbox.RadarEngine as RadarEngineApi;
  return cachedEngine;
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

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarPayload } {
  return loadEngine().buildRadar(snapshot);
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
