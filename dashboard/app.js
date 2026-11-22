(() => {
  'use strict';

  const D = window.RADAR, E = window.RadarEngine;
  if (!D || !Array.isArray(D.rows) || !E) {
    document.body.innerHTML = '<p style="padding:24px;color:#B42318">Missing window.RADAR dataset or RadarEngine</p>';
    return;
  }

  const qp = new URLSearchParams(window.location.search);
  const state = {
    view: qp.get('view') || 'all', search: qp.get('q') || '', category: qp.get('cat') || '',
    chain: qp.get('chain') || '', verdict: qp.get('verdict') || '', minTvl: Number(qp.get('minTvl') || 0),
    sort: qp.get('sort') || 'rank', budget: Number(qp.get('budget') || 1000), rightChart: qp.get('chart') || 'val',
    proofOpen: qp.get('proof') === '1', chartsHidden: qp.get('charts') === '0', selectedSlug: qp.get('detail') || null,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtUsd = (n) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const s = n < 0 ? '-' : '', a = Math.abs(n);
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
    return s + '$' + a.toFixed(a < 100 ? 2 : 0);
  };
  const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? '<span class="dim">n/a</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  const vBadge = (v) => `<span class="v-pill ${v === 'STRONG FARM' ? 'v-strong' : v === 'FARM' ? 'v-farm' : v === 'SELECTIVE' ? 'v-sel' : 'v-skip'}">${esc(v)}</span>`;

  function applyFilters(allRows) {
    const q = state.search.trim().toLowerCase();
    if (state.view === 'live') {
      return D.live.filter((p) => (!state.category || (p.category || '') === state.category) && (!state.chain || p.chains.includes(state.chain)) && (state.minTvl <= 0 || p.tvl_usd >= state.minTvl) && (!q || `${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q)));
    }
    const filtered = allRows.filter((r) =>
      (state.view !== 'watchlist' || r.cohort === 'watchlist') && (state.view !== 'early' || r.cohort === 'early') &&
      (state.view !== 'farmable' || r.dyn_ev > 0) && (!state.category || (r.category || '') === state.category) &&
      (!state.chain || r.chains.includes(state.chain)) && (!state.verdict || r.dyn_verdict === state.verdict) &&
      (state.minTvl <= 0 || r.tvl_usd >= state.minTvl) && (!q || `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)));
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
    const c = D.coefficients, v = D.validation, part = E.partitionProtocols(D);
    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent = `Snapshot ${D.as_of} · ${D.total_protocols} protocols: ${part.preTokenCount} pre-token (${part.watchlistCount} Watchlist + ${part.earlyCount} Early) · ${part.liveTotalCount} live-token (${part.liveCompsCount} MCap peers) · ${part.excludedCount} wrappers/bridges`;
    $('live-sep-pill').textContent = `${part.liveTotalCount} LIVE TOKENS (${part.liveCompsCount} PEERS)`;
    $('curve-note').textContent = `MCAP ~ TVL^${c.beta_log_tvl.toFixed(2)} · Huber IRLS across ${part.liveCompsCount} clean peers`;

    const farmable = allRows.filter((r) => r.dyn_ev > 0), strong = allRows.filter((r) => r.dyn_verdict === 'STRONG FARM');
    const bestEv = [...allRows].sort((a, b) => b.dyn_ev - a.dyn_ev)[0];
    $('cnt-all').textContent = String(allRows.length);
    $('cnt-wl').textContent = String(part.watchlistCount);
    $('cnt-early').textContent = String(part.earlyCount);
    $('cnt-farm').textContent = String(farmable.length);
    $('cnt-live').textContent = String(part.liveCompsCount);

    const kpis = [
      ['Watchlist Floor Coverage', `${part.watchlistCount} / ${part.watchlistCount}`, 'c-pine', 'pine', `100% floor + ${part.earlyCount} early (<$50M TVL)`],
      ['Size Elasticity', `TVL^${c.beta_log_tvl.toFixed(2)}`, 'c-steel', 'steel', `5-fold CV RMSE ${v.cv_5fold.model_log_rmse.toFixed(3)} vs ${v.cv_5fold.naive_log_rmse.toFixed(3)} naive`],
      ['Peer Token Rate (AUC)', `${v.token_odds_cv_auc.toFixed(3)}`, 'c-plum', 'plum', `Brier ${v.token_odds_cv_brier.toFixed(3)} across ${v.token_odds_universe} clean peers`],
      [`Top Farm Net EV ($${state.budget})`, bestEv ? `+$${bestEv.dyn_ev.toFixed(2)}` : '—', 'c-ochre', 'ochre', `${strong.length} Strong / ${farmable.length} +EV · ${bestEv ? `${bestEv.name} (#${bestEv.rank})` : 'n/a'}`],
    ];
    $('kpi-grid').innerHTML = kpis.map(([l, val, bc, vc, ft]) => `<div class="kpi-card ${bc}"><div class="kpi-label">${l}</div><div class="kpi-val ${vc}">${val}</div><div class="kpi-foot">${esc(ft)}</div></div>`).join('');
  }

  function renderMethodologyPanel() {
    const panel = $('proof-panel');
    panel.classList.toggle('hidden', !state.proofOpen);
    $('proof-toggle').classList.toggle('active', state.proofOpen);
    if (!state.proofOpen) return;
    const v = D.validation, w = v.token_odds_weights, c = D.coefficients;
    const rowHtml = (m) => `<tr><td>${esc(m.name)} (n=${m.sample_count})</td><td class="pos mono">${m.model_log_rmse.toFixed(3)}</td><td class="dim mono">${m.naive_log_rmse.toFixed(3)}</td><td class="mono">${m.model_spearman.toFixed(3)}</td></tr>`;
    const chips = [['log(TVL) β', c.beta_log_tvl], ['7d Flow β', c.beta_growth_asinh], ['log(Age+30) β', c.beta_log_age], ['Odds log(TVL)', w.log_tvl], ['Odds log(Age)', w.log_age], ['Odds Cat Prior', w.category_prior]];
    panel.innerHTML = `<div><div class="proof-title">Out-of-Sample Valuation Benchmark (Full Model in CV)</div><table class="proof-table"><thead><tr><th>Split</th><th>Model Log-RMSE</th><th>Naive RMSE</th><th>Spearman</th></tr></thead><tbody>${rowHtml(v.cv_5fold)}${rowHtml(v.temporal_holdout)}</tbody></table></div><div><div class="proof-title">Learned Huber &amp; Logistic Prevalence Weights (AUC ${v.token_odds_cv_auc.toFixed(3)})</div><div class="weights-grid">${chips.map(([l, x]) => `<div class="w-chip"><span>${l}</span><span>${x >= 0 ? '+' : ''}${x.toFixed(3)}</span></div>`).join('')}</div></div>`;
  }

  function renderCurveChart(allRows) {
    const W = 580, H = 152, pL = 52, pR = 14, pT = 12, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    const x0 = Math.log10(4e6), x1 = Math.log10(1.2e10), y0 = Math.log10(4e5), y1 = Math.log10(1e10);
    const mx = (v) => pL + ((Math.log10(Math.max(4e6, v)) - x0) / (x1 - x0)) * pw;
    const my = (v) => pT + ph - ((Math.log10(Math.max(4e5, v)) - y0) / (y1 - y0)) * ph;
    const fnt = 'font-size="9" font-family="ui-monospace,monospace"';
    const gx = [1e7, 1e8, 1e9, 1e10].map((v) => `<line x1="${mx(v)}" y1="${pT}" x2="${mx(v)}" y2="${pT + ph}" stroke="#EAE4DA"/><text x="${mx(v)}" y="${H - 6}" text-anchor="middle" fill="#6C7584" ${fnt}>${fmtUsd(v)}</text>`).join('');
    const gy = [1e6, 1e7, 1e8, 1e9].map((v) => `<line x1="${pL}" y1="${my(v)}" x2="${W - pR}" y2="${my(v)}" stroke="#EAE4DA"/><text x="${pL - 6}" y="${my(v) + 3}" text-anchor="end" fill="#6C7584" ${fnt}>${fmtUsd(v)}</text>`).join('');
    const c = D.coefficients;
    const linePts = [4e6, 2e7, 1e8, 5e8, 2.5e9, 1e10].map((tvl) => `${mx(tvl).toFixed(1)},${my(Math.exp(c.intercept + c.beta_log_tvl * (Math.log(tvl) - c.mean_log_tvl))).toFixed(1)}`).join(' ');
    const liveDots = D.live.map((p) => `<circle cx="${mx(p.tvl_usd).toFixed(1)}" cy="${my(p.mcap_usd).toFixed(1)}" r="2.4" fill="#5B3E8C" fill-opacity=".34"/>`).join('');
    const preDots = allRows.map((r) => {
      const sel = r.slug === state.selectedSlug, col = r.cohort === 'watchlist' ? '#9A4D12' : '#1E4E79';
      return `<circle class="pt" data-slug="${esc(r.slug)}" cx="${mx(r.tvl_usd).toFixed(1)}" cy="${my(r.implied_value_usd).toFixed(1)}" r="${sel ? 5 : 2.7}" fill="${col}" fill-opacity="${sel ? 1 : .85}" stroke="${sel ? '#151920' : 'none'}" stroke-width="1.4" style="cursor:pointer"/>`;
    }).join('');
    const leg = [['#5B3E8C', 6, '● Live peers (88)'], ['#9A4D12', 108, '● Watchlist (40)'], ['#1E4E79', 208, '● Early (136)'], ['#0E5A46', 292, `— TVL^${c.beta_log_tvl.toFixed(2)} fit`]].map(([col, x, t]) => `<text x="${pL + x}" y="${pT + 9}" fill="${col}" font-size="9.5" font-weight="600" font-family="ui-monospace,monospace">${t}</text>`).join('');
    $('chart-curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="TVL vs Implied Market Cap"><rect x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="#FAF8F4" rx="4"/>${gx}${gy}${liveDots}<polyline fill="none" stroke="#0E5A46" stroke-width="2" points="${linePts}"/>${preDots}${leg}</svg>`;
    $('chart-curve').querySelectorAll('.pt').forEach((el) => el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTopChart(filtered) {
    const isEv = state.rightChart === 'ev';
    $('right-chart-title').textContent = isEv ? `Top Net Farm EV ($${state.budget} Budget)` : 'Top Implied Valuations [P25–P75]';
    const items = [...filtered].sort((a, b) => (isEv ? b.dyn_ev - a.dyn_ev : b.implied_value_usd - a.implied_value_usd)).slice(0, 7);
    if (!items.length) { $('chart-top').innerHTML = '<div class="panel-note" style="padding:18px 0">No matching pre-token rows.</div>'; return; }
    const W = 580, rH = 21, h = items.length * rH + 6, lW = 148, bW = 285, minL = Math.log10(1e6), maxL = Math.log10(Math.max(...items.map((r) => r.implied_high_usd), 2e8)), maxEv = Math.max(...items.map((r) => r.dyn_ev), 1);
    const barW = (v) => isEv ? Math.max(4, Math.round((Math.max(0, v) / maxEv) * bW)) : Math.max(8, Math.round(((Math.log10(Math.max(1e6, v)) - minL) / Math.max(0.5, maxL - minL)) * bW));
    const bars = items.map((r, i) => {
      const y = i * rH + 3, w = barW(isEv ? r.dyn_ev : r.implied_value_usd), col = isEv ? '#0E5A46' : (r.cohort === 'watchlist' ? '#9A4D12' : '#1E4E79'), sel = r.slug === state.selectedSlug;
      const rng = isEv ? '' : `<line x1="${lW + barW(r.implied_low_usd)}" y1="${y + 9}" x2="${lW + barW(r.implied_high_usd)}" y2="${y + 9}" stroke="#6C7584" stroke-width="1.3"/><circle cx="${lW + barW(r.implied_low_usd)}" cy="${y + 9}" r="1.8" fill="#6C7584"/><circle cx="${lW + barW(r.implied_high_usd)}" cy="${y + 9}" r="1.8" fill="#6C7584"/>`;
      const lbl = isEv ? `+$${r.dyn_ev.toFixed(2)} (${r.farm_chain})` : `${fmtUsd(r.implied_value_usd)} · ${r.token_odds_pct.toFixed(0)}% rate`;
      return `<g class="chart-row" data-slug="${esc(r.slug)}" style="cursor:pointer"><rect x="0" y="${y}" width="${W}" height="${rH - 2}" rx="4" fill="${sel ? '#FBF1E6' : 'transparent'}"/><text x="${lW - 8}" y="${y + 13}" text-anchor="end" fill="#151920" font-size="10.5" font-weight="600">${esc(r.name.slice(0, 20))}</text><rect x="${lW}" y="${y + 4}" width="${bW}" height="10" rx="2" fill="#EFECE4"/><rect x="${lW}" y="${y + 4}" width="${w}" height="10" rx="2" fill="${col}" fill-opacity="0.88"/>${rng}<text x="${lW + bW + 8}" y="${y + 13}" fill="#151920" font-size="10" font-family="ui-monospace,monospace">${esc(lbl)}</text></g>`;
    }).join('');
    $('chart-top').innerHTML = `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Top ranked pre-token protocols">${bars}</svg>`;
    $('chart-top').querySelectorAll('.chart-row').forEach((el) => el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTable(filtered) {
    const head = $('table-head'), body = $('table-body');
    if (state.view === 'live') {
      $('filter-summary').textContent = `${filtered.length} of ${D.live.length} clean live peers`;
      head.innerHTML = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Live MCAP</th><th class="num">MCAP/TVL</th><th class="num">7d &Delta;</th><th class="num">Age</th></tr>';
      body.innerHTML = filtered.map((p) => `<tr><td><div class="proto-name">${esc(p.name)} <span class="badge b-live">${esc(p.symbol || 'LIVE')}</span></div><div class="subline">${esc(p.chains.slice(0, 4).join(', '))}</div></td><td>${esc(p.category || 'Other')}</td><td class="num mono">${fmtUsd(p.tvl_usd)}</td><td class="num mono plum">${fmtUsd(p.mcap_usd)}</td><td class="num mono">${p.mcap_tvl_ratio.toFixed(2)}x</td><td class="num mono">${fmtPct(p.change_7d)}</td><td class="num mono dim">${p.age_days !== null ? p.age_days + 'd' : 'n/a'}</td></tr>`).join('');
      return;
    }
    const compact = Boolean(state.selectedSlug);
    $('filter-summary').textContent = `${filtered.length} of ${D.rows.length} pre-token shown`;
    const arr = (k) => (state.sort === k ? ' ▼' : ''), cls = (k, ex = '') => `sortable${state.sort === k ? ' sorted' : ''}${ex ? ' ' + ex : ''}`;
    head.innerHTML = `<tr><th class="${cls('rank')}" data-sort="rank">Rank${arr('rank')}</th><th>Protocol</th>${compact ? '' : '<th>Category</th>'}<th class="${cls('tvl', 'num')}" data-sort="tvl">TVL / 7d${arr('tvl')}</th><th class="${cls('odds', 'num')}" data-sort="odds">Peer Rate${arr('odds')}</th><th class="${cls('rank', 'num')}" data-sort="rank">Implied MCAP${arr('rank')}</th>${compact ? '' : `<th class="${cls('ev', 'num')}" data-sort="ev">Farm Plan EV${arr('ev')}</th>`}</tr>`;
    head.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { state.sort = th.getAttribute('data-sort'); $('f-sort').value = state.sort; renderAll(); }));

    body.innerHTML = filtered.map((r) => {
      const sel = r.slug === state.selectedSlug ? 'selected' : '', badge = r.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
      const chains = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''), evStr = `${r.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev).toFixed(2)}`;
      return `<tr class="${sel}" data-slug="${esc(r.slug)}"><td class="mono steel">#${r.rank}</td><td><div class="proto-name">${esc(r.name)} ${badge}</div><div class="subline">${esc(chains)}</div></td>${compact ? '' : `<td><div>${esc(r.category || 'Other')}</div><div class="subline mono">${r.age_days !== null ? r.age_days + 'd' : 'n/a'} · ${r.applied_multiple.toFixed(2)}x</div></td>`}<td class="num mono"><div>${fmtUsd(r.tvl_usd)}</div><div class="subline">${fmtPct(r.change_7d)}</div></td><td class="num mono"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.min(100, r.token_odds_pct)}%"></div></div><span>${r.token_odds_pct.toFixed(0)}%</span></div><div class="subline">E: ${fmtUsd(r.prob_weighted_fdv_usd)}</div></td><td class="num mono"><div class="ochre">${fmtUsd(r.implied_value_usd)}</div><div class="subline">${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)}</div></td>${compact ? '' : `<td class="num"><div>${vBadge(r.dyn_verdict)} <span class="mono ${r.dyn_ev >= 0 ? 'pos' : 'neg'}">${evStr}</span></div><div class="subline mono">${esc(r.farm_chain)} · $${r.dyn_cost.toFixed(2)} cost · ${r.hold_days}d</div></td>`}</tr>`;
    }).join('');
    body.querySelectorAll('tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => { const s = tr.getAttribute('data-slug'); state.selectedSlug = state.selectedSlug === s ? null : s; renderAll(); }));
  }

  function renderDetailDrawer(allRows) {
    const drawer = $('detail-drawer'), ws = $('workspace'), row = state.view !== 'live' ? allRows.find((r) => r.slug === state.selectedSlug) : null;
    if (!row) { drawer.classList.add('hidden'); ws.classList.remove('has-detail'); return; }
    drawer.classList.remove('hidden'); ws.classList.add('has-detail');

    const box = (l, v, c = '') => `<div class="d-box"><div class="lbl">${l}</div><div class="val${c ? ' ' + c : ''}">${v}</div></div>`;
    const decomp = E.decomposeImpliedValue(row, D.coefficients);
    const plan = E.buildFarmPlan({ name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d }, row.age_days, row.implied_value_usd, row.token_odds_pct / 100, state.budget);
    const badge = row.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
    const direct = D.live.filter((p) => p.category && p.category === row.category).slice(0, 4);
    const peers = direct.length >= 2 ? direct : D.live.filter((p) => p.sector === row.sector).slice(0, 4);
    const peerLabel = direct.length >= 2 ? `LIVE ${String(row.category).toUpperCase()} PEERS` : `SECTOR PEERS (${row.sector.toUpperCase()})`;
    const compRows = [{ name: `${row.name} (Est.)`, val: row.implied_value_usd, est: true }, ...peers.map((p) => ({ name: `${p.name} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, est: false }))];
    const maxV = Math.max(...compRows.map((x) => x.val), 1);
    const peerSvg = `<svg viewBox="0 0 460 ${compRows.length * 17 + 2}">${compRows.map((c, i) => {
      const y = i * 17 + 1, w = Math.max(6, Math.round((c.val / maxV) * 210));
      return `<text x="150" y="${y + 11}" text-anchor="end" fill="${c.est ? '#151920' : '#4A5362'}" font-size="10" font-weight="${c.est ? '700' : '500'}">${esc(c.name.slice(0, 22))}</text><rect x="158" y="${y + 2}" width="210" height="9" rx="2" fill="#EFECE4"/><rect x="158" y="${y + 2}" width="${w}" height="9" rx="2" fill="${c.est ? '#9A4D12' : '#5B3E8C'}" fill-opacity="0.85"/><text x="376" y="${y + 11}" fill="#151920" font-size="10" font-family="ui-monospace,monospace">${fmtUsd(c.val)}</text>`;
    }).join('')}</svg>`;
    const parseStep = (txt) => { const m = txt.match(/^(.*?)\.\s+Cost:\s*(.+?)\.\s+Time:\s*(.+)$/i); return m ? { main: m[1] + '.', cost: m[2], time: m[3].replace(/\.$/, '') } : { main: txt, cost: '', time: '' }; };

    drawer.innerHTML =
      `<div class="d-head"><div><div class="d-title">${esc(row.name)} ${badge}</div><div class="d-sub">Rank #${row.rank} · ${esc(row.category || 'Other')} (${esc(row.sector)}) · ${row.age_days !== null ? row.age_days + 'd old' : 'age n/a'} · ${esc(row.chains.join(', '))}</div></div><button class="btn-ghost" id="d-close" type="button">Close</button></div>` +
      `<div><div class="d-sec-title"><span>Valuation Decomposition</span><span>P25–P75: ${fmtUsd(row.implied_low_usd)}–${fmtUsd(row.implied_high_usd)}</span></div><div class="d-formula">Base ${fmtUsd(decomp.baseSizeVal)} (TVL^${decomp.elasticity.toFixed(2)}) × ${row.growth_multiplier.toFixed(2)} (7d) × ${row.maturity_multiplier.toFixed(2)} (age) × ${row.category_adj_mult.toFixed(2)} (${row.adj_source}) = <b>${fmtUsd(row.implied_value_usd)}</b></div></div>` +
      `<div class="d-metrics">${box('Snapshot TVL', fmtUsd(row.tvl_usd))}${box('Implied MCAP', fmtUsd(row.implied_value_usd), 'ochre')}${box('Peer Token Rate', row.token_odds_pct.toFixed(1) + '%', 'steel')}${box('Prob-Wtd MCAP', fmtUsd(row.prob_weighted_fdv_usd))}${box('7d TVL Flow', fmtPct(row.change_7d))}${box('TVL Multiple', row.applied_multiple.toFixed(2) + 'x')}</div>` +
      `<div><div class="d-sec-title"><span>${peerLabel}</span><span>${peers.length} comps</span></div><div class="peers-box">${peerSvg}</div></div>` +
      `<div><div class="d-sec-title"><span>Costed Farm Ledger ($${state.budget} · ${esc(row.farm_chain)})</span>${vBadge(row.dyn_verdict)}</div>` +
      `<div class="econ-grid">${box('Gross Est.', '+$' + row.dyn_gross.toFixed(2), 'pos')}${box('Gas + Bridge', '-$' + (row.est_gas_usd + row.dyn_bridge).toFixed(2), 'neg')}${box('Slip + Carry', '-$' + (row.dyn_slippage + row.dyn_carry).toFixed(2), 'neg')}${box('Net EV (ROI)', `${row.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(row.dyn_ev).toFixed(2)} (${row.dyn_roi.toFixed(1)}%)`, row.dyn_ev >= 0 ? 'pos' : 'neg')}</div>` +
      `<ol class="steps-list">${plan.steps.map((s, i) => { const p = parseStep(s); return `<li class="step-item"><span class="step-num">${i + 1}</span><div class="step-body"><div>${esc(p.main)}</div>${p.cost || p.time ? `<div class="step-meta">${p.cost ? `<span class="step-tag cost">Cost: ${esc(p.cost)}</span>` : ''}${p.time ? `<span class="step-tag time">Time: ${esc(p.time)}</span>` : ''}</div>` : ''}</div></li>`; }).join('')}</ol></div>`;
    $('d-close').addEventListener('click', () => { state.selectedSlug = null; renderAll(); });
  }

  function renderAll() {
    const allRows = D.rows.map((r) => E.computeFarmEconomics(r, state.budget)), filtered = applyFilters(allRows);
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === state.view));
    document.querySelectorAll('.mini-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-chart') === state.rightChart));
    $('charts-grid').classList.toggle('hidden', state.chartsHidden);
    $('charts-toggle').textContent = state.chartsHidden ? 'Show Charts' : 'Hide Charts';
    $('charts-toggle').classList.toggle('active', !state.chartsHidden);
    renderHeaderAndKpis(allRows);
    renderMethodologyPanel();
    if (!state.chartsHidden) { renderCurveChart(allRows); renderTopChart(state.view === 'live' ? allRows : filtered); }
    renderTable(filtered);
    renderDetailDrawer(allRows);
  }

  function init() {
    const cats = [...new Set([...D.rows, ...D.live].map((r) => r.category).filter(Boolean))].sort();
    const chains = [...new Set([...D.rows, ...D.live].flatMap((r) => r.chains))].sort();
    const selOpts = [
      ['f-cat', cats],
      ['f-chain', chains],
    ];
    for (const [id, list] of selOpts) $(id).innerHTML += list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const binds = [['f-search', 'input', (v) => { state.search = v; }], ['f-cat', 'change', (v) => { state.category = v; }], ['f-chain', 'change', (v) => { state.chain = v; }], ['f-verdict', 'change', (v) => { state.verdict = v; }], ['f-tvl', 'change', (v) => { state.minTvl = Number(v) || 0; }], ['f-sort', 'change', (v) => { state.sort = v; }], ['f-budget', 'change', (v) => { state.budget = Number(v) || 1000; }]];
    $('f-search').value = state.search; $('f-cat').value = state.category; $('f-chain').value = state.chain;
    $('f-verdict').value = state.verdict; $('f-tvl').value = String(state.minTvl); $('f-sort').value = state.sort; $('f-budget').value = String(state.budget);
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.view = b.getAttribute('data-view'); renderAll(); }));
    document.querySelectorAll('.mini-btn').forEach((b) => b.addEventListener('click', () => { state.rightChart = b.getAttribute('data-chart'); renderAll(); }));
    $('proof-toggle').addEventListener('click', () => { state.proofOpen = !state.proofOpen; renderAll(); });
    $('charts-toggle').addEventListener('click', () => { state.chartsHidden = !state.chartsHidden; renderAll(); });
    for (const [id, ev, fn] of binds) $(id).addEventListener(ev, (e) => { fn(e.target.value); renderAll(); });
    $('f-reset').addEventListener('click', () => {
      Object.assign(state, { view: 'all', search: '', category: '', chain: '', verdict: '', minTvl: 0, sort: 'rank' });
      for (const id of ['f-search', 'f-cat', 'f-chain', 'f-verdict']) $(id).value = '';
      $('f-tvl').value = '0'; $('f-sort').value = 'rank';
      renderAll();
    });
    renderAll();
  }

  init();
})();
