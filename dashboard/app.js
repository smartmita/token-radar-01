(() => {
  'use strict';

  const D = window.RADAR, E = window.RadarEngine;
  if (!D || !Array.isArray(D.rows) || !E) { document.body.innerHTML = '<p style="padding:24px;color:#B42318">Missing window.RADAR or RadarEngine</p>'; return; }

  const qp = new URLSearchParams(window.location.search);
  const st = { view: qp.get('view') || 'all', search: qp.get('q') || '', category: qp.get('cat') || '', chain: qp.get('chain') || '', verdict: qp.get('verdict') || '', minTvl: Number(qp.get('minTvl') || 0), sort: qp.get('sort') || 'rank', budget: Number(qp.get('budget') || 5000), rightChart: qp.get('chart') || 'val', proofOpen: qp.get('proof') !== '0', chartsHidden: qp.get('charts') === '1', selectedSlug: qp.get('detail') || null };
  const $ = (id) => document.getElementById(id), esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtUsd = (n) => { if (n == null || !Number.isFinite(n)) return '—'; const s = n < 0 ? '-' : '', a = Math.abs(n); return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(a < 100 ? 2 : 0)}`; };
  const fmtPct = (v) => v == null || !Number.isFinite(v) ? '<span class="dim">n/a</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  const vBadge = (v) => `<span class="v-pill ${v === 'STRONG FARM' ? 'v-strong' : v === 'FARM' ? 'v-farm' : v === 'SELECTIVE' ? 'v-sel' : 'v-skip'}">${esc(v)}</span>`;
  const cBadge = (c) => c === 'watchlist' ? '<span class="badge b-wl">WATCHLIST</span>' : c === 'offlist' ? '<span class="badge b-off">OFF-LIST &ge;$50M</span>' : '<span class="badge b-early">EARLY</span>';

  function applyFilters(allRows) {
    const q = st.search.trim().toLowerCase();
    if (st.view === 'live') return D.live.filter((p) => (!st.category || (p.category || '') === st.category) && (!st.chain || p.chains.includes(st.chain)) && (st.minTvl <= 0 || p.tvl_usd >= st.minTvl) && (!q || `${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q)));
    const flt = allRows.filter((r) => (st.view !== 'watchlist' || r.cohort === 'watchlist') && (st.view !== 'offlist' || r.cohort === 'offlist') && (st.view !== 'early' || r.cohort === 'early') && (st.view !== 'farmable' || r.dyn_ev > 0) && (!st.category || (r.category || '') === st.category) && (!st.chain || r.chains.includes(st.chain)) && (!st.verdict || r.dyn_verdict === st.verdict) && (st.minTvl <= 0 || r.tvl_usd >= st.minTvl) && (!q || `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)));
    const sr = { rank: (a, b) => a.rank - b.rank, cond: (a, b) => b.cond_fdv_usd - a.cond_fdv_usd, ev: (a, b) => b.dyn_ev - a.dyn_ev || b.dyn_ev_hr - a.dyn_ev_hr, evhr: (a, b) => b.dyn_ev_hr - a.dyn_ev_hr || b.dyn_ev - a.dyn_ev, odds: (a, b) => b.token_odds_pct - a.token_odds_pct || b.implied_value_usd - a.implied_value_usd, tvl: (a, b) => b.tvl_usd - a.tvl_usd, growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999) };
    return flt.sort(sr[st.sort] || sr.rank);
  }

  function renderHeaderAndKpis(allRows, flt) {
    const c = D.coefficients, v = D.validation, L = E.LEDGERCHECK(D), loo = v.loo_cv, wf = v.temporal_holdout;
    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent = `${D.as_of} · LEDGERCHECK(): ${L.preTokenCount} pre (${L.watchlistCount} WL + ${L.offlistCount} Off-List >=$50M + ${L.earlyCount} Early) · ${L.liveTotalCount} live (${L.liveCompsCount} peers) · ${L.excludedCount} wrappers`;
    $('pre-sep-pill').textContent = `${L.preTokenCount} PRE-TOKEN RANKED`; $('live-sep-pill').textContent = `${L.liveTotalCount} LIVE SEPARATED`;
    $('curve-note').textContent = `VALUELADDER() TVL^${c.beta_log_tvl.toFixed(2)} · P25–75 ${c.oof_coverage_pct.toFixed(0)}% / P10–90 ${c.oof_cov80_pct.toFixed(0)}%`;
    const act = st.view === 'live' ? allRows : flt, farm = allRows.filter((r) => r.dyn_ev > 0), strong = allRows.filter((r) => r.dyn_verdict === 'STRONG FARM'), best = [...act].sort((a, b) => b.dyn_ev - a.dyn_ev)[0];
    $('cnt-all').textContent = String(allRows.length); $('cnt-wl').textContent = String(L.watchlistCount); $('cnt-off').textContent = String(L.offlistCount); $('cnt-early').textContent = String(L.earlyCount); $('cnt-farm').textContent = String(farm.length); $('cnt-live').textContent = String(L.liveCompsCount);
    $('audit-strip').innerHTML = `<span><b>LEDGERCHECK() 758/758:</b> ${L.watchlistCount} WL + ${L.offlistCount} Off-List &ge;$50M + ${L.earlyCount} Early = <b>${L.preTokenCount}</b> Pre</span><span>+ <b>${L.excludedCount}</b> Excl + <b>${L.liveTotalCount}</b> Live (${L.liveCompsCount} Peers) = <b>${L.totalCount}</b></span><span><b>VALUELADDER():</b> LOO ${loo.model_med_factor.toFixed(2)}x (vs ${loo.naive_med_factor.toFixed(2)}x) · WF ${wf.model_med_factor.toFixed(2)}x (vs ${wf.naive_med_factor.toFixed(2)}x)</span><span><b>LAUNCHODDS():</b> 10F Brier ${v.token_odds_cv_brier.toFixed(3)} · WF ${v.token_odds_wf_brier.toFixed(3)}</span>`;
    const kpis = [
      ['Coverage (>= $50M + Early)', `${L.watchlistCount}+${L.offlistCount} / ${L.preTokenCount}`, 'c-pine', 'pine', `${L.watchlistCount} watchlist + ${L.offlistCount} off-list >=$50M + ${L.earlyCount} early`],
      ['VALUELADDER() OOS Error', `${loo.model_med_factor.toFixed(2)}x / ${wf.model_med_factor.toFixed(2)}x`, 'c-steel', 'steel', `P25–75 ${c.oof_coverage_pct.toFixed(0)}% · P10–90 ${c.oof_cov80_pct.toFixed(0)}% · WF ρ=${wf.model_spearman.toFixed(2)}`],
      ['LAUNCHODDS() 10F / WF', `${v.token_odds_cv_auc.toFixed(3)} / ${v.token_odds_wf_auc.toFixed(3)} AUC`, 'c-plum', 'plum', `10F Brier ${v.token_odds_cv_brier.toFixed(3)} (vs ${v.token_odds_base_brier.toFixed(3)}) · WF ${v.token_odds_wf_brier.toFixed(3)}`],
      [`FARMPLAN() +EV ($${st.budget})`, `${farm.length} / ${L.preTokenCount} +EV`, 'c-ochre', 'ochre', best ? `Top: ${best.name} +$${best.dyn_ev.toFixed(2)} ($${best.dyn_ev_hr.toFixed(2)}/hr · ${strong.length} Strong)` : 'No +EV match'],
    ];
    $('kpi-grid').innerHTML = kpis.map(([l, val, bc, vc, ft]) => `<div class="kpi-card ${bc}"><div class="kpi-label">${l}</div><div class="kpi-val ${vc}">${val}</div><div class="kpi-foot">${esc(ft)}</div></div>`).join('');
  }

  function renderMethodologyPanel() {
    const panel = $('proof-panel');
    panel.classList.toggle('hidden', !st.proofOpen); $('proof-toggle').classList.toggle('active', st.proofOpen);
    if (!st.proofOpen) return;
    const v = D.validation, w = v.token_odds_weights, c = D.coefficients;
    const abRows = (v.ablation || []).map((a) => `<tr><td>${esc(a.label)}</td><td class="mono">${a.loo_med.toFixed(2)}x</td><td class="mono">${a.loo_rmse.toFixed(3)}</td><td class="mono">${a.wf_med.toFixed(2)}x</td><td class="mono">${a.wf_rmse.toFixed(3)}</td><td class="${a.status.includes('Dropped') ? 'dim' : a.status.includes('Selected') ? 'pos' : ''}">${esc(a.status)}</td></tr>`).join('');
    const chips = [['10F Odds Brier', `${v.token_odds_cv_brier.toFixed(3)} (vs ${v.token_odds_base_brier.toFixed(3)})`], ['WF Odds Brier', `${v.token_odds_wf_brier.toFixed(3)} (vs ${v.token_odds_wf_base_brier.toFixed(3)})`], ['P25–P75 Cov', `${c.oof_coverage_pct.toFixed(1)}% (50% nom)`], ['P10–P90 Cov', `${c.oof_cov80_pct.toFixed(1)}% (80% nom)`], ['TVL β / Chains β', `${c.beta_log_tvl.toFixed(3)} / ${c.beta_log_chains.toFixed(3)}`], ['FARMPLAN() Cal', '2.5% pool · TVL^0.92 · 6.5%']];
    panel.innerHTML = `<div><div class="proof-title"><span>VALUELADDER() LOO (n=${v.loo_cv.sample_count}) &amp; Walk-Forward (n=${v.temporal_holdout.sample_count}) Ablation</span><span class="mono">Keep only terms beating both</span></div><table class="proof-table"><thead><tr><th>Spec</th><th>LOO Med</th><th>LOO RMSE</th><th>WF Med</th><th>WF RMSE</th><th>CV Decision</th></tr></thead><tbody>${abRows}</tbody></table></div><div><div class="proof-title"><span>LAUNCHODDS() Calibration &amp; FARMPLAN() Parameters</span><span class="mono">Age β=${w.log_age.toFixed(2)} · Cat=${w.category_prior.toFixed(2)}</span></div><div class="weights-grid">${chips.map(([l, x]) => `<div class="w-chip"><span>${esc(l)}</span><span>${esc(x)}</span></div>`).join('')}</div></div>`;
  }

  function renderCurveChart(allRows, flt) {
    const W = 580, H = 104, pL = 50, pR = 12, pT = 8, pB = 18, pw = W - pL - pR, ph = H - pT - pB;
    const x0 = Math.log10(4e6), x1 = Math.log10(1.2e10), y0 = Math.log10(3e5), y1 = Math.log10(1e10);
    const mx = (v) => pL + ((Math.log10(Math.max(4e6, v)) - x0) / (x1 - x0)) * pw, my = (v) => pT + ph - ((Math.log10(Math.max(3e5, v)) - y0) / (y1 - y0)) * ph;
    const gx = [1e7, 1e8, 1e9, 1e10].map((v) => `<line x1="${mx(v)}" y1="${pT}" x2="${mx(v)}" y2="${pT + ph}" stroke="#EAE4DA"/><text class="m" x="${mx(v)}" y="${H - 4}" text-anchor="middle" fill="#6C7584" font-size="8.5">${fmtUsd(v)}</text>`).join('');
    const gy = [1e6, 1e7, 1e8, 1e9].map((v) => `<line x1="${pL}" y1="${my(v)}" x2="${W - pR}" y2="${my(v)}" stroke="#EAE4DA"/><text class="m" x="${pL - 5}" y="${my(v) + 3}" text-anchor="end" fill="#6C7584" font-size="8.5">${fmtUsd(v)}</text>`).join('');
    const c = D.coefficients, xs = [4e6, 2e7, 1e8, 5e8, 2.5e9, 1e10], lineY = (t) => Math.exp(c.intercept + c.beta_log_tvl * (Math.log(t) - c.mean_log_tvl));
    const pts = xs.map((t) => `${mx(t).toFixed(1)},${my(lineY(t)).toFixed(1)}`).join(' '), up = xs.map((t) => `${mx(t).toFixed(1)},${my(lineY(t) * Math.exp(c.oof_q75_log_err)).toFixed(1)}`), lo = [...xs].reverse().map((t) => `${mx(t).toFixed(1)},${my(lineY(t) * Math.exp(c.oof_q25_log_err)).toFixed(1)}`);
    const hasSub = st.view !== 'live' && flt.length < allRows.length, mSet = new Set(flt.map((r) => r.slug));
    const liveD = D.live.map((p) => `<circle cx="${mx(p.tvl_usd).toFixed(1)}" cy="${my(p.mcap_usd).toFixed(1)}" r="2" fill="#5B3E8C" fill-opacity=".28"/>`).join('');
    const preD = allRows.map((r) => { const act = !hasSub || mSet.has(r.slug), sel = r.slug === st.selectedSlug, col = r.cohort === 'watchlist' ? '#9A4D12' : r.cohort === 'offlist' ? '#0E5A46' : '#1E4E79'; return `<circle class="pt" data-slug="${esc(r.slug)}" cx="${mx(r.tvl_usd).toFixed(1)}" cy="${my(r.implied_value_usd).toFixed(1)}" r="${sel ? 4.8 : act && hasSub ? 3.2 : 2.4}" fill="${col}" fill-opacity="${sel ? 1 : act ? 0.9 : 0.14}" stroke="${sel ? '#151920' : 'none'}" stroke-width="1.3"/>`; }).join('');
    const leg = [['#5B3E8C', 5, `● Live (${D.live.length})`], ['#9A4D12', 78, `● WL (${D.watchlist_count})`], ['#0E5A46', 142, `● Off-List (${D.offlist_count})`], ['#1E4E79', 224, `● Early (${D.early_count})`], ['#0E5A46', 300, `— Cond.FDV TVL^${c.beta_log_tvl.toFixed(2)}`]].map(([col, x, t]) => `<text class="m" x="${pL + x}" y="${pT + 9}" fill="${col}" font-size="8.6" font-weight="600">${t}</text>`).join('');
    $('chart-curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}"><rect x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="#FAF8F4" rx="4"/>${gx}${gy}<polygon points="${[...up, ...lo].join(' ')}" fill="#0E5A46" fill-opacity=".07"/>${liveD}<polyline fill="none" stroke="#0E5A46" stroke-width="1.7" stroke-dasharray="3,2" points="${pts}"/>${preD}${leg}</svg>`;
    $('chart-curve').querySelectorAll('.pt').forEach((el) => el.addEventListener('click', () => { st.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTopChart(filtered) {
    const isEv = st.rightChart === 'ev', items = [...filtered].sort((a, b) => (isEv ? b.dyn_ev - a.dyn_ev || b.dyn_ev_hr - a.dyn_ev_hr : b.implied_value_usd - a.implied_value_usd)).slice(0, 6);
    $('right-chart-title').textContent = isEv ? `Top FARMPLAN() Net EV ($${st.budget})` : 'Top Expected Launch Values [P25–P75]';
    if (!items.length) { $('chart-top').innerHTML = '<div class="panel-note" style="padding:12px 0">No matching pre-token rows.</div>'; return; }
    const W = 580, rH = 17, h = items.length * rH + 2, lW = 148, bW = 216, minL = Math.log10(3e5), maxL = Math.log10(Math.max(...items.map((r) => r.implied_high_usd), 5e7)), maxEv = Math.max(...items.map((r) => r.dyn_ev), 1);
    const barW = (v) => isEv ? Math.max(4, Math.round((Math.max(0, v) / maxEv) * bW)) : Math.max(8, Math.round(((Math.log10(Math.max(3e5, v)) - minL) / Math.max(0.5, maxL - minL)) * bW));
    const bars = items.map((r, i) => {
      const y = i * rH + 1, w = barW(isEv ? r.dyn_ev : r.implied_value_usd), col = isEv ? '#0E5A46' : r.cohort === 'watchlist' ? '#9A4D12' : r.cohort === 'offlist' ? '#0E5A46' : '#1E4E79';
      const rng = isEv ? '' : `<line x1="${lW + barW(r.implied_low_usd)}" y1="${y + 7.5}" x2="${lW + barW(r.implied_high_usd)}" y2="${y + 7.5}" stroke="#6C7584" stroke-width="1.2"/><circle cx="${lW + barW(r.implied_low_usd)}" cy="${y + 7.5}" r="1.6" fill="#6C7584"/><circle cx="${lW + barW(r.implied_high_usd)}" cy="${y + 7.5}" r="1.6" fill="#6C7584"/>`;
      const lbl = isEv ? `+$${r.dyn_ev.toFixed(2)} · $${r.dyn_ev_hr.toFixed(2)}/hr (${r.farm_chain})` : `${fmtUsd(r.implied_value_usd)} (${fmtUsd(r.cond_fdv_usd)} × ${r.token_odds_pct.toFixed(0)}%)`;
      return `<g class="chart-row" data-slug="${esc(r.slug)}"><rect x="0" y="${y}" width="${W}" height="${rH - 2}" rx="4" fill="${r.slug === st.selectedSlug ? '#FBF1E6' : 'transparent'}"/><text x="${lW - 7}" y="${y + 11.5}" text-anchor="end" fill="#151920" font-size="10" font-weight="600">${esc(r.name.slice(0, 22))}</text><rect x="${lW}" y="${y + 3}" width="${bW}" height="8.5" rx="2" fill="#EFECE4"/><rect x="${lW}" y="${y + 3}" width="${w}" height="8.5" rx="2" fill="${col}" fill-opacity=".88"/>${rng}<text class="m" x="${lW + bW + 7}" y="${y + 11.5}" fill="#151920" font-size="9.5">${esc(lbl)}</text></g>`;
    }).join('');
    $('chart-top').innerHTML = `<svg viewBox="0 0 ${W} ${h}">${bars}</svg>`;
    $('chart-top').querySelectorAll('.chart-row').forEach((el) => el.addEventListener('click', () => { st.selectedSlug = el.getAttribute('data-slug'); renderAll(); }));
  }

  function renderTable(flt) {
    const hd = $('table-head'), bd = $('table-body');
    if (st.view === 'live') {
      $('filter-summary').textContent = `${flt.length} of ${D.live.length} clean live peers`;
      hd.innerHTML = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Live MCAP</th><th class="num">MCAP/TVL</th><th class="num">7d &Delta;</th><th class="num">Age</th></tr>';
      bd.innerHTML = flt.map((p) => `<tr><td><div class="proto-name">${esc(p.name)} <span class="badge b-live">${esc(p.symbol || 'LIVE')}</span></div><div class="subline">${esc(p.chains.slice(0, 4).join(', '))}</div></td><td>${esc(p.category || 'Other')}</td><td class="num mono">${fmtUsd(p.tvl_usd)}</td><td class="num mono plum">${fmtUsd(p.mcap_usd)}</td><td class="num mono">${p.mcap_tvl_ratio.toFixed(2)}x</td><td class="num mono">${fmtPct(p.change_7d)}</td><td class="num mono dim">${p.age_days !== null ? `${p.age_days}d` : 'n/a'}</td></tr>`).join('');
      return;
    }
    const cmp = Boolean(st.selectedSlug), arr = (k) => (st.sort === k ? ' ▼' : ''), cls = (k, ex = '') => `sortable${st.sort === k ? ' sorted' : ''}${ex ? ` ${ex}` : ''}`;
    $('filter-summary').textContent = `${flt.length} of ${D.rows.length} pre-token shown`;
    hd.innerHTML = `<tr><th class="${cls('rank')}" data-sort="rank">Rank${arr('rank')}</th><th>Protocol</th>${cmp ? '' : '<th>Category &amp; Age</th>'}<th class="${cls('tvl', 'num')}" data-sort="tvl">TVL / 7d${arr('tvl')}</th><th class="${cls('odds', 'num')}" data-sort="odds">Cond. FDV &times; Odds${arr('odds')}</th><th class="${cls('rank', 'num')}" data-sort="rank">Expected Value${arr('rank')}</th>${cmp ? '' : `<th class="${cls('ev', 'num')}" data-sort="ev">FARMPLAN() ($${st.budget})${arr('ev')}</th>`}</tr>`;
    hd.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { st.sort = th.getAttribute('data-sort'); $('f-sort').value = st.sort; renderAll(); }));
    bd.innerHTML = flt.map((r) => {
      const sel = r.slug === st.selectedSlug ? 'selected' : '', ord = r.chains.includes(r.farm_chain) ? [r.farm_chain, ...r.chains.filter((c) => c !== r.farm_chain)] : r.chains, ch = ord.slice(0, 3).join(', ') + (ord.length > 3 ? ` +${ord.length - 3}` : '');
      const evS = `${r.dyn_ev >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev).toFixed(2)}`, hrS = `${r.dyn_ev_hr >= 0 ? '+' : '-'}$${Math.abs(r.dyn_ev_hr).toFixed(2)}/hr`;
      return `<tr class="${sel}" data-slug="${esc(r.slug)}"><td class="mono steel">#${r.rank}</td><td><div class="proto-name">${esc(r.name)} ${cBadge(r.cohort)}</div><div class="subline">${esc(ch)}</div></td>${cmp ? '' : `<td><div>${esc(r.category || 'Other')}</div><div class="subline mono">${r.age_days !== null ? `${r.age_days}d` : 'n/a'} · ${r.applied_multiple.toFixed(2)}x TVL</div></td>`}<td class="num mono"><div>${fmtUsd(r.tvl_usd)}</div><div class="subline">${fmtPct(r.change_7d)}</div></td><td class="num mono"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.min(100, r.token_odds_pct)}%"></div></div><span>${r.token_odds_pct.toFixed(1)}%</span></div><div class="subline">If launched: ${fmtUsd(r.cond_fdv_usd)}</div></td><td class="num mono"><div class="ochre">${fmtUsd(r.implied_value_usd)}</div><div class="subline">${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)}</div></td>${cmp ? '' : `<td class="num"><div>${vBadge(r.dyn_verdict)} <span class="mono ${r.dyn_ev >= 0 ? 'pos' : 'neg'}">${evS}</span></div><div class="subline mono">${esc(r.farm_chain)} · ${hrS} · min ${r.dyn_min_cap ? `$${r.dyn_min_cap}` : 'n/a'}</div></td>`}</tr>`;
    }).join('');
    bd.querySelectorAll('tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => { const s = tr.getAttribute('data-slug'); st.selectedSlug = st.selectedSlug === s ? null : s; renderAll(); }));
  }

  function renderDetailDrawer(allRows) {
    const dw = $('detail-drawer'), ws = $('workspace'), r = st.view !== 'live' ? allRows.find((x) => x.slug === st.selectedSlug) : null;
    if (!r) { dw.classList.add('hidden'); ws.classList.remove('has-detail'); return; }
    dw.classList.remove('hidden'); ws.classList.add('has-detail');
    const bx = (l, v, c = '') => `<div class="d-box"><div class="lbl">${l}</div><div class="val${c ? ` ${c}` : ''}">${v}</div></div>`;
    const dec = E.decomposeImpliedValue(r, D.coefficients), plan = E.FARMPLAN({ name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d }, r.age_days, r.implied_value_usd, r.token_odds_pct / 100, st.budget);
    const dir = D.live.filter((p) => p.category && p.category === r.category).slice(0, 3), peers = dir.length >= 2 ? dir : D.live.filter((p) => p.sector === r.sector).slice(0, 3), pLbl = dir.length >= 2 ? `LIVE ${String(r.category).toUpperCase()} PEERS` : `SECTOR PEERS (${r.sector.toUpperCase()})`;
    const cmpR = [{ name: `${r.name} (Cond.)`, val: r.cond_fdv_usd, est: true }, ...peers.map((p) => ({ name: `${p.name} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, est: false }))], maxV = Math.max(...cmpR.map((x) => x.val), 1);
    const peerSvg = `<svg viewBox="0 0 460 ${cmpR.length * 16 + 2}">${cmpR.map((c, i) => { const y = i * 16 + 1, w = Math.max(6, Math.round((c.val / maxV) * 210)); return `<text x="150" y="${y + 11}" text-anchor="end" fill="${c.est ? '#151920' : '#4A5362'}" font-size="9.6" font-weight="${c.est ? '700' : '500'}">${esc(c.name.slice(0, 22))}</text><rect x="158" y="${y + 2.5}" width="210" height="8.5" rx="2" fill="#EFECE4"/><rect x="158" y="${y + 2.5}" width="${w}" height="8.5" rx="2" fill="${c.est ? '#9A4D12' : '#5B3E8C'}" fill-opacity=".85"/><text class="m" x="376" y="${y + 11}" fill="#151920" font-size="9.6">${fmtUsd(c.val)}</text>`; }).join('')}</svg>`;
    const pStep = (t) => { const m = t.match(/^(.*?)\.\s+Cost:\s*(.+?)\.\s+Time:\s*(.+)$/i); if (!m) return { main: t, cap: '', cost: '', time: '' }; const cm = m[1].match(/^(.*?)\s*\((\$[\d,]+\s+principal\s+returned\s+at\s+exit)\)$/i); return { main: `${cm ? cm[1] : m[1]}.`, cap: cm ? cm[2] : '', cost: m[2], time: m[3].replace(/\.$/, '') }; };
    const fmtEv = (x) => `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(2)}`, fmtHr = (x) => `${fmtEv(x)}/hr`;
    const tiers = [1000, 5000, 10000].map((cap) => { const t = E.computeFarmEconomics(r, cap); return `<div class="tier-box${cap === st.budget ? ' active' : ''}"><div>$${cap.toLocaleString()} · ${esc(t.dyn_verdict)}</div><div class="${t.dyn_ev >= 0 ? 'pos' : 'neg'}">${fmtEv(t.dyn_ev)} (${t.dyn_roi.toFixed(1)}% · $${t.dyn_ev_hr.toFixed(1)}/hr)</div></div>`; }).join('');
    dw.innerHTML = `<div class="d-head"><div><div class="d-title">${esc(r.name)} ${cBadge(r.cohort)}</div><div class="d-sub">Rank #${r.rank} · ${esc(r.category || 'Other')} (${esc(r.sector)}) · ${r.age_days !== null ? `${r.age_days}d` : 'n/a'} · ${esc(r.chains.join(', '))}</div></div><button class="btn-ghost" id="d-close" type="button">Close</button></div><div><div class="d-sec-title"><span>VALUELADDER() &times; LAUNCHODDS()</span><span>P25–75: ${fmtUsd(r.implied_low_usd)}–${fmtUsd(r.implied_high_usd)} · P10–90: ${fmtUsd(r.implied_p10_usd)}–${fmtUsd(r.implied_p90_usd)}</span></div><div class="d-formula">Base ${fmtUsd(dec.baseSizeVal)} (TVL^${dec.elasticity.toFixed(2)}) × ${r.chain_multiplier.toFixed(2)} (chains) = Cond. ${fmtUsd(r.cond_fdv_usd)} × ${r.token_odds_pct.toFixed(1)}% odds = <b>${fmtUsd(r.implied_value_usd)}</b></div></div><div class="d-metrics">${bx('TVL', fmtUsd(r.tvl_usd))}${bx('Cond. FDV', fmtUsd(r.cond_fdv_usd))}${bx('12M Odds', `${r.token_odds_pct.toFixed(1)}%`, 'steel')}${bx('Expected Value', fmtUsd(r.implied_value_usd), 'ochre')}${bx('7d Flow', fmtPct(r.change_7d))}${bx('Exp/TVL', `${r.applied_multiple.toFixed(2)}x`)}</div><div><div class="d-sec-title"><span>${pLbl} (vs Cond. FDV)</span><span>${peers.length} comps</span></div><div class="peers-box">${peerSvg}</div></div><div><div class="d-sec-title"><span>FARMPLAN() ($${st.budget} · ${esc(r.farm_chain)} · Min ${r.dyn_min_cap ? `$${r.dyn_min_cap}` : 'n/a'})</span>${vBadge(r.dyn_verdict)}</div><div class="econ-grid">${bx('Gross', `+$${r.dyn_gross.toFixed(2)}`, 'pos')}${bx('Gas+Br', `-$${(r.est_gas_usd + r.dyn_bridge).toFixed(2)}`, 'neg')}${bx('Slip+Carry', `-$${(r.dyn_slippage + r.dyn_carry).toFixed(2)}`, 'neg')}${bx('Net EV', `${fmtEv(r.dyn_ev)} (${fmtHr(r.dyn_ev_hr)})`, r.dyn_ev >= 0 ? 'pos' : 'neg')}</div><div class="tier-grid">${tiers}</div><ol class="steps-list">${plan.steps.map((s, i) => { const p = pStep(s); return `<li class="step-item"><span class="step-num">${i + 1}</span><div class="step-body"><div>${esc(p.main)}</div><div class="step-meta">${p.cap ? `<span class="step-tag cap">${esc(p.cap)}</span>` : ''}${p.cost ? `<span class="step-tag cost">${esc(p.cost)}</span>` : ''}${p.time ? `<span class="step-tag time">${esc(p.time)}</span>` : ''}</div></div></li>`; }).join('')}</ol></div>`;
    $('d-close').addEventListener('click', () => { st.selectedSlug = null; renderAll(); });
  }

  function renderAll() {
    const allRows = D.rows.map((r) => E.computeFarmEconomics(r, st.budget)), flt = applyFilters(allRows);
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === st.view));
    document.querySelectorAll('.mini-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-chart') === st.rightChart));
    $('charts-grid').classList.toggle('hidden', st.chartsHidden); $('charts-toggle').classList.toggle('active', !st.chartsHidden);
    renderHeaderAndKpis(allRows, flt); renderMethodologyPanel();
    if (!st.chartsHidden) { renderCurveChart(allRows, flt); renderTopChart(st.view === 'live' ? allRows : flt); }
    renderTable(flt); renderDetailDrawer(allRows);
  }
  const cats = [...new Set([...D.rows, ...D.live].map((r) => r.category).filter(Boolean))].sort(), chains = [...new Set([...D.rows, ...D.live].flatMap((r) => r.chains))].sort();
  for (const [id, list] of [['f-cat', cats], ['f-chain', chains]]) $(id).innerHTML += list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  for (const [id, ev, k, fn] of [['f-search', 'input', 'search', String], ['f-cat', 'change', 'category', String], ['f-chain', 'change', 'chain', String], ['f-verdict', 'change', 'verdict', String], ['f-tvl', 'change', 'minTvl', (v) => Number(v) || 0], ['f-sort', 'change', 'sort', String], ['f-budget', 'change', 'budget', (v) => Number(v) || 1000]]) { $(id).value = String(st[k]); $(id).addEventListener(ev, (e) => { st[k] = fn(e.target.value); renderAll(); }); }
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { st.view = b.getAttribute('data-view'); renderAll(); }));
  document.querySelectorAll('.mini-btn').forEach((b) => b.addEventListener('click', () => { st.rightChart = b.getAttribute('data-chart'); renderAll(); }));
  $('proof-toggle').addEventListener('click', () => { st.proofOpen = !st.proofOpen; renderAll(); });
  $('charts-toggle').addEventListener('click', () => { st.chartsHidden = !st.chartsHidden; renderAll(); });
  $('f-reset').addEventListener('click', () => { Object.assign(st, { view: 'all', search: '', category: '', chain: '', verdict: '', minTvl: 0, sort: 'rank' }); for (const id of ['f-search', 'f-cat', 'f-chain', 'f-verdict']) $(id).value = ''; $('f-tvl').value = '0'; $('f-sort').value = 'rank'; renderAll(); });
  renderAll();
})();
