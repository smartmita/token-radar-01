(() => {
  'use strict';

  const D = window.RADAR;
  const E = window.RadarEngine;
  if (!D || !Array.isArray(D.rows) || !E) {
    document.body.innerHTML = '<p style="padding:24px;color:#fb7185">Missing window.RADAR dataset or RadarEngine</p>';
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
    chartsHidden: false,
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
    return E.computeDynamicFarmEconomics(r, state.budget);
  }

  function verdictBadge(v) {
    const cls = v === 'STRONG FARM' ? 'v-strong' : v === 'FARM' ? 'v-farm' : v === 'SELECTIVE' ? 'v-sel' : 'v-skip';
    return `<span class="v-pill ${cls}">${esc(v)}</span>`;
  }

  function applyFilters(allRows) {
    const q = state.search.trim().toLowerCase();
    if (state.view === 'live') {
      return D.live.filter((p) => (!state.category || (p.category || '') === state.category) && (!state.chain || p.chains.includes(state.chain)) && (state.minTvl <= 0 || p.tvl_usd >= state.minTvl) && (!q || `${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q)));
    }
    const filtered = allRows.filter((r) => (state.view !== 'watchlist' || r.cohort === 'watchlist') && (state.view !== 'early' || r.cohort === 'early') && (state.view !== 'farmable' || r.dyn_ev > 0) && (!state.category || (r.category || '') === state.category) && (!state.chain || r.chains.includes(state.chain)) && (!state.verdict || r.dyn_verdict === state.verdict) && (state.minTvl <= 0 || r.tvl_usd >= state.minTvl) && (!q || `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)));
    const sorters = {
      rank: (a, b) => a.rank - b.rank,
      ev: (a, b) => b.dyn_ev - a.dyn_ev || b.token_odds_pct - a.token_odds_pct,
      odds: (a, b) => b.token_odds_pct - a.token_odds_pct || b.implied_value_usd - a.implied_value_usd,
      pfdv: (a, b) => b.prob_weighted_fdv_usd - a.prob_weighted_fdv_usd,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999),
      conviction: (a, b) => b.conviction_score - a.conviction_score || b.dyn_ev - a.dyn_ev,
    };
    return filtered.sort(sorters[state.sort] || sorters.rank);
  }

  function renderHeaderAndKpis(allRows) {
    const c = D.coefficients, v = D.validation, part = E.partitionUniverse(D);
    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent = `Snapshot ${D.as_of} · ${D.total_protocols} protocols: ${part.preTokenCount + part.excludedWrappedCount} no-token (${part.watchlistCount} Watchlist + ${part.earlyCount} Early + ${part.excludedWrappedCount} excl.) · ${part.liveTotalCount} live (${part.liveCompsCount} comps)`;
    $('live-sep-pill').textContent = `${part.liveTotalCount} LIVE TOKENS SEPARATED`;
    $('curve-note').textContent = `MCAP ~ TVL^${c.beta_log_tvl.toFixed(2)} · 5-fold CV Log-RMSE ${v.cv_5fold.model_log_rmse.toFixed(2)} vs ${v.cv_5fold.naive_log_rmse.toFixed(2)} naive`;
    const farmable = allRows.filter((r) => r.dyn_ev > 0), strong = allRows.filter((r) => r.dyn_verdict === 'STRONG FARM');
    const bestEv = [...allRows].sort((a, b) => b.dyn_ev - a.dyn_ev)[0];
    $('cnt-all').textContent = String(allRows.length);
    $('cnt-wl').textContent = String(part.watchlistCount);
    $('cnt-early').textContent = String(part.earlyCount);
    $('cnt-farm').textContent = String(farmable.length);
    $('cnt-live').textContent = String(part.liveCompsCount);
    const kpis = [
      ['Watchlist Coverage', `${part.watchlistCount} / ${part.watchlistCount}`, 'emerald', `100% floor + ${part.earlyCount} early pre-token`],
      ['Fitted Size Elasticity', `TVL^${c.beta_log_tvl.toFixed(2)}`, 'sky', `Ridge (${c.lambda_tvl}/${c.lambda_rest}) + Cat EB (k=${c.category_shrinkage_k})`],
      ['Held-Out Log-RMSE', `${v.cv_5fold.model_log_rmse.toFixed(2)} vs ${v.cv_5fold.naive_log_rmse.toFixed(2)}`, 'emerald', `Holdout: ${v.temporal_holdout.model_log_rmse.toFixed(2)} vs ${v.temporal_holdout.naive_log_rmse.toFixed(2)} naive`],
      ['Peer Token-Odds AUC', `${v.token_odds_cv_auc.toFixed(3)}`, 'violet', `5-fold Brier ${v.token_odds_cv_brier.toFixed(3)} across ${v.token_odds_universe} peers`],
      [`Farm Alpha ($${state.budget})`, `${strong.length} Strong / ${farmable.length} +EV`, 'gold', bestEv ? `Top EV: +$${bestEv.dyn_ev.toFixed(2)} (${bestEv.name})` : ''],
    ];
    $('kpi-grid').innerHTML = kpis.map(([l, val, cls, f]) => `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-val ${cls}">${val}</div><div class="kpi-foot">${esc(f)}</div></div>`).join('');
  }

  function renderProofPanel() {
    const panel = $('proof-panel');
    panel.classList.toggle('hidden', !state.proofOpen);
    $('proof-toggle').classList.toggle('active', state.proofOpen);
    if (!state.proofOpen) return;
    const v = D.validation, w = v.token_odds_weights;
    const rowHtml = (m) => `<tr><td>${esc(m.name)} (n=${m.sample_count})</td><td class="pos">${m.model_log_rmse.toFixed(3)}</td><td class="dim">${m.naive_log_rmse.toFixed(3)}</td><td>${m.model_mdape_pct.toFixed(1)}% <span class="dim">(${m.naive_mdape_pct.toFixed(1)}%)</span></td><td>${m.model_spearman.toFixed(3)}</td></tr>`;
    const chips = [['log(TVL)', w.log_tvl], ['log(Age+30)', w.log_age], ['log(Chains)', w.log_chains], ['7d Momentum', w.growth_asinh], ['Cat Peer Prior', w.category_prior], ['No-Age Flag', w.missing_age]];
    panel.innerHTML = `<div><div class="proof-title">Dual Out-of-Sample Valuation Validation (Live Comps)</div><table class="proof-table"><thead><tr><th>Split</th><th>Model Log-RMSE</th><th>Naive RMSE</th><th>MdAPE (Naive)</th><th>Spearman</th></tr></thead><tbody>${rowHtml(v.cv_5fold)}${rowHtml(v.temporal_holdout)}</tbody></table></div><div><div class="proof-title">Peer Token-Odds Logistic Fit (AUC ${v.token_odds_cv_auc.toFixed(3)} · Brier ${v.token_odds_cv_brier.toFixed(3)})</div><div class="weights-grid">${chips.map(([lbl, val]) => `<div class="w-chip"><span>${lbl}</span><span>${val >= 0 ? '+' : ''}${val.toFixed(3)}</span></div>`).join('')}</div></div>`;
  }

  function renderCurveChart(allRows) {
    const svgW = 580, svgH = 160, padL = 52, padR = 16, padT = 12, padB = 22, plotW = svgW - padL - padR, plotH = svgH - padT - padB;
    const xMin = Math.log10(4e6), xMax = Math.log10(1.2e10), yMin = Math.log10(4e5), yMax = Math.log10(2e10);
    const mapX = (tvl) => padL + ((Math.log10(Math.max(4e6, tvl)) - xMin) / (xMax - xMin)) * plotW;
    const mapY = (val) => padT + plotH - ((Math.log10(Math.max(4e5, val)) - yMin) / (yMax - yMin)) * plotH;
    const gridX = [1e7, 1e8, 1e9, 1e10].map((v) => { const x = mapX(v); return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#1c2535"/><text x="${x}" y="${svgH - 7}" text-anchor="middle" fill="#64748b" font-size="9.5" font-family="ui-monospace,monospace">${fmtUsd(v)}</text>`; }).join('');
    const gridY = [1e6, 1e7, 1e8, 1e9, 1e10].map((v) => { const y = mapY(v); return `<line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="#1c2535"/><text x="${padL - 7}" y="${y + 3}" text-anchor="end" fill="#64748b" font-size="9.5" font-family="ui-monospace,monospace">${fmtUsd(v)}</text>`; }).join('');
    const c = D.coefficients;
    const linePts = [4e6, 2e7, 1e8, 5e8, 2.5e9, 1e10].map((tvl) => `${mapX(tvl).toFixed(1)},${mapY(Math.exp(c.intercept + c.beta_log_tvl * (Math.log(tvl) - c.mean_log_tvl))).toFixed(1)}`).join(' ');
    const liveDots = D.live.slice(0, 120).map((p) => `<circle cx="${mapX(p.tvl_usd).toFixed(1)}" cy="${mapY(p.mcap_usd).toFixed(1)}" r="2.3" fill="#a78bfa" fill-opacity="0.38"/>`).join('');
    const preDots = allRows.map((r) => { const sel = r.slug === state.selectedSlug; return `<circle class="pt" data-slug="${esc(r.slug)}" cx="${mapX(r.tvl_usd).toFixed(1)}" cy="${mapY(r.implied_value_usd).toFixed(1)}" r="${sel ? 5 : 2.8}" fill="${r.cohort === 'watchlist' ? '#f0b90b' : '#38bdf8'}" fill-opacity="${sel ? 1 : 0.78}" stroke="${sel ? '#fff' : 'none'}" style="cursor:pointer"/>`; }).join('');
    const legend = [['#a78bfa', 6, '● Live comps'], ['#f0b90b', 84, '● Watchlist'], ['#38bdf8', 162, '● Early'], ['#10b981', 216, `— Fitted TVL^${c.beta_log_tvl.toFixed(2)}`]].map(([col, x, txt]) => `<text x="${padL + x}" y="${padT + 10}" fill="${col}" font-size="9.5" font-family="ui-monospace,monospace">${txt}</text>`).join('');
    $('chart-curve').innerHTML = `<svg viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="TVL vs Implied FDV curve">${gridX}${gridY}${liveDots}<polyline fill="none" stroke="#10b981" stroke-width="2" points="${linePts}"/>${preDots}${legend}</svg>`;
    $('chart-curve').querySelectorAll('.pt').forEach((el) => el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTopChart(filtered) {
    const isEv = state.rightChart === 'ev';
    $('right-chart-title').textContent = isEv ? `Top Net Farm EV ($${state.budget} Budget)` : 'Top Implied Pre-Token Launches [P25–P75]';
    const items = [...filtered].sort((a, b) => (isEv ? b.dyn_ev - a.dyn_ev : b.implied_value_usd - a.implied_value_usd)).slice(0, 8);
    if (!items.length) { $('chart-top').innerHTML = '<div class="panel-note" style="padding:20px 0">No matching pre-token rows.</div>'; return; }
    const maxVal = Math.max(...items.map((r) => (isEv ? Math.max(1, r.dyn_ev) : r.implied_high_usd)), 1);
    const svgW = 580, rowH = 20, h = items.length * rowH + 6, labelW = 152, barMaxW = 305;
    const bars = items.map((r, i) => {
      const y = i * rowH + 4, val = isEv ? Math.max(0, r.dyn_ev) : r.implied_value_usd, w = Math.max(4, Math.round((val / maxVal) * barMaxW));
      const color = isEv ? '#10b981' : (r.cohort === 'watchlist' ? '#f0b90b' : '#38bdf8'), sel = r.slug === state.selectedSlug;
      const whisker = !isEv ? `<line x1="${labelW + Math.round((r.implied_low_usd / maxVal) * barMaxW)}" y1="${y + 9}" x2="${labelW + Math.round((r.implied_high_usd / maxVal) * barMaxW)}" y2="${y + 9}" stroke="#94a3b8" stroke-width="1.2"/>` : '';
      const lbl = isEv ? `+$${r.dyn_ev.toFixed(2)} (${r.farm_chain})` : `${fmtUsd(r.implied_value_usd)} (${r.token_odds_pct.toFixed(0)}%)`;
      return `<g class="chart-row" data-slug="${esc(r.slug)}" style="cursor:pointer"><rect x="0" y="${y}" width="${svgW}" height="${rowH - 2}" rx="4" fill="${sel ? 'rgba(240,185,11,0.12)' : 'transparent'}"/><text x="${labelW - 8}" y="${y + 13}" text-anchor="end" fill="#cbd5e1" font-size="10.5">${esc(r.name.slice(0, 21))}</text><rect x="${labelW}" y="${y + 4}" width="${barMaxW}" height="10" rx="2" fill="#172030"/><rect x="${labelW}" y="${y + 4}" width="${w}" height="10" rx="2" fill="${color}" fill-opacity="0.86"/>${whisker}<text x="${labelW + barMaxW + 8}" y="${y + 13}" fill="#e6edf6" font-size="10.5" font-family="ui-monospace,monospace">${esc(lbl)}</text></g>`;
    }).join('');
    $('chart-top').innerHTML = `<svg viewBox="0 0 ${svgW} ${h}" role="img" aria-label="Top ranked pre-token protocols">${bars}</svg>`;
    $('chart-top').querySelectorAll('.chart-row').forEach((el) => el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTable(filtered) {
    const head = $('table-head'), body = $('table-body');
    if (state.view === 'live') {
      $('filter-summary').textContent = `${filtered.length} of ${D.live.length} live comps`;
      head.innerHTML = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Live MCAP</th><th class="num">MCAP/TVL</th><th class="num">7d &Delta;</th><th class="num">Age</th></tr>';
      body.innerHTML = filtered.slice(0, 150).map((p) => `<tr><td><div class="proto-name">${esc(p.name)} <span class="badge b-live">${esc(p.symbol || 'LIVE')}</span></div><div class="subline">${esc(p.chains.slice(0, 4).join(', '))}</div></td><td>${esc(p.category || 'Other')}</td><td class="num mono">${fmtUsd(p.tvl_usd)}</td><td class="num mono violet">${fmtUsd(p.mcap_usd)}</td><td class="num mono">${p.mcap_tvl_ratio.toFixed(2)}x</td><td class="num mono">${fmtPct(p.change_7d)}</td><td class="num mono dim">${p.age_days !== null ? p.age_days + 'd' : 'n/a'}</td></tr>`).join('');
      return;
    }

    $('filter-summary').textContent = `${filtered.length} of ${D.rows.length} pre-token shown`;
    const arrow = (k) => (state.sort === k ? ' ▼' : ''), cls = (k, ex = '') => `sortable${state.sort === k ? ' sorted' : ''}${ex ? ' ' + ex : ''}`;
    head.innerHTML = `<tr><th class="${cls('rank')}" data-sort="rank">Rank${arrow('rank')}</th><th>Protocol</th><th>Category</th><th class="${cls('tvl', 'num')}" data-sort="tvl">TVL / 7d${arrow('tvl')}</th><th class="${cls('odds', 'num')}" data-sort="odds">Token Odds${arrow('odds')}</th><th class="${cls('rank', 'num')}" data-sort="rank">Implied FDV${arrow('rank')}</th><th class="${cls('ev', 'num')}" data-sort="ev">Farm Verdict &amp; Net EV${arrow('ev')}</th></tr>`;
    head.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { state.sort = th.getAttribute('data-sort'); $('f-sort').value = state.sort; renderAll(); }));
    body.innerHTML = filtered.map((r) => {
      const sel = r.slug === state.selectedSlug ? 'selected' : '', badge = r.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
      const chains = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''), evCls = r.dyn_ev >= 0 ? 'pos' : 'neg', evStr = `${r.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev).toFixed(2)}`;
      return `<tr class="${sel}" data-slug="${esc(r.slug)}"><td class="mono sky">#${r.rank}</td><td><div class="proto-name">${esc(r.name)} ${badge}</div><div class="subline">${esc(chains)}</div></td><td><div>${esc(r.category || 'Uncat')}</div><div class="subline mono">${r.applied_multiple.toFixed(2)}x mult</div></td><td class="num mono"><div>${fmtUsd(r.tvl_usd)}</div><div class="subline">${fmtPct(r.change_7d)}</div></td><td class="num mono"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.min(100, r.token_odds_pct)}%"></div></div><span>${r.token_odds_pct.toFixed(0)}%</span></div><div class="subline">E: ${fmtUsd(r.prob_weighted_fdv_usd)}</div></td><td class="num mono"><div class="gold">${fmtUsd(r.implied_value_usd)}</div><div class="subline">${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)}</div></td><td class="num"><div>${verdictBadge(r.dyn_verdict)} <span class="mono ${evCls}">${evStr}</span></div><div class="subline mono">${esc(r.farm_chain)} · $${r.est_gas_usd.toFixed(2)} gas · ${r.hold_days}d</div></td></tr>`;
    }).join('');
    body.querySelectorAll('tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => { const s = tr.getAttribute('data-slug'); state.selectedSlug = state.selectedSlug === s ? null : s; renderAll(); }));
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

    const decomp = E.decomposeImpliedFdv(row, D.coefficients);
    const peers = D.live.filter((p) => (p.category || '') === (row.category || '')).slice(0, 4);
    const compItems = [{ name: `${row.name.slice(0, 15)} (Est.)`, val: decomp.reportedFdv, est: true }, ...peers.map((p) => ({ name: `${p.name.slice(0, 15)} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, est: false }))];
    const maxV = Math.max(...compItems.map((c) => c.val), 1);
    const svgH = compItems.length * 18 + 4;
    const compSvg = `<svg viewBox="0 0 460 ${svgH}" style="width:100%;height:auto">${compItems.map((c, i) => {
      const y = i * 18 + 2;
      const w = Math.max(4, Math.round((c.val / maxV) * 205));
      return `<text x="155" y="${y + 11}" text-anchor="end" fill="#cbd5e1" font-size="10">${esc(c.name)}</text>
        <rect x="163" y="${y + 2}" width="205" height="9" rx="2" fill="#172030"/>
        <rect x="163" y="${y + 2}" width="${w}" height="9" rx="2" fill="${c.est ? '#f0b90b' : '#a78bfa'}"/>
        <text x="376" y="${y + 11}" fill="#e6edf6" font-size="10" font-family="ui-monospace,monospace">${fmtUsd(c.val)}</text>`;
    }).join('')}</svg>`;

    const evStr = `${row.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(row.dyn_ev).toFixed(2)} (${row.dyn_roi.toFixed(1)}%)`;
    const costLabel = row.dyn_yield_offset ? 'Gas (Yield Offsets Carry)' : 'Gas + Carry Friction';
    const outflowTag = row.dyn_outflow_mult < 1 ? ` · Outflow Haircut ${(row.dyn_outflow_mult * 100).toFixed(0)}%` : '';
    const dBoxes = (arr) => arr.map(([l, v, c = '']) => `<div class="d-box"><div class="d-lbl">${l}</div><div class="d-val ${c}">${v}</div></div>`).join('');
    const valBoxes = dBoxes([
      ['Snapshot TVL', fmtUsd(row.tvl_usd)],
      ['Implied FDV', fmtUsd(decomp.reportedFdv), 'gold'],
      ['Peer Token Odds', `${row.token_odds_pct.toFixed(1)}%`, 'sky'],
      ['Cat EB Adj', `${row.category_adj_mult.toFixed(2)}x`],
      ['7d / Age Mult', `${row.growth_multiplier.toFixed(2)}x / ${row.maturity_multiplier.toFixed(2)}x`],
      ['Prob-Wtd FDV', fmtUsd(row.prob_weighted_fdv_usd), 'violet'],
    ]);
    const ecoBoxes = dBoxes([
      ['Gross Airdrop Est', `+$${row.dyn_gross.toFixed(2)}`],
      [costLabel, `-$${(row.est_gas_usd + row.dyn_carry).toFixed(2)}`],
      ['Net EV (ROI)', evStr, row.dyn_ev >= 0 ? 'pos' : 'neg'],
    ]);
    drawer.innerHTML = `<div class="drawer-head"><div><div class="drawer-title">${esc(row.name)} ${row.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>'}</div><div class="drawer-meta">Rank #${row.rank} · ${esc(row.category || 'Uncategorized')} · ${row.age_days !== null ? row.age_days + 'd old' : 'age n/a'} · ${esc(row.chains.join(', '))}</div></div><button class="btn-ghost" id="drawer-close" type="button">Close</button></div><div class="drawer-note">No token recorded in DefiLlama snapshot. Model: Base ${fmtUsd(decomp.baseSizeFdv)} (TVL^${decomp.elasticity.toFixed(2)}) × ${row.growth_multiplier.toFixed(2)} (7d) × ${row.maturity_multiplier.toFixed(2)} (age) × ${row.category_adj_mult.toFixed(2)} (cat EB) = ${fmtUsd(decomp.reportedFdv)}.</div><div class="section-lbl"><span>Valuation &amp; Odds Decomposition</span><span>P25–P75: ${fmtUsd(decomp.p25Fdv)}–${fmtUsd(decomp.p75Fdv)}</span></div><div class="decomp-grid">${valBoxes}</div><div class="section-lbl"><span>Vs Live Category Comparables</span><span>${peers.length} peers · active TVL ${fmtUsd(row.dyn_active_tvl)}</span></div><div>${compSvg}</div><div class="section-lbl"><span>Costed Farm Economics ($${row.dyn_cap} Budget${outflowTag})</span><span>${verdictBadge(row.dyn_verdict)}</span></div><div class="decomp-grid">${ecoBoxes}</div><div class="section-lbl"><span>Execution Steps (${esc(row.farm_chain)})</span><span>${row.tx_count} txs · ${row.hold_days}d hold</span></div><ol class="steps-list">${row.farm_steps.map((s, i) => `<li class="step-item"><span class="step-num">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}</ol>`;

    $('drawer-close').addEventListener('click', () => { state.selectedSlug = null; renderAll(); });
  }

  function renderAll() {
    const allRows = D.rows.map(computeEconomics);
    renderHeaderAndKpis(allRows);
    renderProofPanel();
    const chartsEl = $('charts-grid');
    if (chartsEl) chartsEl.classList.toggle('hidden', state.chartsHidden);
    const chartsBtn = $('charts-toggle');
    if (chartsBtn) {
      chartsBtn.classList.toggle('active', state.chartsHidden);
      chartsBtn.textContent = state.chartsHidden ? 'Show Charts' : 'Hide Charts';
    }
    const filtered = applyFilters(allRows);
    if (!state.chartsHidden) {
      renderCurveChart(allRows);
      renderTopChart(state.view === 'live' ? allRows : filtered);
    }
    renderTable(filtered);
    renderDetail(allRows);
  }

  function initSelects() {
    const cats = [...new Set([...D.rows.map((r) => r.category), ...D.live.map((p) => p.category)].filter(Boolean))].sort();
    $('f-cat').innerHTML = '<option value="">All Categories</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
    $('f-chain').innerHTML = '<option value="">All Chains</option>' + chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }

  const bindGroup = (sel, key, attr) => document.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(sel).forEach((x) => x.classList.remove('active')); b.classList.add('active'); state[key] = b.getAttribute(attr); renderAll();
  }));
  bindGroup('.tab-btn', 'view', 'data-view');
  bindGroup('.mini-btn', 'rightChart', 'data-chart');
  $('proof-toggle').addEventListener('click', () => { state.proofOpen = !state.proofOpen; renderAll(); });
  $('charts-toggle').addEventListener('click', () => { state.chartsHidden = !state.chartsHidden; renderAll(); });
  [['f-budget', 'change', (v) => (state.budget = Number(v) || 1000)], ['f-search', 'input', (v) => (state.search = v)], ['f-cat', 'change', (v) => (state.category = v)], ['f-chain', 'change', (v) => (state.chain = v)], ['f-verdict', 'change', (v) => (state.verdict = v)], ['f-tvl', 'change', (v) => (state.minTvl = Number(v) || 0)], ['f-sort', 'change', (v) => (state.sort = v)]].forEach(([id, ev, fn]) => $(id).addEventListener(ev, (e) => { fn(e.target.value); renderAll(); }));
  $('f-reset').addEventListener('click', () => {
    Object.assign(state, { search: '', category: '', chain: '', verdict: '', minTvl: 0, sort: 'rank' });
    ['f-search', 'f-cat', 'f-chain', 'f-verdict'].forEach((id) => ($(id).value = ''));
    $('f-tvl').value = '0'; $('f-sort').value = 'rank'; renderAll();
  });

  initSelects();
  renderAll();
})();
