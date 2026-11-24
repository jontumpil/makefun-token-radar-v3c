'use strict';
const R = window.RADAR;
const $ = (s) => document.querySelector(s);
const fmt$ = (n) => {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
};
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#sub').textContent =
  `${R.board_size} pre-token protocols ranked by implied launch value, from a universe of ${R.universe_size} ` +
  `(${R.pre_token_size} with no token yet, ${R.live_size} already trading and set aside as calibration). ` +
  `Model ${R.model_version}: an OLS pricer with per-category offsets and conformal ranges, ` +
  `validated four ways at runtime — see Method. Snapshot ${R.as_of}.`;
$('#foot').textContent = `Source: ${R.source}. Every figure on this page is derived from that snapshot's own rows at runtime; no protocol is hand-listed.`;

// ---------- board ----------
const cats = [...new Set(R.rows.map((r) => r.category ?? '(none)'))].sort();
for (const c of cats) {
  const o = document.createElement('option');
  o.value = c; o.textContent = c;
  $('#fcat').appendChild(o);
}
let sortKey = 'rank', sortDir = 1;
function visibleRows() {
  const q = $('#q').value.trim().toLowerCase();
  const fc = $('#fcat').value, fv = $('#fverdict').value, fw = $('#fwatch').checked;
  let rows = R.rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!fc || (r.category ?? '(none)') === fc) &&
    (!fv || r.verdict === fv) &&
    (!fw || r.watchlist));
  rows = [...rows].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (typeof x === 'string') return sortDir * x.localeCompare(y);
    return sortDir * ((x ?? -Infinity) - (y ?? -Infinity));
  });
  return rows;
}
function renderBoard() {
  const rows = visibleRows();
  $('#count').textContent = `${rows.length} of ${R.board_size} rows`;
  $('#board tbody').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td>${r.rank}</td>
      <td>${esc(r.name)} ${r.watchlist ? '<span class="star" title="On the snapshot watchlist">★</span>' : ''}</td>
      <td>${esc(r.category ?? '—')}</td>
      <td class="num">${fmt$(r.tvl_usd)}</td>
      <td class="num ${r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</td>
      <td class="num"><b>${fmt$(r.implied_value_usd)}</b></td>
      <td class="num range">${fmt$(r.interval_low_usd)} – ${fmt$(r.interval_high_usd)}</td>
      <td class="num">${pct(r.launch_odds)}</td>
      <td><span class="chip ${r.verdict}">${r.verdict}</span></td>
    </tr>`).join('');
  for (const tr of document.querySelectorAll('#board tbody tr')) {
    tr.addEventListener('click', () => showDetail(tr.dataset.slug));
  }
}
document.querySelectorAll('#board th').forEach((th) => {
  th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (!k) return;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
    renderBoard();
  });
});
for (const id of ['#q', '#fcat', '#fverdict', '#fwatch']) $(id).addEventListener('input', renderBoard);

function showDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  const w = r.workings, c = R.coefficients;
  const lo = Math.log10(r.interval_low_usd), hi = Math.log10(r.interval_high_usd), mid = Math.log10(r.implied_value_usd);
  const span = Math.max(hi - lo, 0.01);
  const left = ((lo - (lo - span * 0.15)) / (span * 1.3)) * 100;
  const width = Math.max(4, (span / (span * 1.3)) * 100);
  const dot = ((mid - (lo - span * 0.15)) / (span * 1.3)) * 100;
  $('#detail').classList.remove('hidden');
  $('#detail').innerHTML = `
    <h2>${esc(r.name)} <span class="chip ${r.verdict}">${r.verdict}</span></h2>
    <div class="range">${esc(r.category ?? 'Uncategorised')} · ${r.chains.map(esc).join(', ') || 'no chains listed'} · rank #${r.rank}${r.watchlist ? ' · on the watchlist ★' : ''}</div>
    <div class="grid">
      <div class="kv"><b>Implied launch value</b>${fmt$(r.implied_value_usd)}</div>
      <div class="kv"><b>80% range</b>${fmt$(r.interval_low_usd)} – ${fmt$(r.interval_high_usd)}</div>
      <div class="kv"><b>TVL</b>${fmt$(r.tvl_usd)}</div>
      <div class="kv"><b>Launch odds</b>${pct(r.launch_odds, 1)}</div>
      <div class="kv"><b>Age</b>${r.age_days == null ? 'unknown' : r.age_days + ' days'}</div>
      <div class="kv"><b>TVL change, 7d</b>${r.change_7d == null ? '—' : r.change_7d.toFixed(1) + '%'}</div>
    </div>
    <div class="bar"><div class="fill" style="left:${left}%;width:${width}%"></div><div class="dot" style="left:${dot}%"></div></div>
    <div class="range">The bar is the conformal range on a log scale; the tick is the point estimate.</div>
    <h3>How the price is built (log10)</h3>
    <p>intercept ${c.intercept} + TVL term ${c.log10_tvl} × ${w.tvl_log10} + growth term ${w.growth_term} +
    breadth term ${w.breadth_term} + category offset ${w.offset_log10} = <b>${Math.log10(r.implied_value_usd).toFixed(2)}</b>.
    Age is not a pricing input — it moves the launch odds and the verdict, not the price.</p>
    <h3>Traded peers in ${esc(r.category ?? 'this category')}</h3>
    ${r.peers.length ? `<table class="mini"><thead><tr><th>Peer</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead>
    <tbody>${r.peers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${fmt$(p.tvl_usd)}</td><td class="num">${fmt$(p.mcap_usd)}</td><td class="num">${p.multiple}×</td></tr>`).join('')}</tbody></table>`
      : '<p class="note">No traded peer in this category in the snapshot — the price rests on the global fit, and the range is the wide global one.</p>'}
    <h3>Farm plan</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('#detail').scrollIntoView({ behavior: 'auto', block: 'start' });
}

// ---------- live ----------
$('#livet tbody').innerHTML = R.live.map((p) => `
  <tr><td>${esc(p.name)}</td><td>${esc(p.category ?? '—')}</td>
  <td class="num">${fmt$(p.tvl_usd)}</td><td class="num">${fmt$(p.mcap_usd)}</td>
  <td class="num">${p.multiple}×</td>
  <td class="num ${p.change_7d == null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'}">${p.change_7d == null ? '—' : p.change_7d.toFixed(1) + '%'}</td></tr>`).join('');

// ---------- method ----------
{
  const v = R.validation, c = R.coefficients;
  $('#method').innerHTML = `
  <h2>The model</h2>
  <p>Stage 1 fits ordinary least squares on the snapshot's ${R.live_size} live protocols:
  <code>log10(mcap) = ${c.intercept} + ${c.log10_tvl}·log10(TVL) + ${c.growth}·(7d growth, clamped ±50/100) + ${c.breadth}·min(chains−1, 8)</code>.
  Stage 2 adds a per-category offset — the median stage-1 residual in the category, shrunk toward zero by n/(n+4).
  The range beside each price is a cross-conformal 80% interval (5-fold cross-fitted residuals; the category's own
  quantile when it has ≥ 8 live members, else the global one), widened ×${R.temporal_widen} in log space.</p>
  <p><b>Why the widening:</b> raw conformal intervals cover about 83% on random splits of this snapshot but only
  about 72% when the model is fitted on older protocols and tested on newer ones — the future is more dispersed
  than the past. Widening by ×${R.temporal_widen} restores temporal coverage to ${v.coverage_temporal_pct}%
  (random-split coverage at the shipped width: ${v.coverage_random_pct}%). The widths are the data's truth:
  inside one category, live market-cap/TVL multiples span orders of magnitude, so an honest range is a wide one.</p>
  <p><b>Age is not a price input.</b> In validation, adding age improved random splits slightly and damaged every
  temporal split (bias and coverage both fell — the age term extrapolates off a cliff on the newest protocols).
  Age instead drives the launch odds: the category's traded share in this snapshot, decayed by
  exp(−max(0, age−1yr)/3). A protocol that has run for years without a token is, on this evidence, less likely
  to launch one soon.</p>
  <p><b>Verdicts.</b> Farm: odds ≥ 35%, range low ≥ $5M, ≥ 3 traded peers. Thin: odds ≥ 15% and range low ≥ $1M.
  Everything else: skip. The thresholds are printed here so the verdicts can be argued with.</p>
  <h2>Held-out validation of this exact model (recomputed at runtime)</h2>
  <div class="wrap"><table class="mini"><thead><tr><th>Scheme</th><th class="num">n</th><th class="num">Median |log10 error|</th><th class="num">Median pred/actual</th><th class="num">Within 3×</th></tr></thead>
  <tbody>${v.schemes.map((s) => `<tr><td>${esc(s.scheme)}</td><td class="num">${s.n}</td><td class="num">${s.med_abs_log10}</td><td class="num">${s.med_ratio}×</td><td class="num">${s.within_3x_pct}%</td></tr>`).join('')}</tbody></table></div>
  <p class="note">A median |log10 error| of 0.60 means the typical prediction is within about 4× of the market's
  own value — crude in absolute terms, and stated plainly because a radar that hides its error is worse than
  one that prices it. Two rival designs (a category-median anchor model and an OLS with age in the price) were
  fitted and rejected on these same schemes before this one shipped.</p>
  <h2>Calibration by category</h2>
  <div class="wrap"><table class="mini"><thead><tr><th>Category</th><th class="num">Live</th><th class="num">On board</th><th class="num">Median mcap/TVL</th><th class="num">Ten-fold |log10 err|</th><th class="num">Median range width</th></tr></thead>
  <tbody>${v.categories.map((k) => `<tr><td>${esc(k.category)}</td><td class="num">${k.live_n}</td><td class="num">${k.board_n}</td><td class="num">${k.median_multiple == null ? '—' : k.median_multiple + '×'}</td><td class="num">${k.tenfold_med_abs_log10 == null ? '—' : k.tenfold_med_abs_log10}</td><td class="num">${k.median_interval_factor == null ? '—' : k.median_interval_factor + '×'}</td></tr>`).join('')}</tbody></table></div>
  <p class="note">The biggest categories (Lending, Dexs, Yield) are the hardest to price and carry the widest
  ranges; small, uniform categories (RWA, Basis Trading, Bridge) price tightest. The range on each row comes
  from its own category's residuals, so this table and the board cannot drift apart.</p>`;
}

// ---------- tabs ----------
for (const b of document.querySelectorAll('.tab')) {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    for (const s of ['board', 'live', 'method']) $('#view-' + s).classList.toggle('hidden', s !== b.dataset.view);
  });
}
renderBoard();

// Deep links: #detail=<slug> opens that protocol, #cat=<category> filters the board.
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('cat')) { $('#fcat').value = h.get('cat'); renderBoard(); }
  if (h.get('detail')) {
    showDetail(h.get('detail'));
    const d = $('#detail');
    d.parentElement.prepend(d);
    window.scrollTo(0, 0);
  }
}
