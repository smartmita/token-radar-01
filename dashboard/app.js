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
    rightChart: 'val',
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

  function verdictBadge(v) {
    const cls = v === 'STRONG FARM' ? 'v-strong' : v === 'FARM' ? 'v-farm' : v === 'SELECTIVE' ? 'v-sel' : 'v-skip';
    return `<span class="v-pill ${cls}">${esc(v)}</span>`;
  }

  function applyFilters(allRows) {
    const q = state.search.trim().toLowerCase();
    if (state.view === 'live') {
      return D.live.filter((p) =>
        (!state.category || (p.category || '') === state.category) &&
        (!state.chain || p.chains.includes(state.chain)) &&
        (state.minTvl <= 0 || p.tvl_usd >= state.minTvl) &&
        (!q || `${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q)),
      );
    }
    const filtered = allRows.filter((r) =>
      (state.view !== 'watchlist' || r.cohort === 'watchlist') &&
      (state.view !== 'early' || r.cohort === 'early') &&
      (state.view !== 'farmable' || r.dyn_ev > 0) &&
      (!state.category || (r.category || '') === state.category) &&
      (!state.chain || r.chains.includes(state.chain)) &&
      (!state.verdict || r.dyn_verdict === state.verdict) &&
      (state.minTvl <= 0 || r.tvl_usd >= state.minTvl) &&
      (!q || `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)),
    );
    const sorters = {
      rank: (a, b) => a.rank - b.rank,
      ev: (a, b) => b.dyn_ev - a.dyn_ev || b.token_odds_pct - a.token_odds_pct,
      odds: (a, b) => b.token_odds_pct - a.token_odds_pct || b.implied_value_usd - a.implied_value_usd,
      pfdv: (a, b) => b.prob_weighted_fdv_usd - a.prob_weighted_fdv_usd,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999),
    };
    return filtered.sort(sorters[state.sort] || sorters.rank);
  }

  function renderHeaderAndKpis(allRows) {
    const c = D.coefficients;
    const v = D.validation;
    const part = E.partitionProtocols(D);

    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent =
      `Snapshot ${D.as_of} · ${D.total_protocols} protocols: ${part.preTokenCount} pre-token ranked ` +
      `(${part.watchlistCount} Watchlist + ${part.earlyCount} Early) · ${part.liveTotalCount} live separated`;
    $('live-sep-pill').textContent = `${part.liveTotalCount} LIVE TOKENS SEPARATED`;
    $('curve-note').textContent =
      `MCAP ~ TVL^${c.beta_log_tvl.toFixed(2)} · Huber IRLS across ${part.liveCompsCount} clean peers`;

    const farmable = allRows.filter((r) => r.dyn_ev > 0);
    const strong = allRows.filter((r) => r.dyn_verdict === 'STRONG FARM');
    const bestEv = [...allRows].sort((a, b) => b.dyn_ev - a.dyn_ev)[0];

    $('cnt-all').textContent = String(allRows.length);
    $('cnt-wl').textContent = String(part.watchlistCount);
    $('cnt-early').textContent = String(part.earlyCount);
    $('cnt-farm').textContent = String(farmable.length);
    $('cnt-live').textContent = String(part.liveCompsCount);

    const kpis = [
      ['Watchlist Coverage', `${part.watchlistCount} / ${part.watchlistCount}`, 'emerald', `100% floor + ${part.earlyCount} early (<$50M)`],
      ['Fitted Size Elasticity', `TVL^${c.beta_log_tvl.toFixed(2)}`, 'sky', `5-fold CV RMSE ${v.cv_5fold.model_log_rmse.toFixed(2)} vs ${v.cv_5fold.naive_log_rmse.toFixed(2)} naive`],
      ['Token-Odds AUC', `${v.token_odds_cv_auc.toFixed(3)}`, 'violet', `Brier ${v.token_odds_cv_brier.toFixed(3)} across ${v.token_odds_universe} peers`],
      [`Best Farm EV ($${state.budget})`, bestEv ? `+$${bestEv.dyn_ev.toFixed(2)}` : '—', 'gold', `${strong.length} Strong / ${farmable.length} +EV · Top: ${bestEv ? bestEv.name : 'n/a'}`],
    ];
    $('kpi-grid').innerHTML = kpis
      .map(([lbl, val, cls, foot]) =>
        `<div class="kpi-card"><div class="kpi-label">${lbl}</div><div class="kpi-val ${cls}">${val}</div><div class="kpi-foot">${esc(foot)}</div></div>`)
      .join('');
  }

  function renderMethodologyPanel() {
    const panel = $('proof-panel');
    panel.classList.toggle('hidden', !state.proofOpen);
    $('proof-toggle').classList.toggle('active', state.proofOpen);
    if (!state.proofOpen) return;
    const v = D.validation;
    const w = v.token_odds_weights;
    const rowHtml = (m) =>
      `<tr><td>${esc(m.name)} (n=${m.sample_count})</td><td class="pos">${m.model_log_rmse.toFixed(3)}</td>` +
      `<td class="dim">${m.naive_log_rmse.toFixed(3)}</td><td>${m.model_spearman.toFixed(3)}</td></tr>`;
    const chips = [
      ['log(TVL)', w.log_tvl], ['log(Age+30)', w.log_age], ['log(Chains)', w.log_chains],
      ['7d Flow', w.growth_asinh], ['Cat Prior', w.category_prior], ['No-Age Flag', w.missing_age],
    ];
    panel.innerHTML =
      `<div><div class="proof-title">Out-of-Sample Valuation Benchmark (Clean Live Peers)</div>` +
      `<table class="proof-table"><thead><tr><th>Split</th><th>Model Log-RMSE</th><th>Naive RMSE</th><th>Spearman</th></tr></thead>` +
      `<tbody>${rowHtml(v.cv_5fold)}${rowHtml(v.temporal_holdout)}</tbody></table></div>` +
      `<div><div class="proof-title">Peer Token-Odds Logistic Fit (AUC ${v.token_odds_cv_auc.toFixed(3)})</div>` +
      `<div class="weights-grid">${chips.map(([l, x]) => `<div class="w-chip"><span>${l}</span><span>${x >= 0 ? '+' : ''}${x.toFixed(3)}</span></div>`).join('')}</div></div>`;
  }

  function renderCurveChart(allRows) {
    const svgW = 580, svgH = 148, padL = 52, padR = 14, padT = 10, padB = 20;
    const plotW = svgW - padL - padR, plotH = svgH - padT - padB;
    const xMin = Math.log10(4e6), xMax = Math.log10(1.2e10);
    const yMin = Math.log10(4e5), yMax = Math.log10(1e10);
    const mapX = (tvl) => padL + ((Math.log10(Math.max(4e6, tvl)) - xMin) / (xMax - xMin)) * plotW;
    const mapY = (val) => padT + plotH - ((Math.log10(Math.max(4e5, val)) - yMin) / (yMax - yMin)) * plotH;

    const gridX = [1e7, 1e8, 1e9, 1e10].map((v) => {
      const x = mapX(v);
      return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#1c2535"/>` +
        `<text x="${x}" y="${svgH - 6}" text-anchor="middle" fill="#64748b" font-size="9" font-family="ui-monospace,monospace">${fmtUsd(v)}</text>`;
    }).join('');
    const gridY = [1e6, 1e7, 1e8, 1e9].map((v) => {
      const y = mapY(v);
      return `<line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="#1c2535"/>` +
        `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" fill="#64748b" font-size="9" font-family="ui-monospace,monospace">${fmtUsd(v)}</text>`;
    }).join('');

    const c = D.coefficients;
    const linePts = [4e6, 2e7, 1e8, 5e8, 2.5e9, 1e10]
      .map((tvl) => `${mapX(tvl).toFixed(1)},${mapY(Math.exp(c.intercept + c.beta_log_tvl * (Math.log(tvl) - c.mean_log_tvl))).toFixed(1)}`)
      .join(' ');
    const liveDots = D.live.map((p) =>
      `<circle cx="${mapX(p.tvl_usd).toFixed(1)}" cy="${mapY(p.mcap_usd).toFixed(1)}" r="2.3" fill="#a78bfa" fill-opacity="0.42"/>`).join('');
    const preDots = allRows.map((r) => {
      const sel = r.slug === state.selectedSlug;
      const col = r.cohort === 'watchlist' ? '#f59e0b' : '#38bdf8';
      return `<circle class="pt" data-slug="${esc(r.slug)}" cx="${mapX(r.tvl_usd).toFixed(1)}" cy="${mapY(r.implied_value_usd).toFixed(1)}" r="${sel ? 4.8 : 2.6}" fill="${col}" fill-opacity="${sel ? 1 : 0.8}" stroke="${sel ? '#fff' : 'none'}" style="cursor:pointer"/>`;
    }).join('');
    const legend = [
      ['#a78bfa', 6, '● Live peers'],
      ['#f59e0b', 82, '● Watchlist'],
      ['#38bdf8', 156, '● Early'],
      ['#10b981', 210, `— TVL^${c.beta_log_tvl.toFixed(2)}`],
    ].map(([col, x, txt]) =>
      `<text x="${padL + x}" y="${padT + 9}" fill="${col}" font-size="9" font-family="ui-monospace,monospace">${txt}</text>`).join('');

    $('chart-curve').innerHTML = `<svg viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="TVL vs Implied Market Cap">${gridX}${gridY}${liveDots}<polyline fill="none" stroke="#10b981" stroke-width="2" points="${linePts}"/>${preDots}${legend}</svg>`;
    $('chart-curve').querySelectorAll('.pt').forEach((el) =>
      el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTopChart(filtered) {
    const isEv = state.rightChart === 'ev';
    $('right-chart-title').textContent = isEv ? `Top Net Farm EV ($${state.budget} Budget)` : 'Top Implied Market Caps [P25–P75]';
    const items = [...filtered]
      .sort((a, b) => (isEv ? b.dyn_ev - a.dyn_ev : b.implied_value_usd - a.implied_value_usd))
      .slice(0, 7);
    if (!items.length) {
      $('chart-top').innerHTML = '<div class="panel-note" style="padding:18px 0">No matching pre-token rows.</div>';
      return;
    }

    const svgW = 580, rowH = 20, h = items.length * rowH + 8, labelW = 148, barMaxW = 290;
    const minLog = Math.log10(1e6);
    const maxLog = Math.log10(Math.max(...items.map((r) => r.implied_high_usd), 2e8));
    const maxEv = Math.max(...items.map((r) => r.dyn_ev), 1);

    const scaleBar = (v) => isEv
      ? Math.max(4, Math.round((Math.max(0, v) / maxEv) * barMaxW))
      : Math.max(8, Math.round(((Math.log10(Math.max(1e6, v)) - minLog) / Math.max(0.5, maxLog - minLog)) * barMaxW));

    const bars = items.map((r, i) => {
      const y = i * rowH + 4;
      const val = isEv ? r.dyn_ev : r.implied_value_usd;
      const w = scaleBar(val);
      const col = isEv ? '#10b981' : (r.cohort === 'watchlist' ? '#f59e0b' : '#38bdf8');
      const sel = r.slug === state.selectedSlug;
      let range = '';
      if (!isEv) {
        const x1 = labelW + scaleBar(r.implied_low_usd);
        const x2 = labelW + scaleBar(r.implied_high_usd);
        range = `<line x1="${x1}" y1="${y + 9}" x2="${x2}" y2="${y + 9}" stroke="#94a3b8" stroke-width="1.3"/>` +
          `<circle cx="${x1}" cy="${y + 9}" r="1.8" fill="#94a3b8"/><circle cx="${x2}" cy="${y + 9}" r="1.8" fill="#94a3b8"/>`;
      }
      const lbl = isEv ? `+$${r.dyn_ev.toFixed(2)} (${r.farm_chain})` : `${fmtUsd(r.implied_value_usd)} · ${r.token_odds_pct.toFixed(0)}% odds`;
      return `<g class="chart-row" data-slug="${esc(r.slug)}" style="cursor:pointer">` +
        `<rect x="0" y="${y}" width="${svgW}" height="${rowH - 2}" rx="4" fill="${sel ? 'rgba(245,158,11,0.12)' : 'transparent'}"/>` +
        `<text x="${labelW - 8}" y="${y + 13}" text-anchor="end" fill="#cbd5e1" font-size="10.5">${esc(r.name.slice(0, 20))}</text>` +
        `<rect x="${labelW}" y="${y + 4}" width="${barMaxW}" height="10" rx="2" fill="#172030"/>` +
        `<rect x="${labelW}" y="${y + 4}" width="${w}" height="10" rx="2" fill="${col}" fill-opacity="0.85"/>` +
        `${range}<text x="${labelW + barMaxW + 8}" y="${y + 13}" fill="#e2e8f0" font-size="10" font-family="ui-monospace,monospace">${esc(lbl)}</text></g>`;
    }).join('');

    $('chart-top').innerHTML = `<svg viewBox="0 0 ${svgW} ${h}" role="img" aria-label="Top ranked pre-token protocols">${bars}</svg>`;
    $('chart-top').querySelectorAll('.chart-row').forEach((el) =>
      el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTable(filtered) {
    const head = $('table-head');
    const body = $('table-body');
    if (state.view === 'live') {
      $('filter-summary').textContent = `${filtered.length} of ${D.live.length} clean live peers`;
      head.innerHTML = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Live MCAP</th><th class="num">MCAP/TVL</th><th class="num">7d &Delta;</th><th class="num">Age</th></tr>';
      body.innerHTML = filtered.map((p) =>
        `<tr><td><div class="proto-name">${esc(p.name)} <span class="badge b-live">${esc(p.symbol || 'LIVE')}</span></div>` +
        `<div class="subline">${esc(p.chains.slice(0, 4).join(', '))}</div></td><td>${esc(p.category || 'Other')}</td>` +
        `<td class="num mono">${fmtUsd(p.tvl_usd)}</td><td class="num mono violet">${fmtUsd(p.mcap_usd)}</td>` +
        `<td class="num mono">${p.mcap_tvl_ratio.toFixed(2)}x</td><td class="num mono">${fmtPct(p.change_7d)}</td>` +
        `<td class="num mono dim">${p.age_days !== null ? p.age_days + 'd' : 'n/a'}</td></tr>`).join('');
      return;
    }

    $('filter-summary').textContent = `${filtered.length} of ${D.rows.length} pre-token shown`;
    const arrow = (k) => (state.sort === k ? ' ▼' : '');
    const cls = (k, ex = '') => `sortable${state.sort === k ? ' sorted' : ''}${ex ? ' ' + ex : ''}`;
    head.innerHTML =
      `<tr><th class="${cls('rank')}" data-sort="rank">Rank${arrow('rank')}</th><th>Protocol</th><th>Category</th>` +
      `<th class="${cls('tvl', 'num')}" data-sort="tvl">TVL / 7d${arrow('tvl')}</th>` +
      `<th class="${cls('odds', 'num')}" data-sort="odds">Token Odds${arrow('odds')}</th>` +
      `<th class="${cls('rank', 'num')}" data-sort="rank">Implied MCAP${arrow('rank')}</th>` +
      `<th class="${cls('ev', 'num')}" data-sort="ev">Farm Verdict &amp; EV${arrow('ev')}</th></tr>`;
    head.querySelectorAll('th[data-sort]').forEach((th) =>
      th.addEventListener('click', () => { state.sort = th.getAttribute('data-sort'); $('f-sort').value = state.sort; renderAll(); }));

    body.innerHTML = filtered.map((r) => {
      const sel = r.slug === state.selectedSlug ? 'selected' : '';
      const badge = r.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
      const chains = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : '');
      const evCls = r.dyn_ev >= 0 ? 'pos' : 'neg';
      const evStr = `${r.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev).toFixed(2)}`;
      return `<tr class="${sel}" data-slug="${esc(r.slug)}">` +
        `<td class="mono sky">#${r.rank}</td>` +
        `<td><div class="proto-name">${esc(r.name)} ${badge}</div><div class="subline">${esc(chains)}</div></td>` +
        `<td><div>${esc(r.category || 'Other')}</div><div class="subline mono">${r.age_days !== null ? r.age_days + 'd old' : 'age n/a'} · ${r.applied_multiple.toFixed(2)}x</div></td>` +
        `<td class="num mono"><div>${fmtUsd(r.tvl_usd)}</div><div class="subline">${fmtPct(r.change_7d)}</div></td>` +
        `<td class="num mono"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.min(100, r.token_odds_pct)}%"></div></div>` +
        `<span>${r.token_odds_pct.toFixed(0)}%</span></div><div class="subline">E: ${fmtUsd(r.prob_weighted_fdv_usd)}</div></td>` +
        `<td class="num mono"><div class="gold">${fmtUsd(r.implied_value_usd)}</div><div class="subline">${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)}</div></td>` +
        `<td class="num"><div>${verdictBadge(r.dyn_verdict)} <span class="mono ${evCls}">${evStr}</span></div>` +
        `<div class="subline mono">${esc(r.farm_chain)} · $${r.est_gas_usd.toFixed(2)} gas · ${r.hold_days}d</div></td></tr>`;
    }).join('');

    body.querySelectorAll('tr[data-slug]').forEach((tr) =>
      tr.addEventListener('click', () => {
        const s = tr.getAttribute('data-slug');
        state.selectedSlug = state.selectedSlug === s ? null : s;
        renderAll();
      }));
  }

  function renderDetailDrawer(allRows) {
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

    const decomp = E.decomposeImpliedValue(row, D.coefficients);
    const peers = D.live.filter((p) => (p.category || '') === (row.category || '')).slice(0, 4);
    const compItems = [
      { name: `${row.name.slice(0, 16)} (Est.)`, val: decomp.reportedVal, est: true },
      ...peers.map((p) => ({ name: `${p.name.slice(0, 16)} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, est: false })),
    ];
    const maxV = Math.max(...compItems.map((c) => c.val), 1);
    const svgH = compItems.length * 17 + 4;
    const compSvg = `<svg viewBox="0 0 460 ${svgH}" style="width:100%;height:auto">${compItems.map((c, i) => {
      const y = i * 17 + 2;
      const w = Math.max(4, Math.round((c.val / maxV) * 205));
      return `<text x="155" y="${y + 11}" text-anchor="end" fill="#cbd5e1" font-size="9.5">${esc(c.name)}</text>` +
        `<rect x="163" y="${y + 2}" width="205" height="8.5" rx="2" fill="#172030"/>` +
        `<rect x="163" y="${y + 2}" width="${w}" height="8.5" rx="2" fill="${c.est ? '#f59e0b' : '#a78bfa'}"/>` +
        `<text x="376" y="${y + 11}" fill="#e2e8f0" font-size="9.5" font-family="ui-monospace,monospace">${fmtUsd(c.val)}</text>`;
    }).join('')}</svg>`;

    const plan = E.buildFarmPlan(
      { name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d },
      row.age_days, row.implied_value_usd, row.token_odds_pct / 100, state.budget,
    );
    const evStr = `${row.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(row.dyn_ev).toFixed(2)} (${row.dyn_roi.toFixed(1)}%)`;
    const dBox = (l, v, c = '') => `<div class="d-box"><div class="d-lbl">${l}</div><div class="d-val ${c}">${v}</div></div>`;

    const stepsHtml = plan.steps.map((raw, i) => {
      const m = raw.match(/^(.*?)\s*Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.?$/);
      const text = m ? m[1] : raw;
      const cost = m ? m[2] : '';
      const time = m ? m[3] : '';
      return `<li class="step-item"><span class="step-num">${i + 1}</span><div class="step-body"><div>${esc(text)}</div>` +
        `<div class="step-tags"><span class="step-cost">Cost: ${esc(cost)}</span><span class="step-time">Time: ${esc(time)}</span></div></div></li>`;
    }).join('');

    drawer.innerHTML =
      `<div class="detail-head"><div><div class="detail-title">${esc(row.name)} ` +
      `<span class="badge ${row.cohort === 'watchlist' ? 'b-wl' : 'b-early'}">${row.cohort === 'watchlist' ? 'WATCHLIST' : 'EARLY'}</span></div>` +
      `<div class="detail-meta">Rank #${row.rank} · ${esc(row.category || 'Other')} · ${row.age_days !== null ? row.age_days + 'd old' : 'age n/a'} · ${esc(row.chains.join(', '))}</div></div>` +
      `<button class="btn-ghost" id="d-close" type="button">Close</button></div>` +
      `<div class="detail-formula">Model: Base ${fmtUsd(decomp.baseSizeVal)} (TVL^${decomp.elasticity.toFixed(2)}) × ` +
      `${row.growth_multiplier.toFixed(2)} (7d) × ${row.maturity_multiplier.toFixed(2)} (age) × ${row.category_adj_mult.toFixed(2)} (cat EB) = ${fmtUsd(decomp.reportedVal)}</div>` +
      `<div class="sec-title"><span>Valuation &amp; Odds Breakdown</span><span class="mono">P25–P75: ${fmtUsd(decomp.p25Val)}–${fmtUsd(decomp.p75Val)}</span></div>` +
      `<div class="detail-grid">${dBox('Snapshot TVL', fmtUsd(row.tvl_usd))}${dBox('Implied MCAP', fmtUsd(decomp.reportedVal), 'gold')}${dBox('Token Odds', row.token_odds_pct.toFixed(1) + '%', 'violet')}` +
      `${dBox('Prob-Wtd MCAP', fmtUsd(row.prob_weighted_fdv_usd), 'sky')}${dBox('7d TVL Flow', fmtPct(row.change_7d))}${dBox('Category Peers', `${row.category_samples} (${row.category_adj_mult.toFixed(2)}x)`)}</div>` +
      `<div class="sec-title"><span>Live Category Comparables</span><span class="mono">${peers.length} peers</span></div>${compSvg}` +
      `<div class="sec-title"><span>Costed Farm Economics ($${state.budget} Budget)</span><span>${verdictBadge(row.dyn_verdict)}</span></div>` +
      `<div class="detail-grid">${dBox('Gross Est.', '+$' + row.dyn_gross.toFixed(2), 'pos')}${dBox('Gas + Carry', '-$' + (row.est_gas_usd + row.dyn_carry).toFixed(2), 'neg')}${dBox('Net EV (ROI)', evStr, row.dyn_ev >= 0 ? 'pos' : 'neg')}</div>` +
      `<div class="sec-title"><span>Execution Plan (${esc(row.farm_chain)})</span><span class="mono">${row.tx_count} txs · ${row.hold_days}d hold</span></div>` +
      `<ol class="steps-list">${stepsHtml}</ol>`;

    $('d-close').addEventListener('click', () => { state.selectedSlug = null; renderAll(); });
  }

  function renderAll() {
    const allRows = D.rows.map((r) => E.computeFarmEconomics(r, state.budget));
    const filtered = applyFilters(allRows);
    $('charts-grid').classList.toggle('hidden', state.chartsHidden);
    $('charts-toggle').textContent = state.chartsHidden ? 'Show Charts' : 'Hide Charts';
    renderHeaderAndKpis(allRows);
    renderMethodologyPanel();
    if (!state.chartsHidden) {
      renderCurveChart(allRows);
      renderTopChart(state.view === 'live' ? allRows : filtered);
    }
    renderTable(filtered);
    renderDetailDrawer(allRows);
  }

  function populateDropdowns() {
    const cats = [...new Set([...D.rows, ...D.live].map((r) => r.category).filter(Boolean))].sort();
    $('f-cat').innerHTML += cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const chains = [...new Set([...D.rows, ...D.live].flatMap((r) => r.chains))].sort();
    $('f-chain').innerHTML += chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }

  function bindEvents() {
    document.querySelectorAll('.tab-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.view = btn.getAttribute('data-view');
        if (state.view === 'live') state.selectedSlug = null;
        renderAll();
      }));

    document.querySelectorAll('.mini-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mini-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.rightChart = btn.getAttribute('data-chart');
        renderAll();
      }));

    $('proof-toggle').addEventListener('click', () => { state.proofOpen = !state.proofOpen; renderAll(); });
    $('charts-toggle').addEventListener('click', () => { state.chartsHidden = !state.chartsHidden; renderAll(); });
    $('f-search').addEventListener('input', (e) => { state.search = e.target.value; renderAll(); });
    $('f-cat').addEventListener('change', (e) => { state.category = e.target.value; renderAll(); });
    $('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderAll(); });
    $('f-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderAll(); });
    $('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value) || 0; renderAll(); });
    $('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderAll(); });
    $('f-budget').addEventListener('change', (e) => { state.budget = Number(e.target.value) || 1000; renderAll(); });
    $('f-reset').addEventListener('click', () => {
      Object.assign(state, { view: 'all', search: '', category: '', chain: '', verdict: '', minTvl: 0, sort: 'rank', selectedSlug: null });
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === 'all'));
      $('f-search').value = ''; $('f-cat').value = ''; $('f-chain').value = '';
      $('f-verdict').value = ''; $('f-tvl').value = '0'; $('f-sort').value = 'rank';
      renderAll();
    });
  }

  function applyHashParams() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const p = new URLSearchParams(raw);
    if (p.get('view')) {
      state.view = p.get('view');
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === state.view));
    }
    if (p.get('tvl')) { state.minTvl = Number(p.get('tvl')) || 0; $('f-tvl').value = String(state.minTvl); }
    if (p.get('sort')) { state.sort = p.get('sort'); $('f-sort').value = state.sort; }
    if (p.get('selected')) state.selectedSlug = p.get('selected');
    if (p.get('charts') === '0') state.chartsHidden = true;
    if (p.get('proof') === '1') state.proofOpen = true;
  }

  populateDropdowns();
  bindEvents();
  applyHashParams();
  renderAll();
})();
