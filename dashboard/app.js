(() => {
  'use strict';

  const D = window.RADAR;
  if (!D || !Array.isArray(D.rows)) {
    document.body.innerHTML = '<p style="padding:24px;color:#fb7185">Missing window.RADAR dataset</p>';
    return;
  }

  const state = {
    view: 'all',
    search: '',
    category: '',
    chain: '',
    verdict: '',
    minTvl: 0,
    sort: 'rank',
    budget: 1000,
    rightChart: 'fdv',
    proofOpen: false,
    selectedSlug: null,
  };

  const $ = (id) => document.getElementById(id);

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(abs < 100 ? 2 : 0);
  }

  function fmtPct(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '<span class="dim">n/a</span>';
    const cls = v >= 0 ? 'pos' : 'neg';
    return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  }

  function computeEconomics(r) {
    const cap = state.budget;
    const odds = r.token_odds_pct / 100;
    const carry = cap * 0.045 * (r.hold_days / 365);
    const gross = (cap / (r.tvl_usd + cap)) * (0.05 * r.implied_value_usd) * odds;
    const netEv = gross - r.est_gas_usd - carry;
    const roi = (netEv / cap) * 100;
    let verdict = 'SKIP';
    if (netEv >= 8 && roi >= 0.8) verdict = 'STRONG FARM';
    else if (netEv > 0) verdict = 'FARM';
    else if (netEv > -6 && gross > r.est_gas_usd) verdict = 'SELECTIVE';
    return { ...r, dyn_cap: cap, dyn_carry: carry, dyn_gross: gross, dyn_ev: netEv, dyn_roi: roi, dyn_verdict: verdict };
  }

  function verdictBadge(v) {
    const cls = v === 'STRONG FARM' ? 'v-strong' : v === 'FARM' ? 'v-farm' : v === 'SELECTIVE' ? 'v-sel' : 'v-skip';
    return `<span class="v-pill ${cls}">${esc(v)}</span>`;
  }

  function applyFilters(allRows) {
    const q = state.search.trim().toLowerCase();
    if (state.view === 'live') {
      return D.live.filter((p) => {
        if (state.category && (p.category || '') !== state.category) return false;
        if (state.chain && !p.chains.includes(state.chain)) return false;
        if (state.minTvl > 0 && p.tvl_usd < state.minTvl) return false;
        if (q && !(`${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q))) return false;
        return true;
      });
    }

    const filtered = allRows.filter((r) => {
      if (state.view === 'watchlist' && r.cohort !== 'watchlist') return false;
      if (state.view === 'early' && r.cohort !== 'early') return false;
      if (state.view === 'farmable' && r.dyn_ev <= 0) return false;
      if (state.category && (r.category || '') !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (state.verdict && r.dyn_verdict !== state.verdict) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (q && !(`${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    });

    const sorters = {
      rank: (a, b) => a.rank - b.rank,
      ev: (a, b) => b.dyn_ev - a.dyn_ev || b.token_odds_pct - a.token_odds_pct,
      odds: (a, b) => b.token_odds_pct - a.token_odds_pct || b.implied_value_usd - a.implied_value_usd,
      pfdv: (a, b) => b.prob_weighted_fdv_usd - a.prob_weighted_fdv_usd,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999),
      conviction: (a, b) => b.conviction_score - a.conviction_score || b.dyn_ev - a.dyn_ev,
    };
    filtered.sort(sorters[state.sort] || sorters.rank);
    return filtered;
  }

  function renderHeaderAndKpis(allRows) {
    const c = D.coefficients;
    const v = D.validation;
    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent =
      `Snapshot ${D.as_of} · ${D.total_protocols} protocols (${D.watchlist_count} Watchlist >= ${fmtUsd(D.floor_usd)} + ${D.early_count} Early) · ${D.excluded_pretoken_count} wrapped/bridge excluded`;
    $('live-sep-pill').textContent = `${D.live_token_count} LIVE TOKENS SEPARATED`;
    $('curve-note').textContent = `MCAP ~ TVL^${c.beta_log_tvl.toFixed(2)} · 5-fold CV Log-RMSE ${v.cv_5fold.model_log_rmse.toFixed(2)} vs ${v.cv_5fold.naive_log_rmse.toFixed(2)} naive`;

    const farmable = allRows.filter((r) => r.dyn_ev > 0);
    const strong = allRows.filter((r) => r.dyn_verdict === 'STRONG FARM');
    const bestEv = [...allRows].sort((a, b) => b.dyn_ev - a.dyn_ev)[0];

    $('cnt-all').textContent = String(allRows.length);
    $('cnt-wl').textContent = String(D.watchlist_count);
    $('cnt-early').textContent = String(D.early_count);
    $('cnt-farm').textContent = String(farmable.length);
    $('cnt-live').textContent = String(D.live.length);

    $('kpi-grid').innerHTML = [
      { label: 'Watchlist Coverage', val: `${D.watchlist_count} / ${D.watchlist_count}`, cls: 'emerald', foot: `100% floor + ${D.early_count} early pre-token` },
      { label: 'Fitted Size Elasticity', val: `TVL^${c.beta_log_tvl.toFixed(2)}`, cls: 'sky', foot: `Ridge (${c.lambda_tvl}/${c.lambda_rest}) + Cat EB (k=${c.category_shrinkage_k})` },
      { label: 'Held-Out Log-RMSE', val: `${v.cv_5fold.model_log_rmse.toFixed(2)} vs ${v.cv_5fold.naive_log_rmse.toFixed(2)}`, cls: 'emerald', foot: `Holdout: ${v.temporal_holdout.model_log_rmse.toFixed(2)} vs ${v.temporal_holdout.naive_log_rmse.toFixed(2)} naive` },
      { label: 'Peer Token-Odds AUC', val: `${v.token_odds_cv_auc.toFixed(3)}`, cls: 'violet', foot: `5-fold Brier ${v.token_odds_cv_brier.toFixed(3)} across ${v.token_odds_universe} peers` },
      { label: `Farm Alpha ($${state.budget})`, val: `${strong.length} Strong / ${farmable.length} +EV`, cls: 'gold', foot: bestEv ? `Top EV: +$${bestEv.dyn_ev.toFixed(2)} (${bestEv.name})` : '' },
    ].map((k) => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-val ${k.cls}">${k.val}</div><div class="kpi-foot">${esc(k.foot)}</div></div>`).join('');
  }

  function renderProofPanel() {
    const panel = $('proof-panel');
    panel.classList.toggle('hidden', !state.proofOpen);
    $('proof-toggle').classList.toggle('active', state.proofOpen);
    if (!state.proofOpen) return;
    const v = D.validation;
    const w = v.token_odds_weights;
    const rowHtml = (m) => `<tr>
      <td>${esc(m.name)} (n=${m.sample_count})</td>
      <td class="pos">${m.model_log_rmse.toFixed(3)}</td>
      <td class="dim">${m.naive_log_rmse.toFixed(3)}</td>
      <td>${m.model_mdape_pct.toFixed(1)}% <span class="dim">(${m.naive_mdape_pct.toFixed(1)}%)</span></td>
      <td>${m.model_spearman.toFixed(3)}</td>
    </tr>`;
    panel.innerHTML = `
      <div>
        <div class="proof-title">Dual Out-of-Sample Valuation Validation (Live Comps)</div>
        <table class="proof-table">
          <thead><tr><th>Split</th><th>Model Log-RMSE</th><th>Naive RMSE</th><th>MdAPE (Naive)</th><th>Spearman</th></tr></thead>
          <tbody>${rowHtml(v.cv_5fold)}${rowHtml(v.temporal_holdout)}</tbody>
        </table>
      </div>
      <div>
        <div class="proof-title">Peer Token-Odds Logistic Fit (AUC ${v.token_odds_cv_auc.toFixed(3)} · Brier ${v.token_odds_cv_brier.toFixed(3)})</div>
        <div class="weights-grid">
          <div class="w-chip"><span>log(TVL)</span><span>${w.log_tvl >= 0 ? '+' : ''}${w.log_tvl.toFixed(3)}</span></div>
          <div class="w-chip"><span>log(Age+30)</span><span>${w.log_age >= 0 ? '+' : ''}${w.log_age.toFixed(3)}</span></div>
          <div class="w-chip"><span>log(Chains)</span><span>${w.log_chains >= 0 ? '+' : ''}${w.log_chains.toFixed(3)}</span></div>
          <div class="w-chip"><span>7d Momentum</span><span>${w.growth_asinh >= 0 ? '+' : ''}${w.growth_asinh.toFixed(3)}</span></div>
          <div class="w-chip"><span>Cat Peer Prior</span><span>${w.category_prior >= 0 ? '+' : ''}${w.category_prior.toFixed(3)}</span></div>
          <div class="w-chip"><span>No-Age Flag</span><span>${w.missing_age >= 0 ? '+' : ''}${w.missing_age.toFixed(3)}</span></div>
        </div>
      </div>`;
  }

  function renderCurveChart(allRows) {
    const svgW = 580;
    const svgH = 225;
    const padL = 56;
    const padR = 18;
    const padT = 16;
    const padB = 30;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const xMin = Math.log10(4e6);
    const xMax = Math.log10(1.2e10);
    const yMin = Math.log10(4e5);
    const yMax = Math.log10(2e10);
    const mapX = (tvl) => padL + ((Math.log10(Math.max(4e6, tvl)) - xMin) / (xMax - xMin)) * plotW;
    const mapY = (val) => padT + plotH - ((Math.log10(Math.max(4e5, val)) - yMin) / (yMax - yMin)) * plotH;

    const gridX = [1e7, 1e8, 1e9, 1e10].map((v) => {
      const x = mapX(v);
      return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#1c2535"/>
        <text x="${x}" y="${svgH - 8}" text-anchor="middle" fill="#64748b" font-size="9.5" font-family="ui-monospace,monospace">${fmtUsd(v)}</text>`;
    }).join('');
    const gridY = [1e6, 1e7, 1e8, 1e9, 1e10].map((v) => {
      const y = mapY(v);
      return `<line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="#1c2535"/>
        <text x="${padL - 7}" y="${y + 3}" text-anchor="end" fill="#64748b" font-size="9.5" font-family="ui-monospace,monospace">${fmtUsd(v)}</text>`;
    }).join('');

    const c = D.coefficients;
    const linePts = [4e6, 2e7, 1e8, 5e8, 2.5e9, 1e10].map((tvl) => {
      const mcap = Math.exp(c.intercept + c.beta_log_tvl * (Math.log(tvl) - c.mean_log_tvl));
      return `${mapX(tvl).toFixed(1)},${mapY(mcap).toFixed(1)}`;
    }).join(' ');

    const liveDots = D.live.slice(0, 120).map((p) =>
      `<circle cx="${mapX(p.tvl_usd).toFixed(1)}" cy="${mapY(p.mcap_usd).toFixed(1)}" r="2.3" fill="#a78bfa" fill-opacity="0.38"/>`
    ).join('');

    const preDots = allRows.map((r) => {
      const col = r.cohort === 'watchlist' ? '#f0b90b' : '#38bdf8';
      const sel = r.slug === state.selectedSlug;
      return `<circle class="pt" data-slug="${esc(r.slug)}" cx="${mapX(r.tvl_usd).toFixed(1)}" cy="${mapY(r.implied_value_usd).toFixed(1)}" r="${sel ? 5 : 2.8}" fill="${col}" fill-opacity="${sel ? 1 : 0.78}" stroke="${sel ? '#fff' : 'none'}" style="cursor:pointer"/>`;
    }).join('');

    const legend = `<text x="${padL + 6}" y="${padT + 10}" fill="#a78bfa" font-size="9.5" font-family="ui-monospace,monospace">● Live comps</text>
      <text x="${padL + 84}" y="${padT + 10}" fill="#f0b90b" font-size="9.5" font-family="ui-monospace,monospace">● Watchlist</text>
      <text x="${padL + 162}" y="${padT + 10}" fill="#38bdf8" font-size="9.5" font-family="ui-monospace,monospace">● Early</text>
      <text x="${padL + 216}" y="${padT + 10}" fill="#10b981" font-size="9.5" font-family="ui-monospace,monospace">— Fitted TVL^${c.beta_log_tvl.toFixed(2)}</text>`;

    $('chart-curve').innerHTML = `<svg viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="TVL vs Implied FDV curve">${gridX}${gridY}${liveDots}<polyline fill="none" stroke="#10b981" stroke-width="2" points="${linePts}"/>${preDots}${legend}</svg>`;
    $('chart-curve').querySelectorAll('.pt').forEach((el) => {
      el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); });
    });
  }

  function renderTopChart(filtered) {
    const isEv = state.rightChart === 'ev';
    $('right-chart-title').textContent = isEv ? `Top Net Farm EV ($${state.budget} Budget)` : 'Top Implied Pre-Token Launches [P25–P75]';
    const items = [...filtered]
      .sort((a, b) => isEv ? b.dyn_ev - a.dyn_ev : b.implied_value_usd - a.implied_value_usd)
      .slice(0, 9);
    if (items.length === 0) {
      $('chart-top').innerHTML = '<div class="panel-note" style="padding:20px 0">No matching pre-token rows.</div>';
      return;
    }
    const maxVal = Math.max(...items.map((r) => isEv ? Math.max(1, r.dyn_ev) : r.implied_high_usd), 1);
    const svgW = 580;
    const rowH = 24;
    const h = items.length * rowH + 8;
    const labelW = 152;
    const barMaxW = 305;

    const bars = items.map((r, i) => {
      const y = i * rowH + 4;
      const val = isEv ? Math.max(0, r.dyn_ev) : r.implied_value_usd;
      const w = Math.max(4, Math.round((val / maxVal) * barMaxW));
      const color = isEv ? '#10b981' : (r.cohort === 'watchlist' ? '#f0b90b' : '#38bdf8');
      const sel = r.slug === state.selectedSlug;
      let whisker = '';
      if (!isEv) {
        const x1 = labelW + Math.round((r.implied_low_usd / maxVal) * barMaxW);
        const x2 = labelW + Math.round((r.implied_high_usd / maxVal) * barMaxW);
        whisker = `<line x1="${x1}" y1="${y + 9}" x2="${x2}" y2="${y + 9}" stroke="#94a3b8" stroke-width="1.2"/>`;
      }
      const lbl = isEv ? `+$${r.dyn_ev.toFixed(2)} (${r.farm_chain})` : `${fmtUsd(r.implied_value_usd)} (${r.token_odds_pct.toFixed(0)}%)`;
      return `<g class="chart-row" data-slug="${esc(r.slug)}" style="cursor:pointer">
        <rect x="0" y="${y}" width="${svgW}" height="${rowH - 2}" rx="4" fill="${sel ? 'rgba(240,185,11,0.12)' : 'transparent'}"/>
        <text x="${labelW - 8}" y="${y + 13}" text-anchor="end" fill="#cbd5e1" font-size="10.5" font-family="ui-sans-serif,system-ui,sans-serif">${esc(r.name.slice(0, 21))}</text>
        <rect x="${labelW}" y="${y + 4}" width="${barMaxW}" height="10" rx="2" fill="#172030"/>
        <rect x="${labelW}" y="${y + 4}" width="${w}" height="10" rx="2" fill="${color}" fill-opacity="0.86"/>
        ${whisker}
        <text x="${labelW + barMaxW + 8}" y="${y + 13}" fill="#e6edf6" font-size="10.5" font-family="ui-monospace,monospace">${esc(lbl)}</text>
      </g>`;
    }).join('');

    $('chart-top').innerHTML = `<svg viewBox="0 0 ${svgW} ${h}" role="img" aria-label="Top ranked pre-token protocols">${bars}</svg>`;
    $('chart-top').querySelectorAll('.chart-row').forEach((el) => {
      el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); });
    });
  }

  function renderTable(filtered) {
    const head = $('table-head');
    const body = $('table-body');
    if (state.view === 'live') {
      $('filter-summary').textContent = `${filtered.length} of ${D.live.length} live comps`;
      head.innerHTML = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Live MCAP</th><th class="num">MCAP/TVL</th><th class="num">7d &Delta;</th><th class="num">Age</th></tr>';
      body.innerHTML = filtered.slice(0, 150).map((p) => `<tr>
        <td><div class="proto-name">${esc(p.name)} <span class="badge b-live">${esc(p.symbol || 'LIVE')}</span></div><div class="subline">${esc(p.chains.slice(0, 4).join(', '))}</div></td>
        <td>${esc(p.category || 'Other')}</td>
        <td class="num mono">${fmtUsd(p.tvl_usd)}</td>
        <td class="num mono violet">${fmtUsd(p.mcap_usd)}</td>
        <td class="num mono">${p.mcap_tvl_ratio.toFixed(2)}x</td>
        <td class="num mono">${fmtPct(p.change_7d)}</td>
        <td class="num mono dim">${p.age_days !== null ? p.age_days + 'd' : 'n/a'}</td>
      </tr>`).join('');
      return;
    }

    $('filter-summary').textContent = `${filtered.length} of ${D.rows.length} pre-token shown`;
    head.innerHTML = '<tr><th>Rank</th><th>Protocol</th><th>Category</th><th class="num">TVL / 7d</th><th class="num">Token Odds</th><th class="num">Implied FDV</th><th class="num">Farm Verdict &amp; Net EV</th></tr>';
    body.innerHTML = filtered.map((r) => {
      const sel = r.slug === state.selectedSlug ? 'selected' : '';
      const badge = r.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
      const chains = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : '');
      const evCls = r.dyn_ev >= 0 ? 'pos' : 'neg';
      const evStr = `${r.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev).toFixed(2)}`;
      return `<tr class="${sel}" data-slug="${esc(r.slug)}">
        <td class="mono sky">#${r.rank}</td>
        <td><div class="proto-name">${esc(r.name)} ${badge}</div><div class="subline">${esc(chains)}</div></td>
        <td><div>${esc(r.category || 'Uncat')}</div><div class="subline mono">${r.applied_multiple.toFixed(2)}x mult</div></td>
        <td class="num mono"><div>${fmtUsd(r.tvl_usd)}</div><div class="subline">${fmtPct(r.change_7d)}</div></td>
        <td class="num mono"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.min(100, r.token_odds_pct)}%"></div></div><span>${r.token_odds_pct.toFixed(0)}%</span></div><div class="subline">E: ${fmtUsd(r.prob_weighted_fdv_usd)}</div></td>
        <td class="num mono"><div class="gold">${fmtUsd(r.implied_value_usd)}</div><div class="subline">${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)}</div></td>
        <td class="num"><div>${verdictBadge(r.dyn_verdict)} <span class="mono ${evCls}">${evStr}</span></div><div class="subline mono">${esc(r.farm_chain)} · $${r.est_gas_usd.toFixed(2)} gas · ${r.hold_days}d</div></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('tr[data-slug]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const slug = tr.getAttribute('data-slug');
        state.selectedSlug = state.selectedSlug === slug ? null : slug;
        renderAll();
      });
    });
  }

  function renderDetail(allRows) {
    const drawer = $('detail-drawer');
    const ws = $('workspace');
    const row = state.view !== 'live' ? allRows.find((r) => r.slug === state.selectedSlug) : null;
    if (!row) {
      drawer.classList.add('hidden');
      ws.classList.remove('has-detail');
      return;
    }
    drawer.classList.remove('hidden');
    ws.classList.add('has-detail');

    const peers = D.live.filter((p) => (p.category || '') === (row.category || '')).slice(0, 4);
    const compItems = [{ name: `${row.name.slice(0, 14)} (Est.)`, val: row.implied_value_usd, est: true }, ...peers.map((p) => ({ name: `${p.name.slice(0, 14)} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, est: false }))];
    const maxV = Math.max(...compItems.map((c) => c.val), 1);
    const svgH = compItems.length * 22 + 6;
    const compSvg = `<svg viewBox="0 0 430 ${svgH}" style="width:100%;height:auto">${compItems.map((c, i) => {
      const y = i * 22 + 3;
      const w = Math.max(4, Math.round((c.val / maxV) * 190));
      return `<text x="150" y="${y + 12}" text-anchor="end" fill="#cbd5e1" font-size="10">${esc(c.name)}</text>
        <rect x="158" y="${y + 3}" width="190" height="10" rx="2" fill="#172030"/>
        <rect x="158" y="${y + 3}" width="${w}" height="10" rx="2" fill="${c.est ? '#f0b90b' : '#a78bfa'}"/>
        <text x="356" y="${y + 12}" fill="#e6edf6" font-size="10" font-family="ui-monospace,monospace">${fmtUsd(c.val)}</text>`;
    }).join('')}</svg>`;

    const evStr = `${row.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(row.dyn_ev).toFixed(2)} (${row.dyn_roi.toFixed(1)}%)`;
    drawer.innerHTML = `
      <div class="drawer-head">
        <div>
          <div class="drawer-title">${esc(row.name)} ${row.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>'}</div>
          <div class="drawer-meta">Rank #${row.rank} · ${esc(row.category || 'Uncategorized')} · ${row.age_days !== null ? row.age_days + 'd old' : 'age n/a'} · ${esc(row.chains.join(', '))}</div>
        </div>
        <button class="btn-ghost" id="drawer-close" type="button">Close</button>
      </div>
      <div class="drawer-note">No token recorded in DefiLlama snapshot. Peer Token Odds (${row.token_odds_pct.toFixed(1)}%) reflects historical peer prevalence, not a prediction of launch.</div>
      <div class="section-lbl"><span>Valuation &amp; Odds Decomposition</span><span>P25–P75: ${fmtUsd(row.implied_low_usd)}–${fmtUsd(row.implied_high_usd)}</span></div>
      <div class="decomp-grid">
        <div class="d-box"><div class="d-lbl">Snapshot TVL</div><div class="d-val">${fmtUsd(row.tvl_usd)}</div></div>
        <div class="d-box"><div class="d-lbl">Implied FDV</div><div class="d-val gold">${fmtUsd(row.implied_value_usd)}</div></div>
        <div class="d-box"><div class="d-lbl">Peer Token Odds</div><div class="d-val sky">${row.token_odds_pct.toFixed(1)}%</div></div>
        <div class="d-box"><div class="d-lbl">Cat EB Adj</div><div class="d-val">${row.category_adj_mult.toFixed(2)}x</div></div>
        <div class="d-box"><div class="d-lbl">7d / Age Mult</div><div class="d-val">${row.growth_multiplier.toFixed(2)}x / ${row.maturity_multiplier.toFixed(2)}x</div></div>
        <div class="d-box"><div class="d-lbl">Prob-Wtd FDV</div><div class="d-val violet">${fmtUsd(row.prob_weighted_fdv_usd)}</div></div>
      </div>
      <div class="section-lbl"><span>Vs Live Category Comparables</span><span>${peers.length} peers</span></div>
      <div>${compSvg}</div>
      <div class="section-lbl"><span>Costed Farm Economics ($${row.dyn_cap} Budget)</span><span>${verdictBadge(row.dyn_verdict)}</span></div>
      <div class="decomp-grid">
        <div class="d-box"><div class="d-lbl">Gross Airdrop Est</div><div class="d-val">+$${row.dyn_gross.toFixed(2)}</div></div>
        <div class="d-box"><div class="d-lbl">Gas + Carry Cost</div><div class="d-val">-$${(row.est_gas_usd + row.dyn_carry).toFixed(2)}</div></div>
        <div class="d-box"><div class="d-lbl">Net EV (ROI)</div><div class="d-val ${row.dyn_ev >= 0 ? 'pos' : 'neg'}">${evStr}</div></div>
      </div>
      <div class="section-lbl"><span>Execution Steps (${esc(row.farm_chain)})</span><span>${row.tx_count} txs · ${row.hold_days}d hold</span></div>
      <ol class="steps-list">${row.farm_steps.map((s, i) => `<li class="step-item"><span class="step-num">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}</ol>`;

    $('drawer-close').addEventListener('click', () => { state.selectedSlug = null; renderAll(); });
  }

  function renderAll() {
    const allRows = D.rows.map(computeEconomics);
    renderHeaderAndKpis(allRows);
    renderProofPanel();
    const filtered = applyFilters(allRows);
    renderCurveChart(allRows);
    renderTopChart(state.view === 'live' ? allRows : filtered);
    renderTable(filtered);
    renderDetail(allRows);
  }

  function initSelects() {
    const cats = [...new Set([...D.rows.map((r) => r.category), ...D.live.map((p) => p.category)].filter(Boolean))].sort();
    $('f-cat').innerHTML = '<option value="">All Categories</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
    $('f-chain').innerHTML = '<option value="">All Chains</option>' + chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.getAttribute('data-view');
      renderAll();
    });
  });

  document.querySelectorAll('.mini-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mini-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.rightChart = btn.getAttribute('data-chart');
      renderAll();
    });
  });

  $('proof-toggle').addEventListener('click', () => { state.proofOpen = !state.proofOpen; renderAll(); });
  $('f-budget').addEventListener('change', (e) => { state.budget = Number(e.target.value) || 1000; renderAll(); });
  $('f-search').addEventListener('input', (e) => { state.search = e.target.value; renderAll(); });
  $('f-cat').addEventListener('change', (e) => { state.category = e.target.value; renderAll(); });
  $('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderAll(); });
  $('f-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderAll(); });
  $('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value) || 0; renderAll(); });
  $('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderAll(); });
  $('f-reset').addEventListener('click', () => {
    state.search = ''; state.category = ''; state.chain = ''; state.verdict = ''; state.minTvl = 0; state.sort = 'rank';
    $('f-search').value = ''; $('f-cat').value = ''; $('f-chain').value = ''; $('f-verdict').value = ''; $('f-tvl').value = '0'; $('f-sort').value = 'rank';
    renderAll();
  });

  initSelects();
  renderAll();
})();
