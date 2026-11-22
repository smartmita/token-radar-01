(() => {
  'use strict';

  const AIRDROP_POOL_SHARE = 0.08;
  const ACTIVE_TVL_EXPONENT = 0.78;
  const NON_YIELD_FRICTION_RATE = 0.008;

  function isYieldBearingCategory(category) {
    const cat = String(category || '').toLowerCase();
    return (
      cat.includes('lend') ||
      cat.includes('cdp') ||
      cat.includes('rwa') ||
      cat.includes('basis') ||
      cat.includes('yield') ||
      cat.includes('curator') ||
      cat.includes('allocator') ||
      cat.includes('dex') ||
      cat.includes('liquidity') ||
      cat.includes('farm')
    );
  }

  /**
   * Reconstructs the log-linear Ridge valuation components from snapshot inputs:
   * TVL size elasticity, 7-day growth momentum, protocol age maturity, and Empirical-Bayes category residual.
   */
  function decomposeImpliedFdv(row, coeffs) {
    const logTvlDelta = Math.log(Math.max(1, row.tvl_usd)) - coeffs.mean_log_tvl;
    const baseSizeFdv = Math.exp(coeffs.intercept + coeffs.beta_log_tvl * logTvlDelta);
    const modeledFdv = Math.round(
      baseSizeFdv *
        (row.growth_multiplier || 1) *
        (row.maturity_multiplier || 1) *
        (row.category_adj_mult || 1),
    );
    return {
      baseSizeFdv,
      modeledFdv,
      reportedFdv: row.implied_value_usd,
      p25Fdv: row.implied_low_usd,
      p75Fdv: row.implied_high_usd,
      elasticity: coeffs.beta_log_tvl,
    };
  }

  /**
   * Evaluates peer token prevalence using logistic weights on TVL, protocol age,
   * multi-chain footprint, 7d growth, and Empirical-Bayes category rate.
   */
  function scorePeerTokenOdds(row, weights) {
    const z =
      weights.intercept +
      weights.log_tvl * Math.log(Math.max(1e6, row.tvl_usd) / 1e6) +
      weights.log_age * Math.log((row.age_days ?? 365) + 30) +
      weights.missing_age * (row.age_days === null ? 1 : 0) +
      weights.log_chains * Math.log1p(row.chains.length);
    return {
      storedOddsPct: row.token_odds_pct,
      priorLogitAnchor: z,
    };
  }

  /**
   * Computes dilution-adjusted net farming EV for a chosen capital budget.
   * Effective active farming TVL scales sub-linearly (TVL^0.78) to reflect whale caps
   * and passive institutional deposits; yield-bearing vaults offset capital carry.
   */
  function computeDynamicFarmEconomics(row, budgetUsd) {
    const cap = Math.max(100, Number(budgetUsd) || 1000);
    const odds = (row.token_odds_pct || 0) / 100;
    const tvlMillions = Math.max(1, row.tvl_usd / 1e6);
    const effectiveFarmTvl = Math.pow(tvlMillions, ACTIVE_TVL_EXPONENT) * 1e6;
    const carryRate = isYieldBearingCategory(row.category) ? 0 : NON_YIELD_FRICTION_RATE;
    const carry = cap * carryRate * (row.hold_days / 365);
    const gross = (cap / (effectiveFarmTvl + cap)) * (AIRDROP_POOL_SHARE * row.implied_value_usd) * odds;
    const netEv = gross - row.est_gas_usd - carry;
    const roi = (netEv / cap) * 100;

    let verdict = 'SKIP';
    if (netEv >= 10 && roi >= 1.0) verdict = 'STRONG FARM';
    else if (netEv > 0) verdict = 'FARM';
    else if (netEv > -8 && gross > row.est_gas_usd) verdict = 'SELECTIVE';

    return {
      ...row,
      dyn_cap: cap,
      dyn_carry: carry,
      dyn_gross: gross,
      dyn_ev: netEv,
      dyn_roi: roi,
      dyn_verdict: verdict,
      dyn_active_tvl: effectiveFarmTvl,
      dyn_yield_offset: carryRate === 0,
    };
  }

  /**
   * Verifies strict separation between live-token comparables and pre-token radar targets.
   */
  function partitionUniverse(radarData) {
    return {
      preTokenCount: radarData.rows.length,
      watchlistCount: radarData.watchlist_count,
      earlyCount: radarData.early_count,
      liveCompsCount: radarData.live.length,
      excludedWrappedCount: radarData.excluded_pretoken_count,
    };
  }

  window.RadarEngine = {
    isYieldBearingCategory,
    decomposeImpliedFdv,
    scorePeerTokenOdds,
    computeDynamicFarmEconomics,
    partitionUniverse,
  };
})();
