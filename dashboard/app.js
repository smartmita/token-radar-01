(() => {
  'use strict';

  const D = window.RADAR, E = window.RadarEngine;
  if (!D || !Array.isArray(D.rows) || !E) { document.body.innerHTML = '<p style="padding:24px;color:#B42318">Missing window.RADAR or RadarEngine</p>'; return; }

  const qp = new URLSearchParams(window.location.search);
  const state = { view: qp.get('view') || 'all', search: qp.get('q') || '', category: qp.get('cat') || '', chain: qp.get('chain') || '', verdict: qp.get('verdict') || '', minTvl: Number(qp.get('minTvl') || 0), sort: qp.get('sort') || 'rank', budget: Number(qp.get('budget') || 1000), rightChart: qp.get('chart') || 'val', proofOpen: qp.get('proof') === '1', chartsHidden: qp.get('charts') === '0', selectedSlug: qp.get('detail') || null };
  const $ = (id) => document.getElementById(id), esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtUsd = (n) => { if (n == null || !Number.isFinite(n)) return '—'; const s = n < 0 ? '-' : '', a = Math.abs(n); return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(a < 100 ? 2 : 0)}`; };
  const fmtPct = (v) => v == null || !Number.isFinite(v) ? '<span class="dim">n/a</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  const vBadge = (v) => `<span class="v-pill ${v === 'STRONG FARM' ? 'v-strong' : v === 'FARM' ? 'v-farm' : v === 'SELECTIVE' ? 'v-sel' : 'v-skip'}">${esc(v)}</span>`;

  function applyFilters(allRows) {
    const q = state.search.trim().toLowerCase();
    if (state.view === 'live') return D.live.filter((p) => (!state.category || (p.category || '') === state.category) && (!state.chain || p.chains.includes(state.chain)) && (state.minTvl <= 0 || p.tvl_usd >= state.minTvl) && (!q || `${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q)));
    const filtered = allRows.filter((r) => (state.view !== 'watchlist' || r.cohort === 'watchlist') && (state.view !== 'early' || r.cohort === 'early') && (state.view !== 'farmable' || r.dyn_ev > 0) && (!state.category || (r.category || '') === state.category) && (!state.chain || r.chains.includes(state.chain)) && (!state.verdict || r.dyn_verdict === state.verdict) && (state.minTvl <= 0 || r.tvl_usd >= state.minTvl) && (!q || `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)));
    const sorters = { rank: (a, b) => a.rank - b.rank, ev: (a, b) => b.dyn_ev - a.dyn_ev || b.dyn_ev_hr - a.dyn_ev_hr, evhr: (a, b) => b.dyn_ev_hr - a.dyn_ev_hr || b.dyn_ev - a.dyn_ev, odds: (a, b) => b.token_odds_pct - a.token_odds_pct || b.implied_value_usd - a.implied_value_usd, pfdv: (a, b) => b.prob_weighted_fdv_usd - a.prob_weighted_fdv_usd, tvl: (a, b) => b.tvl_usd - a.tvl_usd, growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999) };
    return filtered.sort(sorters[state.sort] || sorters.rank);
  }

  function renderHeaderAndKpis(allRows) {
    const c = D.coefficients, v = D.validation, part = E.partitionProtocols(D), loo = v.loo_cv, wf = v.temporal_holdout;
    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent = `Snapshot ${D.as_of} · ${D.total_protocols} protocols: ${part.preTokenCount} pre-token (${part.watchlistCount} Watchlist + ${part.earlyCount} Early) · ${part.liveTotalCount} live (${part.liveCompsCount} peers) · ${part.excludedCount} wrappers`;
    $('live-sep-pill').textContent = `${part.liveTotalCount} LIVE TOKENS (${part.liveCompsCount} PEERS)`;
    $('curve-note').textContent = `MCAP ~ TVL^${c.beta_log_tvl.toFixed(2)} · Tier P25–P75 (${c.oof_coverage_pct.toFixed(0)}% OOF cov)`;
    $('integrity-strip').innerHTML = [['#0E5A46', 'Coverage:', `${part.watchlistCount}/${part.watchlistCount} floor + ${part.earlyCount} early = ${part.preTokenCount} ranked`], ['#5B3E8C', 'Live:', `${part.liveTotalCount} separated`], ['#1E4E79', 'Blind LOO:', `${loo.model_med_factor.toFixed(2)}x vs ${loo.naive_med_factor.toFixed(2)}x naive`], ['#9A4D12', 'Walk-Forward:', `${wf.model_med_factor.toFixed(2)}x vs ${wf.naive_med_factor.toFixed(2)}x (&rho;=${wf.model_spearman.toFixed(2)} vs ${wf.naive_spearman.toFixed(2)}; Cat EB dropped on CV)`]].map(([col, l, t]) => `<span class="int-item"><span class="int-dot" style="background:${col}"></span><b>${l}</b> ${t}</span>`).join('<span class="int-sep">|</span>');
    const farmable = allRows.filter((r) => r.dyn_ev > 0), strong = allRows.filter((r) => r.dyn_verdict === 'STRONG FARM'), bestEv = [...allRows].sort((a, b) => b.dyn_ev - a.dyn_ev)[0];
    $('cnt-all').textContent = String(allRows.length); $('cnt-wl').textContent = String(part.watchlistCount); $('cnt-early').textContent = String(part.earlyCount); $('cnt-farm').textContent = String(farmable.length); $('cnt-live').textContent = String(part.liveCompsCount);
    const kpis = [['Watchlist Floor Coverage', `${part.watchlistCount} / ${part.watchlistCount}`, 'c-pine', 'pine', `100% floor + ${part.earlyCount} early (<$50M TVL)`], ['Blind Held-Out (LOO / WF)', `${loo.model_med_factor.toFixed(2)}x / ${wf.model_med_factor.toFixed(2)}x`, 'c-steel', 'steel', `TVL^${c.beta_log_tvl.toFixed(2)} · WF ρ=${wf.model_spearman.toFixed(2)} vs ${wf.naive_spearman.toFixed(2)} naive`], ['Peer Token Rate (AUC)', `${v.token_odds_cv_auc.toFixed(3)}`, 'c-plum', 'plum', `5-fold Brier ${v.token_odds_cv_brier.toFixed(3)} across ${v.token_odds_universe} peers`], [`Top Farm EV ($${state.budget})`, bestEv ? `+$${bestEv.dyn_ev.toFixed(2)} · $${bestEv.dyn_ev_hr.toFixed(1)}/hr` : '—', 'c-ochre', 'ochre', `${strong.length} Strong / ${farmable.length} +EV · ${bestEv ? `${bestEv.name} (min $${bestEv.dyn_min_cap || '—'})` : 'n/a'}`]];
    $('kpi-grid').innerHTML = kpis.map(([l, val, bc, vc, ft]) => `<div class="kpi-card ${bc}"><div class="kpi-label">${l}</div><div class="kpi-val ${vc}">${val}</div><div class="kpi-foot">${esc(ft)}</div></div>`).join('');
  }

  function renderMethodologyPanel() {
    const panel = $('proof-panel');
    panel.classList.toggle('hidden', !state.proofOpen); $('proof-toggle').classList.toggle('active', state.proofOpen);
    if (!state.proofOpen) return;
    const v = D.validation, w = v.token_odds_weights, c = D.coefficients;
    const abRows = (v.ablation || []).map((a) => `<tr><td>${esc(a.label)}</td><td class="mono">${a.loo_med.toFixed(2)}x</td><td class="mono">${a.loo_rmse.toFixed(3)}</td><td class="mono">${a.wf_med.toFixed(2)}x</td><td class="mono">${a.wf_rho.toFixed(3)}</td><td class="${a.status.includes('Dropped') ? 'neg' : a.status.includes('Selected') ? 'pos' : 'dim'}">${esc(a.status)}</td></tr>`).join('');
    const chips = [['TVL β', c.beta_log_tvl], ['7d β', c.beta_growth_asinh], ['Age β', c.beta_log_age], ['Chains β', c.beta_log_chains], ['Odds Age', w.log_age], ['Odds Cat', w.category_prior]];
    panel.innerHTML = `<div><div class="proof-title">Blind Feature Ablation (LOO n=${v.loo_cv.sample_count} &amp; 30% Walk-Forward n=${v.temporal_holdout.sample_count})</div><table class="proof-table"><thead><tr><th>Spec</th><th>LOO Med</th><th>LOO RMSE</th><th>WF Med</th><th>WF Rho</th><th>Decision</th></tr></thead><tbody>${abRows}</tbody></table></div><div><div class="proof-title">Weights (AUC ${v.token_odds_cv_auc.toFixed(3)} · Tier P25–P75 Cov ${c.oof_coverage_pct.toFixed(0)}%)</div><div class="weights-grid">${chips.map(([l, x]) => `<div class="w-chip"><span>${l}</span><span>${x >= 0 ? '+' : ''}${x.toFixed(3)}</span></div>`).join('')}</div></div>`;
  }

  function renderCurveChart(allRows) {
    const W = 580, H = 128, pL = 52, pR = 14, pT = 10, pB = 20, pw = W - pL - pR, ph = H - pT - pB;
    const x0 = Math.log10(4e6), x1 = Math.log10(1.2e10), y0 = Math.log10(4e5), y1 = Math.log10(1e10);
    const mx = (v) => pL + ((Math.log10(Math.max(4e6, v)) - x0) / (x1 - x0)) * pw, my = (v) => pT + ph - ((Math.log10(Math.max(4e5, v)) - y0) / (y1 - y0)) * ph;
    const f = 'font-size="9" font-family="ui-monospace,monospace"';
    const gx = [1e7, 1e8, 1e9, 1e10].map((v) => `<line x1="${mx(v)}" y1="${pT}" x2="${mx(v)}" y2="${pT + ph}" stroke="#EAE4DA"/><text x="${mx(v)}" y="${H - 5}" text-anchor="middle" fill="#6C7584" ${f}>${fmtUsd(v)}</text>`).join('');
    const gy = [1e6, 1e7, 1e8, 1e9].map((v) => `<line x1="${pL}" y1="${my(v)}" x2="${W - pR}" y2="${my(v)}" stroke="#EAE4DA"/><text x="${pL - 6}" y="${my(v) + 3}" text-anchor="end" fill="#6C7584" ${f}>${fmtUsd(v)}</text>`).join('');
    const c = D.coefficients, linePts = [4e6, 2e7, 1e8, 5e8, 2.5e9, 1e10].map((t) => `${mx(t).toFixed(1)},${my(Math.exp(c.intercept + c.beta_log_tvl * (Math.log(t) - c.mean_log_tvl))).toFixed(1)}`).join(' ');
    const liveDots = D.live.map((p) => `<circle cx="${mx(p.tvl_usd).toFixed(1)}" cy="${my(p.mcap_usd).toFixed(1)}" r="2.3" fill="#5B3E8C" fill-opacity=".34"/>`).join('');
    const preDots = allRows.map((r) => `<circle class="pt" data-slug="${esc(r.slug)}" cx="${mx(r.tvl_usd).toFixed(1)}" cy="${my(r.implied_value_usd).toFixed(1)}" r="${r.slug === state.selectedSlug ? 5 : 2.6}" fill="${r.cohort === 'watchlist' ? '#9A4D12' : '#1E4E79'}" fill-opacity="${r.slug === state.selectedSlug ? 1 : .85}" stroke="${r.slug === state.selectedSlug ? '#151920' : 'none'}" stroke-width="1.4" style="cursor:pointer"/>`).join('');
    const leg = [['#5B3E8C', 6, `● Live (${D.live.length})`], ['#9A4D12', 88, `● Watchlist (${D.watchlist_count})`], ['#1E4E79', 184, `● Early (${D.early_count})`], ['#0E5A46', 268, `— TVL^${c.beta_log_tvl.toFixed(2)}`]].map(([col, x, t]) => `<text x="${pL + x}" y="${pT + 9}" fill="${col}" font-size="9.2" font-weight="600" font-family="ui-monospace,monospace">${t}</text>`).join('');
    $('chart-curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}"><rect x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="#FAF8F4" rx="4"/>${gx}${gy}${liveDots}<polyline fill="none" stroke="#0E5A46" stroke-width="2" points="${linePts}"/>${preDots}${leg}</svg>`;
    $('chart-curve').querySelectorAll('.pt').forEach((el) => el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTopChart(filtered) {
    const isEv = state.rightChart === 'ev', items = [...filtered].sort((a, b) => (isEv ? b.dyn_ev - a.dyn_ev : b.implied_value_usd - a.implied_value_usd)).slice(0, 7);
    $('right-chart-title').textContent = isEv ? `Top Net Farm EV ($${state.budget} Budget)` : 'Top Implied Valuations [P25–P75]';
    if (!items.length) { $('chart-top').innerHTML = '<div class="panel-note" style="padding:14px 0">No matching pre-token rows.</div>'; return; }
    const W = 580, rH = 18, h = items.length * rH + 4, lW = 148, bW = 268, minL = Math.log10(1e6), maxL = Math.log10(Math.max(...items.map((r) => r.implied_high_usd), 2e8)), maxEv = Math.max(...items.map((r) => r.dyn_ev), 1);
    const bW2 = (v) => isEv ? Math.max(4, Math.round((Math.max(0, v) / maxEv) * bW)) : Math.max(8, Math.round(((Math.log10(Math.max(1e6, v)) - minL) / Math.max(0.5, maxL - minL)) * bW));
    const bars = items.map((r, i) => {
      const y = i * rH + 2, w = bW2(isEv ? r.dyn_ev : r.implied_value_usd), col = isEv ? '#0E5A46' : (r.cohort === 'watchlist' ? '#9A4D12' : '#1E4E79');
      const rng = isEv ? '' : `<line x1="${lW + bW2(r.implied_low_usd)}" y1="${y + 8}" x2="${lW + bW2(r.implied_high_usd)}" y2="${y + 8}" stroke="#6C7584" stroke-width="1.2"/><circle cx="${lW + bW2(r.implied_low_usd)}" cy="${y + 8}" r="1.7" fill="#6C7584"/><circle cx="${lW + bW2(r.implied_high_usd)}" cy="${y + 8}" r="1.7" fill="#6C7584"/>`;
      const lbl = isEv ? `+$${r.dyn_ev.toFixed(2)} · $${r.dyn_ev_hr.toFixed(1)}/hr (${r.farm_chain})` : `${fmtUsd(r.implied_value_usd)} · ${r.token_odds_pct.toFixed(0)}% rate`;
      return `<g class="chart-row" data-slug="${esc(r.slug)}" style="cursor:pointer"><rect x="0" y="${y}" width="${W}" height="${rH - 2}" rx="4" fill="${r.slug === state.selectedSlug ? '#FBF1E6' : 'transparent'}"/><text x="${lW - 8}" y="${y + 12}" text-anchor="end" fill="#151920" font-size="10.5" font-weight="600">${esc(r.name.slice(0, 20))}</text><rect x="${lW}" y="${y + 3}" width="${bW}" height="9" rx="2" fill="#EFECE4"/><rect x="${lW}" y="${y + 3}" width="${w}" height="9" rx="2" fill="${col}" fill-opacity=".88"/>${rng}<text x="${lW + bW + 8}" y="${y + 12}" fill="#151920" font-size="10" font-family="ui-monospace,monospace">${esc(lbl)}</text></g>`;
    }).join('');
    $('chart-top').innerHTML = `<svg viewBox="0 0 ${W} ${h}">${bars}</svg>`;
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
    const cmp = Boolean(state.selectedSlug), arr = (k) => (state.sort === k ? ' ▼' : ''), cls = (k, ex = '') => `sortable${state.sort === k ? ' sorted' : ''}${ex ? ' ' + ex : ''}`;
    $('filter-summary').textContent = `${filtered.length} of ${D.rows.length} pre-token shown`;
    head.innerHTML = `<tr><th class="${cls('rank')}" data-sort="rank">Rank${arr('rank')}</th><th>Protocol</th>${cmp ? '' : '<th>Category</th>'}<th class="${cls('tvl', 'num')}" data-sort="tvl">TVL / 7d${arr('tvl')}</th><th class="${cls('odds', 'num')}" data-sort="odds">Peer Rate${arr('odds')}</th><th class="${cls('rank', 'num')}" data-sort="rank">Implied MCAP${arr('rank')}</th>${cmp ? '' : `<th class="${cls('ev', 'num')}" data-sort="ev">Farm EV / $/hr${arr('ev')}</th>`}</tr>`;
    head.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { state.sort = th.getAttribute('data-sort'); $('f-sort').value = state.sort; renderAll(); }));
    body.innerHTML = filtered.map((r) => {
      const sel = r.slug === state.selectedSlug ? 'selected' : '', badge = r.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
      const ord = r.chains.includes(r.farm_chain) ? [r.farm_chain, ...r.chains.filter((c) => c !== r.farm_chain)] : r.chains, ch = ord.slice(0, 3).join(', ') + (ord.length > 3 ? ` +${ord.length - 3}` : '');
      const evS = `${r.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev).toFixed(2)}`, hrS = `${r.dyn_ev_hr >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev_hr).toFixed(1)}/hr`;
      return `<tr class="${sel}" data-slug="${esc(r.slug)}"><td class="mono steel">#${r.rank}</td><td><div class="proto-name">${esc(r.name)} ${badge}</div><div class="subline">${esc(ch)}</div></td>${cmp ? '' : `<td><div>${esc(r.category || 'Other')}</div><div class="subline mono">${r.age_days !== null ? r.age_days + 'd' : 'n/a'} · ${r.applied_multiple.toFixed(2)}x</div></td>`}<td class="num mono"><div>${fmtUsd(r.tvl_usd)}</div><div class="subline">${fmtPct(r.change_7d)}</div></td><td class="num mono"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.min(100, r.token_odds_pct)}%"></div></div><span>${r.token_odds_pct.toFixed(0)}%</span></div><div class="subline">E: ${fmtUsd(r.prob_weighted_fdv_usd)}</div></td><td class="num mono"><div class="ochre">${fmtUsd(r.implied_value_usd)}</div><div class="subline">${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)}</div></td>${cmp ? '' : `<td class="num"><div>${vBadge(r.dyn_verdict)} <span class="mono ${r.dyn_ev >= 0 ? 'pos' : 'neg'}">${evS}</span></div><div class="subline mono">${esc(r.farm_chain)} · ${hrS} · min ${r.dyn_min_cap ? '$' + r.dyn_min_cap : 'n/a'}</div></td>`}</tr>`;
    }).join('');
    body.querySelectorAll('tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => { const s = tr.getAttribute('data-slug'); state.selectedSlug = state.selectedSlug === s ? null : s; renderAll(); }));
  }

  function renderDetailDrawer(allRows) {
    const drawer = $('detail-drawer'), ws = $('workspace'), row = state.view !== 'live' ? allRows.find((r) => r.slug === state.selectedSlug) : null;
    if (!row) { drawer.classList.add('hidden'); ws.classList.remove('has-detail'); return; }
    drawer.classList.remove('hidden'); ws.classList.add('has-detail');
    const box = (l, v, c = '') => `<div class="d-box"><div class="lbl">${l}</div><div class="val${c ? ' ' + c : ''}">${v}</div></div>`;
    const dec = E.decomposeImpliedValue(row, D.coefficients), plan = E.buildFarmPlan({ name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d }, row.age_days, row.implied_value_usd, row.token_odds_pct / 100, state.budget);
    const badge = row.cohort === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : '<span class="badge b-early">EARLY</span>';
    const dir = D.live.filter((p) => p.category && p.category === row.category).slice(0, 3), peers = dir.length >= 2 ? dir : D.live.filter((p) => p.sector === row.sector).slice(0, 3);
    const pLbl = dir.length >= 2 ? `LIVE ${String(row.category).toUpperCase()} PEERS` : `SECTOR PEERS (${row.sector.toUpperCase()})`;
    const cmpR = [{ name: `${row.name} (Est.)`, val: row.implied_value_usd, est: true }, ...peers.map((p) => ({ name: `${p.name} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, est: false }))], maxV = Math.max(...cmpR.map((x) => x.val), 1);
    const peerSvg = `<svg viewBox="0 0 460 ${cmpR.length * 15 + 2}">${cmpR.map((c, i) => { const y = i * 15 + 1, w = Math.max(6, Math.round((c.val / maxV) * 210)); return `<text x="150" y="${y + 10}" text-anchor="end" fill="${c.est ? '#151920' : '#4A5362'}" font-size="9.8" font-weight="${c.est ? '700' : '500'}">${esc(c.name.slice(0, 22))}</text><rect x="158" y="${y + 2}" width="210" height="8.5" rx="2" fill="#EFECE4"/><rect x="158" y="${y + 2}" width="${w}" height="8.5" rx="2" fill="${c.est ? '#9A4D12' : '#5B3E8C'}" fill-opacity=".85"/><text x="376" y="${y + 10}" fill="#151920" font-size="9.8" font-family="ui-monospace,monospace">${fmtUsd(c.val)}</text>`; }).join('')}</svg>`;
    const pStep = (t) => { const m = t.match(/^(.*?)\.\s+Cost:\s*(.+?)\.\s+Time:\s*(.+)$/i); return m ? { main: m[1] + '.', cost: m[2], time: m[3].replace(/\.$/, '') } : { main: t, cost: '', time: '' }; };
    drawer.innerHTML =
      `<div class="d-head"><div><div class="d-title">${esc(row.name)} ${badge}</div><div class="d-sub">Rank #${row.rank} · ${esc(row.category || 'Other')} (${esc(row.sector)}) · ${row.age_days !== null ? row.age_days + 'd old' : 'age n/a'} · ${esc(row.chains.join(', '))}</div></div><button class="btn-ghost" id="d-close" type="button">Close</button></div>` +
      `<div><div class="d-sec-title"><span>Valuation Decomposition</span><span>Tier P25–P75: ${fmtUsd(row.implied_low_usd)}–${fmtUsd(row.implied_high_usd)}</span></div><div class="d-formula">Base ${fmtUsd(dec.baseSizeVal)} (TVL^${dec.elasticity.toFixed(2)}) × ${row.growth_multiplier.toFixed(2)} (7d) × ${row.maturity_multiplier.toFixed(2)} (age) × ${row.chain_multiplier.toFixed(2)} (chains) = <b>${fmtUsd(row.implied_value_usd)}</b></div></div>` +
      `<div class="d-metrics">${box('Snapshot TVL', fmtUsd(row.tvl_usd))}${box('Implied MCAP', fmtUsd(row.implied_value_usd), 'ochre')}${box('Peer Token Rate', row.token_odds_pct.toFixed(1) + '%', 'steel')}${box('Prob-Wtd MCAP', fmtUsd(row.prob_weighted_fdv_usd))}${box('7d TVL Flow', fmtPct(row.change_7d))}${box('TVL Multiple', row.applied_multiple.toFixed(2) + 'x')}</div>` +
      `<div><div class="d-sec-title"><span>${pLbl}</span><span>${peers.length} comps</span></div><div class="peers-box">${peerSvg}</div></div>` +
      `<div><div class="d-sec-title"><span>Costed Farm Ledger ($${state.budget} · ${esc(row.farm_chain)} · Min ${row.dyn_min_cap ? '$' + row.dyn_min_cap : 'n/a'})</span>${vBadge(row.dyn_verdict)}</div>` +
      `<div class="econ-grid">${box('Gross Est.', '+$' + row.dyn_gross.toFixed(2), 'pos')}${box('Gas + Bridge', '-$' + (row.est_gas_usd + row.dyn_bridge).toFixed(2), 'neg')}${box('Slip + Carry', '-$' + (row.dyn_slippage + row.dyn_carry).toFixed(2), 'neg')}${box('Net EV ($/hr)', `${row.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(row.dyn_ev).toFixed(2)} ($${row.dyn_ev_hr.toFixed(1)}/hr)`, row.dyn_ev >= 0 ? 'pos' : 'neg')}</div>` +
      `<ol class="steps-list">${plan.steps.map((s, i) => { const p = pStep(s); return `<li class="step-item"><span class="step-num">${i + 1}</span><div class="step-body"><div>${esc(p.main)}</div>${p.cost || p.time ? `<div class="step-meta">${p.cost ? `<span class="step-tag cost">Cost: ${esc(p.cost)}</span>` : ''}${p.time ? `<span class="step-tag time">Time: ${esc(p.time)}</span>` : ''}</div>` : ''}</div></li>`; }).join('')}</ol></div>`;
    $('d-close').addEventListener('click', () => { state.selectedSlug = null; renderAll(); });
  }

  function renderAll() {
    const allRows = D.rows.map((r) => E.computeFarmEconomics(r, state.budget)), flt = applyFilters(allRows);
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === state.view));
    document.querySelectorAll('.mini-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-chart') === state.rightChart));
    $('charts-grid').classList.toggle('hidden', state.chartsHidden); $('charts-toggle').textContent = state.chartsHidden ? 'Show Charts' : 'Hide Charts'; $('charts-toggle').classList.toggle('active', !state.chartsHidden);
    renderHeaderAndKpis(allRows); renderMethodologyPanel();
    if (!state.chartsHidden) { renderCurveChart(allRows); renderTopChart(state.view === 'live' ? allRows : flt); }
    renderTable(flt); renderDetailDrawer(allRows);
  }
  const cats = [...new Set([...D.rows, ...D.live].map((r) => r.category).filter(Boolean))].sort(), chains = [...new Set([...D.rows, ...D.live].flatMap((r) => r.chains))].sort();
  for (const [id, list] of [['f-cat', cats], ['f-chain', chains]]) $(id).innerHTML += list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  for (const [id, ev, k, fn] of [['f-search', 'input', 'search', String], ['f-cat', 'change', 'category', String], ['f-chain', 'change', 'chain', String], ['f-verdict', 'change', 'verdict', String], ['f-tvl', 'change', 'minTvl', (v) => Number(v) || 0], ['f-sort', 'change', 'sort', String], ['f-budget', 'change', 'budget', (v) => Number(v) || 1000]]) { $(id).value = String(state[k]); $(id).addEventListener(ev, (e) => { state[k] = fn(e.target.value); renderAll(); }); }
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.view = b.getAttribute('data-view'); renderAll(); }));
  document.querySelectorAll('.mini-btn').forEach((b) => b.addEventListener('click', () => { state.rightChart = b.getAttribute('data-chart'); renderAll(); }));
  $('proof-toggle').addEventListener('click', () => { state.proofOpen = !state.proofOpen; renderAll(); });
  $('charts-toggle').addEventListener('click', () => { state.chartsHidden = !state.chartsHidden; renderAll(); });
  $('f-reset').addEventListener('click', () => { Object.assign(state, { view: 'all', search: '', category: '', chain: '', verdict: '', minTvl: 0, sort: 'rank' }); for (const id of ['f-search', 'f-cat', 'f-chain', 'f-verdict']) $(id).value = ''; $('f-tvl').value = '0'; $('f-sort').value = 'rank'; renderAll(); });
  renderAll();
})();
