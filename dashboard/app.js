(() => {
  'use strict';

  const D = window.RADAR;
  if (!D || !Array.isArray(D.rows)) {
    document.body.innerHTML = '<p style="padding:24px;color:#fb7185">Missing window.RADAR dataset from ../data.js</p>';
    return;
  }

  const state = {
    view: 'all',
    search: '',
    category: '',
    chain: '',
    minTvl: 0,
    growth: 'any',
    sort: 'rank',
    selectedSlug: null,
    labOpen: false,
    growthWeight: D.config.growth_weight,
    maturitySpan: D.config.maturity_span,
    chainStep: D.config.chain_step,
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
    const abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '<span class="dim">n/a</span>';
    const cls = v >= 0 ? 'pos' : 'neg';
    const sign = v > 0 ? '+' : '';
    return `<span class="${cls}">${sign}${v.toFixed(1)}%</span>`;
  }

  function recomputeRow(r) {
    const gPct = Math.min(D.config.growth_cap, Math.max(D.config.growth_floor, r.change_7d ?? 0));
    const gMult = 1 + (gPct / 100) * state.growthWeight;
    const age = r.age_days ?? D.config.unknown_age_days;
    const mMult = D.config.maturity_base + (Math.min(Math.max(age, 0), D.config.maturity_days) / D.config.maturity_days) * state.maturitySpan;
    const cMult = 1 + state.chainStep * Math.min(Math.max(r.chains.length - 1, 0), D.config.chain_cap);
    const implied = Math.max(1, Math.round(r.tvl_usd * r.applied_multiple * gMult * mMult * cMult));
    return {
      ...r,
      dyn_implied: implied,
      dyn_gMult: gMult,
      dyn_mMult: mMult,
      dyn_cMult: cMult,
    };
  }

  function computeRows() {
    const computed = D.rows.map(recomputeRow);
    computed.sort((a, b) => b.dyn_implied - a.dyn_implied || b.tvl_usd - a.tvl_usd);
    computed.forEach((r, idx) => { r.dyn_rank = idx + 1; });
    return computed;
  }

  function applyFilters(allRows) {
    if (state.view === 'live') {
      const q = state.search.trim().toLowerCase();
      return D.live.filter((p) => {
        if (state.category && (p.category || '') !== state.category) return false;
        if (state.chain && !p.chains.includes(state.chain)) return false;
        if (state.minTvl > 0 && p.tvl_usd < state.minTvl) return false;
        if (state.growth === 'pos' && !(p.change_7d > 0)) return false;
        if (state.growth === 'surge' && !(p.change_7d >= 5)) return false;
        if (q && !(`${p.name} ${p.slug} ${p.symbol || ''} ${p.chains.join(' ')}`.toLowerCase().includes(q))) return false;
        return true;
      });
    }

    const q = state.search.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (state.view === 'watchlist' && r.cohort !== 'watchlist') return false;
      if (state.view === 'early' && r.cohort !== 'early') return false;
      if (state.category && (r.category || '') !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.growth === 'pos' && !(r.change_7d > 0)) return false;
      if (state.growth === 'surge' && !(r.change_7d >= 5)) return false;
      if (q && !(`${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    });

    const sorters = {
      rank: (a, b) => a.dyn_rank - b.dyn_rank,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999),
      conviction: (a, b) => b.conviction_score - a.conviction_score || b.dyn_implied - a.dyn_implied,
      age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
      efficiency: (a, b) => (b.dyn_implied / Math.max(1, b.est_capital_usd)) - (a.dyn_implied / Math.max(1, a.est_capital_usd)),
    };
    filtered.sort(sorters[state.sort] || sorters.rank);
    return filtered;
  }

  function renderMetaAndCounts() {
    $('model-badge').textContent = D.model_name;
    $('snapshot-meta').textContent =
      `Snapshot ${D.as_of} · ${D.total_protocols} DefiLlama protocols (${D.watchlist_count} Watchlist >= ${fmtUsd(D.floor_usd)} + ${D.early_count} Early Alpha) · ${D.excluded_pretoken_count} wrapped/bridge excluded`;
    $('live-sep-pill').textContent = `${D.live_token_count} LIVE TOKENS SEPARATED`;
    $('cnt-all').textContent = String(D.rows.length);
    $('cnt-wl').textContent = String(D.watchlist_count);
    $('cnt-early').textContent = String(D.early_count);
    $('cnt-live').textContent = String(D.live.length);
  }

  function renderKpis(allRows) {
    const totalImplied = allRows.reduce((s, r) => s + r.dyn_implied, 0);
    const wlImplied = allRows.filter((r) => r.cohort === 'watchlist').reduce((s, r) => s + r.dyn_implied, 0);
    const top = allRows[0];
    const positiveCount = allRows.filter((r) => (r.change_7d ?? 0) > 0).length;

    $('kpi-grid').innerHTML = [
      {
        label: 'Pre-Token Pipeline FDV',
        val: fmtUsd(totalImplied),
        cls: 'amber',
        foot: `Watchlist share: ${Math.round((wlImplied / Math.max(1, totalImplied)) * 100)}%`,
      },
      {
        label: 'Watchlist Coverage',
        val: `${D.watchlist_count} / ${D.watchlist_count}`,
        cls: 'emerald',
        foot: `100% floor (>= ${fmtUsd(D.floor_usd)} TVL)`,
      },
      {
        label: 'Early Alpha Radar',
        val: `${D.early_count} Protocols`,
        cls: 'cyan',
        foot: `${positiveCount} pre-token growing 7d`,
      },
      {
        label: 'Global Comp Multiple',
        val: `${D.global_median_mult.toFixed(3)}x`,
        cls: '',
        foot: `Median MCAP/TVL across ${D.live.length} comps (${D.live_token_count} live excluded)`,
      },
      {
        label: 'Top Ranked Launch',
        val: top ? fmtUsd(top.dyn_implied) : '—',
        cls: 'amber',
        foot: top ? `${esc(top.name)} (${fmtUsd(top.tvl_usd)} TVL)` : '',
      },
    ].map((k) => `
      <div class="kpi-card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val ${k.cls}">${k.val}</div>
        <div class="kpi-foot">${k.foot}</div>
      </div>
    `).join('');
  }

  function renderTopChart(rows) {
    const items = [...rows].sort((a, b) => b.dyn_implied - a.dyn_implied).slice(0, 10);
    if (items.length === 0) {
      $('chart-top').innerHTML = '<div class="panel-note" style="padding:18px 0">No matching protocols for current filter.</div>';
      return;
    }
    const maxVal = Math.max(...items.map((r) => Math.max(r.dyn_implied, r.tvl_usd * 0.25)), 1);
    const rowH = 21;
    const h = items.length * rowH + 10;
    const labelW = 148;
    const barMaxW = 365;
    const svgW = 600;

    const bars = items.map((r, i) => {
      const y = i * rowH + 4;
      const w = Math.max(4, Math.round((r.dyn_implied / maxVal) * barMaxW));
      const color = r.cohort === 'watchlist' ? '#f59e0b' : '#22d3ee';
      const isSel = r.slug === state.selectedSlug;
      return `
        <g class="chart-row" data-slug="${esc(r.slug)}" style="cursor:pointer">
          <rect x="0" y="${y - 2}" width="${svgW}" height="${rowH - 1}" rx="3" fill="${isSel ? 'rgba(245,158,11,0.12)' : 'transparent'}"/>
          <text x="${labelW - 8}" y="${y + 11}" text-anchor="end" fill="#cbd5e1" font-size="10.5" font-family="ui-sans-serif,system-ui,sans-serif">${esc(r.name.slice(0, 20))}</text>
          <rect x="${labelW}" y="${y + 2}" width="${barMaxW}" height="11" rx="2.5" fill="#172233"/>
          <rect x="${labelW}" y="${y + 2}" width="${w}" height="11" rx="2.5" fill="${color}" fill-opacity="0.88"/>
          <text x="${labelW + w + 6}" y="${y + 11}" fill="#e6edf7" font-size="10.5" font-family="ui-monospace,monospace">${fmtUsd(r.dyn_implied)}</text>
        </g>
      `;
    }).join('');

    $('chart-top').innerHTML = `<svg viewBox="0 0 ${svgW} ${h}" role="img" aria-label="Top implied launch valuations">${bars}</svg>`;
    $('chart-top').querySelectorAll('.chart-row').forEach((el) => {
      el.addEventListener('click', () => {
        state.selectedSlug = el.getAttribute('data-slug');
        renderAll();
      });
    });
  }

  function renderCategoryChart(allRows) {
    const counts = new Map();
    for (const r of allRows) {
      const cat = r.category || 'Other';
      const cur = counts.get(cat) || { pre: 0, implied: 0 };
      cur.pre++;
      cur.implied += r.dyn_implied;
      counts.set(cat, cur);
    }

    const items = D.category_comps
      .filter((c) => counts.has(c.category))
      .slice(0, 8);
    const maxMult = Math.max(...items.map((c) => c.applied_multiple), 0.5);
    const rowH = 24;
    const h = Math.max(1, items.length) * rowH + 12;
    const labelW = 148;
    const barMaxW = 240;
    const svgW = 500;

    const bars = items.map((c, i) => {
      const y = i * rowH + 6;
      const w = Math.max(6, Math.round((c.applied_multiple / maxMult) * barMaxW));
      const preInfo = counts.get(c.category);
      return `
        <g>
          <text x="${labelW - 8}" y="${y + 12}" text-anchor="end" fill="#cbd5e1" font-size="10.5" font-family="ui-sans-serif,system-ui,sans-serif">${esc(c.category.slice(0, 20))}</text>
          <rect x="${labelW}" y="${y + 2}" width="${barMaxW}" height="12" rx="3" fill="#172233"/>
          <rect x="${labelW}" y="${y + 2}" width="${w}" height="12" rx="3" fill="#34d399" fill-opacity="0.82"/>
          <text x="${labelW + w + 6}" y="${y + 12}" fill="#34d399" font-size="10.5" font-family="ui-monospace,monospace">${c.applied_multiple.toFixed(2)}x</text>
          <text x="${svgW - 4}" y="${y + 12}" text-anchor="end" fill="#8b9bb4" font-size="10" font-family="ui-monospace,monospace">${preInfo.pre} pre · n=${c.sample_count}</text>
        </g>
      `;
    }).join('');

    $('chart-cats').innerHTML = `<svg viewBox="0 0 ${svgW} ${h}" role="img" aria-label="Empirical category multiples">${bars}</svg>`;
  }

  function renderTable(filtered) {
    const head = $('table-head');
    const body = $('table-body');

    if (state.view === 'live') {
      $('filter-summary').textContent = `${filtered.length} live comparables`;
      head.innerHTML = `
        <tr>
          <th>#</th>
          <th>Protocol (Live Token)</th>
          <th>Category</th>
          <th class="num">TVL</th>
          <th class="num">Market Cap</th>
          <th class="num">MCAP / TVL</th>
          <th class="num">7d &Delta;</th>
        </tr>
      `;
      body.innerHTML = filtered.map((p, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>
            <div class="proto-name">${esc(p.name)} <span class="badge badge-live">${esc(p.symbol || 'LIVE')}</span></div>
            <div class="proto-meta">${esc(p.chains.slice(0, 4).join(', ') || 'Multi-chain')}</div>
          </td>
          <td><span class="cat-pill">${esc(p.category || 'Other')}</span></td>
          <td class="num">${fmtUsd(p.tvl_usd)}</td>
          <td class="num implied-val">${fmtUsd(p.mcap_usd)}</td>
          <td class="num">${p.mcap_tvl_ratio.toFixed(2)}x</td>
          <td class="num">${fmtPct(p.change_7d)}</td>
        </tr>
      `).join('');
      return;
    }

    $('filter-summary').textContent = `${filtered.length} of ${D.rows.length} pre-token shown`;
    const sortCls = (key, base) => `${base} sortable${state.sort === key ? ' sort-active' : ''}`;
    head.innerHTML = `
      <tr>
        <th class="${sortCls('rank', 'num')}" data-sort="rank">Rank</th>
        <th>Protocol</th>
        <th>Category &amp; Mult</th>
        <th class="${sortCls('tvl', 'num')}" data-sort="tvl">TVL</th>
        <th class="${sortCls('growth', 'num')}" data-sort="growth">7d &Delta;</th>
        <th class="${sortCls('age', 'num col-age')}" data-sort="age">Age</th>
        <th class="${sortCls('conviction', '')}" data-sort="conviction">Conviction</th>
        <th class="${sortCls('rank', 'num')}" data-sort="rank">Implied FDV</th>
        <th class="num col-budget">Farm Budget</th>
      </tr>
    `;
    head.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        state.sort = th.getAttribute('data-sort') || 'rank';
        renderAll();
      });
    });

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#8b9bb4">No protocols match the current filters.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map((r) => {
      const sel = r.slug === state.selectedSlug ? 'selected' : '';
      const badge = r.cohort === 'watchlist'
        ? '<span class="badge badge-wl">WATCHLIST</span>'
        : '<span class="badge badge-early">EARLY</span>';
      const chainsTxt = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : '');
      return `
        <tr class="${sel}" data-slug="${esc(r.slug)}">
          <td class="num">#${r.dyn_rank}</td>
          <td>
            <div class="proto-name">${esc(r.name)} ${badge}</div>
            <div class="proto-meta">${esc(chainsTxt || 'n/a')}</div>
          </td>
          <td>
            <span class="cat-pill">${esc(r.category || 'Other')}</span>
            <div class="mult-sub">${r.applied_multiple.toFixed(2)}x comp</div>
          </td>
          <td class="num">${fmtUsd(r.tvl_usd)}</td>
          <td class="num">${fmtPct(r.change_7d)}</td>
          <td class="num col-age">${r.age_days !== null ? `${r.age_days}d` : 'n/a'}</td>
          <td>
            <span class="conv-bar"><span class="conv-fill" style="width:${r.conviction_score}%"></span></span>
            <span style="font-family:var(--mono);font-size:11px">${r.conviction_score}</span>
          </td>
          <td class="num implied-val">${fmtUsd(r.dyn_implied)}</td>
          <td class="num col-budget">
            <div>$${r.est_capital_usd} + $${r.est_gas_usd.toFixed(1)} gas</div>
            <div class="proto-meta">${r.hold_days}d hold</div>
          </td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('tr[data-slug]').forEach((tr) => {
      tr.addEventListener('click', () => {
        state.selectedSlug = tr.getAttribute('data-slug');
        renderAll();
      });
    });
  }

  function parseStepParts(raw) {
    const m = raw.match(/^(.*)\s+Cost:\s*(.*?)\.\s+Time:\s*(.*?)\.?$/);
    if (!m) return { action: raw, cost: '', time: '' };
    return { action: m[1], cost: m[2], time: m[3] };
  }

  function renderPeerSvg(row) {
    const sectorPeers = D.live.filter((p) => p.category === row.category).slice(0, 3);
    const peers = sectorPeers.length >= 2
      ? sectorPeers
      : [
          ...sectorPeers,
          ...[...D.live]
            .filter((p) => p.category !== row.category)
            .sort((a, b) => Math.abs(a.tvl_usd - row.tvl_usd) - Math.abs(b.tvl_usd - row.tvl_usd))
            .slice(0, 3 - sectorPeers.length),
        ];
    const items = [
      { label: `${row.name.slice(0, 14)} (Est.)`, val: row.dyn_implied, color: '#f59e0b' },
      ...peers.map((p) => ({ label: `${p.name.slice(0, 14)} (${p.symbol || 'LIVE'})`, val: p.mcap_usd, color: '#34d399' })),
    ];
    const maxV = Math.max(...items.map((x) => x.val), 1);
    const h = items.length * 22 + 8;
    const rows = items.map((x, i) => {
      const y = i * 22 + 4;
      const w = Math.max(4, Math.round((x.val / maxV) * 195));
      return `
        <text x="132" y="${y + 11}" text-anchor="end" fill="#cbd5e1" font-size="10" font-family="ui-sans-serif,system-ui,sans-serif">${esc(x.label)}</text>
        <rect x="138" y="${y + 2}" width="195" height="11" rx="2.5" fill="#101722"/>
        <rect x="138" y="${y + 2}" width="${w}" height="11" rx="2.5" fill="${x.color}" fill-opacity="0.88"/>
        <text x="${138 + w + 5}" y="${y + 11}" fill="#e6edf7" font-size="10" font-family="ui-monospace,monospace">${fmtUsd(x.val)}</text>
      `;
    }).join('');
    return `<svg viewBox="0 0 400 ${h}" role="img" aria-label="Category peer market cap comparison">${rows}</svg>`;
  }

  function renderDetailDrawer(allRows) {
    const ws = $('workspace');
    const drawer = $('detail-drawer');
    const row = state.selectedSlug && state.view !== 'live'
      ? allRows.find((r) => r.slug === state.selectedSlug)
      : null;

    if (!row) {
      document.querySelector('.shell')?.classList.remove('has-detail');
      ws.classList.remove('has-detail');
      drawer.classList.add('hidden');
      drawer.innerHTML = '';
      return;
    }

    document.querySelector('.shell')?.classList.add('has-detail');
    ws.classList.add('has-detail');
    drawer.classList.remove('hidden');

    const badge = row.cohort === 'watchlist'
      ? '<span class="badge badge-wl">WATCHLIST</span>'
      : '<span class="badge badge-early">EARLY ALPHA</span>';
    const effRatio = Math.round(row.dyn_implied / Math.max(1, row.est_capital_usd + row.est_gas_usd));

    const stepsHtml = row.farm_steps.map((s, idx) => {
      const parts = parseStepParts(s);
      return `
        <li class="step-item">
          <span class="step-num">${idx + 1}</span>
          <div>
            <div>${esc(parts.action)}</div>
            <div class="step-tags">
              ${parts.cost ? `<span class="tag-cost">Cost: ${esc(parts.cost)}</span>` : ''}
              ${parts.time ? `<span class="tag-time">Time: ${esc(parts.time)}</span>` : ''}
            </div>
          </div>
        </li>
      `;
    }).join('');

    drawer.innerHTML = `
      <div class="detail-head">
        <div>
          <h2 class="detail-title">${esc(row.name)} ${badge}</h2>
          <div class="detail-sub">
            Rank #${row.dyn_rank} &middot; ${esc(row.category || 'Uncategorized')} &middot; Listed ${esc(row.listed_at || 'unknown')} (${row.age_days !== null ? row.age_days + 'd' : 'n/a'})
          </div>
          <div class="detail-sub">Chains: ${esc(row.chains.join(', ') || 'n/a')}</div>
        </div>
        <button class="close-btn" id="detail-close" type="button">Close</button>
      </div>

      <div class="formula-box">
        <div class="formula-title">Valuation Decomposition (Snapshot Observables Only)</div>
        <div class="formula-grid">
          <div class="f-cell"><div class="f-lbl">Snapshot TVL</div><div class="f-num">${fmtUsd(row.tvl_usd)}</div></div>
          <div class="f-cell"><div class="f-lbl">Cat. Multiple</div><div class="f-num">${row.applied_multiple.toFixed(3)}x</div></div>
          <div class="f-cell"><div class="f-lbl">7d Momentum</div><div class="f-num">${row.dyn_gMult.toFixed(2)}x</div></div>
          <div class="f-cell"><div class="f-lbl">Maturity Mult</div><div class="f-num">${row.dyn_mMult.toFixed(2)}x</div></div>
          <div class="f-cell"><div class="f-lbl">Chain Breadth</div><div class="f-num">${row.dyn_cMult.toFixed(2)}x</div></div>
          <div class="f-cell"><div class="f-lbl">Implied FDV</div><div class="f-num implied-val">${fmtUsd(row.dyn_implied)}</div></div>
        </div>
      </div>

      <div class="peer-box">
        <div class="formula-title">Implied FDV vs Live ${esc(row.category || 'Sector')} Comps</div>
        ${renderPeerSvg(row)}
      </div>

      <div>
        <div class="farm-head">
          <h3>Execution &amp; Farming Plan</h3>
          <span class="farm-budget">$${row.est_capital_usd} cap &middot; ~$${row.est_gas_usd.toFixed(2)} gas &middot; ${row.hold_days}d &middot; ${fmtUsd(effRatio)}/$1</span>
        </div>
        <ol class="step-list" style="margin-top:6px">${stepsHtml}</ol>
      </div>
    `;

    $('detail-close').addEventListener('click', () => {
      state.selectedSlug = null;
      renderAll();
    });
  }

  function populateSelectors() {
    const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
    const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
    const catSel = $('f-cat');
    const chainSel = $('f-chain');
    cats.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      catSel.appendChild(opt);
    });
    chains.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      chainSel.appendChild(opt);
    });
  }

  function applyQueryParams() {
    const p = new URLSearchParams(window.location.search);
    if (p.has('view')) state.view = p.get('view') || 'all';
    if (p.has('category')) state.category = p.get('category') || '';
    if (p.has('chain')) state.chain = p.get('chain') || '';
    if (p.has('minTvl')) state.minTvl = Number(p.get('minTvl')) || 0;
    if (p.has('growth')) state.growth = p.get('growth') || 'any';
    if (p.has('sort')) state.sort = p.get('sort') || 'rank';
    if (p.has('search')) state.search = p.get('search') || '';
    if (p.has('select')) state.selectedSlug = p.get('select');
    if (p.get('lab') === '1') state.labOpen = true;
  }

  function syncUiInputs() {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
    $('f-search').value = state.search;
    $('f-cat').value = state.category;
    $('f-chain').value = state.chain;
    $('f-tvl').value = String(state.minTvl);
    $('f-growth').value = state.growth;
    $('f-sort').value = state.sort;
    $('lab-toggle').classList.toggle('active', state.labOpen);
    $('lab-drawer').classList.toggle('hidden', !state.labOpen);
    $('sl-growth').value = String(state.growthWeight);
    $('sl-maturity').value = String(state.maturitySpan);
    $('sl-chain').value = String(state.chainStep);
    $('val-growth').textContent = state.growthWeight.toFixed(2) + 'x';
    $('val-maturity').textContent = state.maturitySpan.toFixed(2) + 'x';
    $('val-chain').textContent = state.chainStep.toFixed(2) + 'x';
  }

  function bindEvents() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.view = btn.getAttribute('data-view') || 'all';
        renderAll();
      });
    });

    $('f-search').addEventListener('input', (e) => { state.search = e.target.value; renderAll(); });
    $('f-cat').addEventListener('change', (e) => { state.category = e.target.value; renderAll(); });
    $('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderAll(); });
    $('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value) || 0; renderAll(); });
    $('f-growth').addEventListener('change', (e) => { state.growth = e.target.value; renderAll(); });
    $('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderAll(); });

    $('f-reset').addEventListener('click', () => {
      state.view = 'all';
      state.search = '';
      state.category = '';
      state.chain = '';
      state.minTvl = 0;
      state.growth = 'any';
      state.sort = 'rank';
      renderAll();
    });

    $('lab-toggle').addEventListener('click', () => {
      state.labOpen = !state.labOpen;
      renderAll();
    });
    $('sl-growth').addEventListener('input', (e) => { state.growthWeight = Number(e.target.value); renderAll(); });
    $('sl-maturity').addEventListener('input', (e) => { state.maturitySpan = Number(e.target.value); renderAll(); });
    $('sl-chain').addEventListener('input', (e) => { state.chainStep = Number(e.target.value); renderAll(); });
    $('lab-reset').addEventListener('click', () => {
      state.growthWeight = D.config.growth_weight;
      state.maturitySpan = D.config.maturity_span;
      state.chainStep = D.config.chain_step;
      renderAll();
    });
  }

  function renderAll() {
    syncUiInputs();
    const allRows = computeRows();
    const filtered = applyFilters(allRows);
    renderKpis(allRows);
    renderTopChart(state.view === 'live' ? allRows : filtered);
    renderCategoryChart(allRows);
    renderTable(filtered);
    renderDetailDrawer(allRows);
  }

  renderMetaAndCounts();
  populateSelectors();
  applyQueryParams();
  bindEvents();
  renderAll();
})();
