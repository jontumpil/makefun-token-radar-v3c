// Token Radar — the v3c model.
//
// One snapshot of the protocol universe in, one ranked board out. The board
// ranks pre-token protocols by the market value the model expects their token
// to have at launch, with an honest uncertainty range, a launch-odds estimate
// and a costed farm plan for every row.
//
// The pricer (v3c, chosen by a four-way held-out validation over two rival
// designs; the numbers are recomputed at runtime and printed on the Method
// view):
//
//   stage 1  OLS on the snapshot's live protocols (token trading, mcap > 0):
//            log10(mcap) ~ 1 + log10(TVL) + clamp(change_7d,-50,100)/100
//                          + min(chains-1, 8), ridge 1e-6.
//   stage 2  a per-category offset: the median stage-1 residual in the
//            category, shrunk toward zero by n/(n+4).
//   range    a cross-conformal interval: 5-fold cross-fitted |log10
//            residuals|, the category's own 80% quantile when it has >= 8
//            live members, else the global one, widened x1.25 in log space
//            (the widening that restores ~80% coverage on older->newer
//            temporal folds, where raw conformal undercovers).
//
// Age is NOT a pricing input: adding it improved random splits slightly and
// damaged every temporal split (bias and coverage both fell). Age drives the
// launch odds and the verdicts instead:
//
//   odds     the category's traded share in this snapshot (live protocols /
//            all protocols in the category), decayed by
//            exp(-max(0, age_years - 1)/3) — the longer a protocol has gone
//            without a token, the less a launch is the base case. A missing
//            listed_at is imputed with the live set's median age.
//   verdict  farm / thin / skip from the interval's low end, the odds and
//            the number of traded peers in the category (see VERDICTS).
//
// No protocol name is ever special-cased: every figure derives from the
// snapshot's own rows at runtime.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'v3c-hybrid';

/** Log-space widening applied to the conformal quantile (derived, see header). */
export const TEMPORAL_WIDEN = 1.25;

/** Verdict thresholds, stated so the page can print them next to the verdicts. */
export const VERDICTS = {
  farm: { min_odds: 0.35, min_interval_low: 5_000_000, min_peers: 3 },
  thin: { min_odds: 0.15, min_interval_low: 1_000_000 },
};

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    pred_log10: number;
    category_offset_log10: number;
    interval_low_usd: number;
    interval_high_usd: number;
    launch_odds: number;
    verdict: 'farm' | 'thin' | 'skip';
  };
  farm_steps: string[];
}

/** A traded peer shown beside a candidate: the market's own anchor for its category. */
export interface PeerAnchor {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** The dashboard's rich row: board figures plus workings, peers and the plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  interval_low_usd: number;
  interval_high_usd: number;
  launch_odds: number;
  verdict: 'farm' | 'thin' | 'skip';
  watchlist: boolean;
  workings: { tvl_log10: number; growth_term: number; breadth_term: number; offset_log10: number };
  peers: PeerAnchor[];
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

/** One held-out scheme's result for the shipped model, recomputed at runtime. */
export interface SchemeResult {
  scheme: string;
  n: number;
  med_abs_log10: number;
  med_ratio: number;
  within_3x_pct: number;
}

/** Per-category calibration figures for the Method view. */
export interface CategoryCal {
  category: string;
  live_n: number;
  board_n: number;
  median_multiple: number | null;
  tenfold_med_abs_log10: number | null;
  median_interval_factor: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  temporal_widen: number;
  universe_size: number;
  pre_token_size: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  coefficients: { intercept: number; log10_tvl: number; growth: number; breadth: number };
  validation: {
    schemes: SchemeResult[];
    coverage_random_pct: number;
    coverage_temporal_pct: number;
    categories: CategoryCal[];
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** FNV-1a over the slug: the deterministic fold assignment every scheme uses. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Whole days from listed_at to the snapshot date; null when either is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const growthOf = (p: SnapshotProtocol): number => clamp(p.change_7d ?? 0, -50, 100);
const catOf = (p: SnapshotProtocol): string => p.category ?? '(none)';

/** Solve A x = b by Gauss-Jordan elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!; M[c] = M[piv]!; M[piv] = tmp;
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / (r[i]! || 1e-12));
}

/** Ordinary least squares through the normal equations, with a small ridge. */
function ols(X: number[][], y: number[], ridge = 1e-6): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  X.forEach((x, i) => {
    for (let a = 0; a < k; a++) {
      b[a] = b[a]! + x[a]! * y[i]!;
      for (let c = 0; c < k; c++) A[a]![c] = A[a]![c]! + x[a]! * x[c]!;
    }
  });
  for (let i = 0; i < k; i++) A[i]![i] = A[i]![i]! + ridge;
  return solve(A, b);
}

/** A fitted v3c pricer: OLS weights, shrunk category offsets, median live age. */
export interface V3cFit {
  w: number[];
  off: Map<string, number>;
  medAgeDays: number;
}

const features = (p: SnapshotProtocol): number[] => [
  1,
  Math.log10(p.tvl_usd),
  growthOf(p) / 100,
  Math.min(p.chains.length - 1, 8),
];

/** Fit stage 1 + stage 2 on a set of live (already trading) protocols. */
export function fitV3c(train: SnapshotProtocol[], asOf: string): V3cFit {
  const X = train.map(features);
  const y = train.map((p) => Math.log10(p.mcap_usd!));
  const w = ols(X, y);
  const resid = train.map((p, i) => y[i]! - X[i]!.reduce((s, v, j) => s + v * w[j]!, 0));
  const byCat = new Map<string, number[]>();
  train.forEach((p, i) => {
    const c = catOf(p);
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(resid[i]!);
  });
  const off = new Map<string, number>();
  for (const [c, rs] of byCat) off.set(c, median(rs) * (rs.length / (rs.length + 4)));
  const knownAges = train.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  return { w, off, medAgeDays: knownAges.length ? median(knownAges) : 365 };
}

/** The model's log10 market-cap prediction for one protocol, and its parts. */
export function predictLog10(fit: V3cFit, p: SnapshotProtocol): { log10pred: number; growthTerm: number; breadthTerm: number; offset: number } {
  const x = features(p);
  const offset = fit.off.get(catOf(p)) ?? 0;
  const growthTerm = x[2]! * fit.w[2]!;
  const breadthTerm = x[3]! * fit.w[3]!;
  const log10pred = x.reduce((s, v, j) => s + v * fit.w[j]!, 0) + offset;
  return { log10pred, growthTerm, breadthTerm, offset };
}

/** Cross-conformal 80% quantiles of |log10 residual|, per category and global. */
export function conformalQuantiles(train: SnapshotProtocol[], asOf: string): { global: number; perCat: Map<string, number> } {
  const resByCat = new Map<string, number[]>();
  const all: number[] = [];
  for (let f = 0; f < 5; f++) {
    const tr = train.filter((p) => fnv1a(p.slug) % 5 !== f);
    const te = train.filter((p) => fnv1a(p.slug) % 5 === f);
    if (te.length === 0) continue;
    const fit = fitV3c(tr, asOf);
    for (const p of te) {
      const r = Math.abs(predictLog10(fit, p).log10pred - Math.log10(p.mcap_usd!));
      all.push(r);
      const c = catOf(p);
      if (!resByCat.has(c)) resByCat.set(c, []);
      resByCat.get(c)!.push(r);
    }
  }
  const q = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.max(0, Math.min(s.length - 1, Math.ceil((s.length + 1) * 0.8) - 1))]!;
  };
  const perCat = new Map<string, number>();
  for (const [c, rs] of resByCat) if (rs.length >= 8) perCat.set(c, q(rs));
  return { global: q(all), perCat };
}

/** Held-out scoring of the shipped model over a set of train/test folds. */
function scoreFolds(folds: { train: SnapshotProtocol[]; test: SnapshotProtocol[] }[], asOf: string): { preds: { p: SnapshotProtocol; pred: number }[] } {
  const preds: { p: SnapshotProtocol; pred: number }[] = [];
  for (const { train, test } of folds) {
    const fit = fitV3c(train, asOf);
    for (const p of test) preds.push({ p, pred: Math.pow(10, predictLog10(fit, p).log10pred) });
  }
  return { preds };
}

function schemeResult(scheme: string, preds: { p: SnapshotProtocol; pred: number }[]): SchemeResult {
  const ratios = preds.map((x) => x.pred / x.p.mcap_usd!);
  const abslog = preds.map((x) => Math.abs(Math.log10(x.pred) - Math.log10(x.p.mcap_usd!)));
  const within3 = preds.filter((x) => { const r = x.pred / x.p.mcap_usd!; return r >= 1 / 3 && r <= 3; }).length;
  return {
    scheme,
    n: preds.length,
    med_abs_log10: round4(median(abslog)),
    med_ratio: round4(median(ratios)),
    within_3x_pct: round4((within3 / Math.max(1, preds.length)) * 100),
  };
}

/** The runtime validation block: four held-out schemes plus the coverage pair. */
export function runValidation(live: SnapshotProtocol[], asOf: string): RadarData['validation'] {
  const dated = live
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = (arr: SnapshotProtocol[], f: number): number => Math.floor(arr.length * f);
  const schemes: SchemeResult[] = [
    schemeResult('Leave-one-out', scoreFolds(live.map((p) => ({ train: live.filter((q) => q !== p), test: [p] })), asOf).preds),
    schemeResult('Ten-fold (hash folds)', scoreFolds(Array.from({ length: 10 }, (_, f) => ({
      train: live.filter((p) => fnv1a(p.slug) % 10 !== f),
      test: live.filter((p) => fnv1a(p.slug) % 10 === f),
    })), asOf).preds),
    schemeResult('Walk-forward 60→80→100%', scoreFolds([
      { train: dated.slice(0, cut(dated, 0.6)), test: dated.slice(cut(dated, 0.6), cut(dated, 0.8)) },
      { train: dated.slice(0, cut(dated, 0.8)), test: dated.slice(cut(dated, 0.8)) },
    ], asOf).preds),
    schemeResult('Older→newer 50/50', scoreFolds([{ train: dated.slice(0, cut(dated, 0.5)), test: dated.slice(cut(dated, 0.5)) }], asOf).preds),
    schemeResult('Older→newer 60/40', scoreFolds([{ train: dated.slice(0, cut(dated, 0.6)), test: dated.slice(cut(dated, 0.6)) }], asOf).preds),
    schemeResult('Older→newer 70/30', scoreFolds([{ train: dated.slice(0, cut(dated, 0.7)), test: dated.slice(cut(dated, 0.7)) }], asOf).preds),
  ];
  // Coverage pair at the shipped widening: random 5-fold and temporal folds.
  const coverage = (folds: { train: SnapshotProtocol[]; test: SnapshotProtocol[] }[]): number => {
    let covered = 0;
    let n = 0;
    for (const { train, test } of folds) {
      const fit = fitV3c(train, asOf);
      const cq = conformalQuantiles(train, asOf);
      for (const p of test) {
        const pred = Math.pow(10, predictLog10(fit, p).log10pred);
        const q = (cq.perCat.get(catOf(p)) ?? cq.global) * TEMPORAL_WIDEN;
        if (p.mcap_usd! >= pred / Math.pow(10, q) && p.mcap_usd! <= pred * Math.pow(10, q)) covered++;
        n++;
      }
    }
    return round4((covered / Math.max(1, n)) * 100);
  };
  const coverageRandom = coverage(Array.from({ length: 5 }, (_, f) => ({
    train: live.filter((p) => fnv1a(p.slug) % 5 !== f),
    test: live.filter((p) => fnv1a(p.slug) % 5 === f),
  })));
  const coverageTemporal = coverage([0.5, 0.6, 0.7].map((f) => ({
    train: dated.slice(0, cut(dated, f)),
    test: dated.slice(cut(dated, f)),
  })));
  return { schemes, coverage_random_pct: coverageRandom, coverage_temporal_pct: coverageTemporal, categories: [] };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * A genuine pre-token candidate: no token yet, and not a product of another
 * protocol (a bridge, a staking wrapper, a versioned pool, an exchange's own
 * listing). Mirrors the watchlist's own construction, without its TVL floor.
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_WORD.test(p.name) &&
    !EXCHANGE_LEAD.test(p.name)
  );
}

/** Launch odds: the category's traded share, decayed by time without a token. */
export function launchOdds(p: SnapshotProtocol, share: number, medAgeDays: number, asOf: string): number {
  const age = ageDays(asOf, p.listed_at) ?? medAgeDays;
  const years = age / 365.25;
  return round4(share * Math.exp(-Math.max(0, years - 1) / 3));
}

function verdictFor(odds: number, intervalLow: number, peers: number): 'farm' | 'thin' | 'skip' {
  if (odds >= VERDICTS.farm.min_odds && intervalLow >= VERDICTS.farm.min_interval_low && peers >= VERDICTS.farm.min_peers) return 'farm';
  if (odds >= VERDICTS.thin.min_odds && intervalLow >= VERDICTS.thin.min_interval_low) return 'thin';
  return 'skip';
}

/** Up to three traded peers in the same category, nearest in TVL. */
function peerAnchors(p: SnapshotProtocol, liveByCat: Map<string, SnapshotProtocol[]>): PeerAnchor[] {
  const peers = liveByCat.get(catOf(p)) ?? [];
  return [...peers]
    .sort((a, b) => Math.abs(Math.log10(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log10(b.tvl_usd / p.tvl_usd)) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 3)
    .map((q) => ({ name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd!, multiple: round4(q.mcap_usd! / q.tvl_usd) }));
}

/** Gas class of a chain: L1 Ethereum money, or cheap everywhere else. */
function gasUsd(chain: string): number {
  return chain === 'Ethereum' ? 8 : 0.6;
}

/** The category archetype: the core farming action and its minimum viable position. */
function archetype(p: SnapshotProtocol): { action: string; minPosition: number } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return { action: `supply USDC as collateral to ${n} and leave the position open`, minPosition: 100 };
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return { action: `provide USDC liquidity to ${n}'s main market and trade small size weekly`, minPosition: 200 };
  if (c.includes('yield') || c.includes('leveraged')) return { action: `deposit USDC into ${n}'s main vault and keep the shares`, minPosition: 150 };
  if (c.includes('bridge')) return { action: `bridge USDC through ${n} and use the received funds on the far side`, minPosition: 100 };
  if (c.includes('staking') || c.includes('restak')) return { action: `stake the chain's asset through ${n} and hold the receipt token`, minPosition: 100 };
  if (c.includes('prediction')) return { action: `fund a small account on ${n} and take one position a week`, minPosition: 50 };
  if (c.includes('rwa')) return { action: `mint ${n}'s yield asset with USDC and hold it`, minPosition: 250 };
  if (c.includes('insurance')) return { action: `underwrite or buy cover on ${n} with a small USDC position`, minPosition: 100 };
  if (c.includes('stable')) return { action: `mint or deposit the stable asset through ${n} and hold it`, minPosition: 100 };
  return { action: `deposit USDC into ${n} and keep the position open`, minPosition: 100 };
}

/**
 * A costed farm plan for one candidate: 6 steps, each an action with its
 * dollar cost and its duration, sized to the archetype's minimum viable
 * position and costed at 0.2% of position per week of capital cost.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasUsd(chain);
  const { action, minPosition } = archetype(p);
  const weeks = age === null ? 6 : age < 180 ? 8 : age < 730 ? 6 : 4;
  const weeklyCost = Math.max(0.1, minPosition * 0.002);
  const totalCost = 2 * gas + gas * weeks + weeklyCost * weeks;
  const steps = [
    `Open a fresh wallet for this farm and fund it with $${minPosition} of USDC plus about $${(2 * gas).toFixed(2)} of gas money on ${chain}. Cost: $${minPosition} capital, 10 minutes.`,
    `On ${chain}, ${action}. Cost: about $${gas.toFixed(2)} of gas, 15 minutes to set up.`,
    `Repeat one small qualifying action every week (a deposit, a swap, a borrow or a vote) so the wallet reads as a real user, not a one-off. Cost: about $${gas.toFixed(2)} of gas a week, 10 minutes a week.`,
    `Hold the position for ${weeks} weeks; the capital cost of waiting is about $${weeklyCost.toFixed(2)} a week at 0.2%, so $${(weeklyCost * weeks).toFixed(2)} over the hold. Cost: the $${minPosition} stays in the position, ${weeks} weeks.`,
    `Check the protocol's own points or rewards page from its official link before claiming anything, and never pay a fee to claim. Cost: $0 to check, 10 minutes.`,
    `Log the wallet, the dates and every transaction hash; expected all-in cost of this plan is about $${totalCost.toFixed(2)} plus the $${minPosition} position, which stays yours. Cost: $0, 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The ranked board plus everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const live = snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
  const fit = fitV3c(live, snapshot.as_of);
  const cq = conformalQuantiles(live, snapshot.as_of);

  const liveByCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const c = catOf(p);
    if (!liveByCat.has(c)) liveByCat.set(c, []);
    liveByCat.get(c)!.push(p);
  }
  const countByCat = new Map<string, { live: number; pre: number }>();
  for (const p of snapshot.protocols) {
    const c = catOf(p);
    if (!countByCat.has(c)) countByCat.set(c, { live: 0, pre: 0 });
    const e = countByCat.get(c)!;
    if ((p.mcap_usd ?? 0) > 0) e.live++;
    else if (isPreToken(p)) e.pre++;
  }

  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isCandidate(p)) chosen.set(p.slug, p);
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { log10pred, growthTerm, breadthTerm, offset } = predictLog10(fit, p);
    const implied = Math.max(1, Math.round(Math.pow(10, log10pred)));
    const q = (cq.perCat.get(catOf(p)) ?? cq.global) * TEMPORAL_WIDEN;
    const lo = Math.max(1, Math.floor(implied / Math.pow(10, q)));
    const hi = Math.round(implied * Math.pow(10, q));
    const counts = countByCat.get(catOf(p)) ?? { live: 0, pre: 0 };
    const share = counts.live + counts.pre > 0 ? counts.live / (counts.live + counts.pre) : 0;
    const odds = launchOdds(p, share, fit.medAgeDays, snapshot.as_of);
    const peers = peerAnchors(p, liveByCat);
    const verdict = verdictFor(odds, lo, (liveByCat.get(catOf(p)) ?? []).length);
    const age = ageDays(snapshot.as_of, p.listed_at);
    return { p, implied, lo, hi, odds, verdict, peers, age, log10pred, growthTerm, breadthTerm, offset };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      pred_log10: round4(s.log10pred),
      category_offset_log10: round4(s.offset),
      interval_low_usd: s.lo,
      interval_high_usd: s.hi,
      launch_odds: s.odds,
      verdict: s.verdict,
    },
    farm_steps: farmPlan(s.p, s.age),
  }));

  const validation = runValidation(live, snapshot.as_of);
  // Per-category calibration rows for the Method view.
  const tenfoldErr = new Map<string, number>();
  {
    const byCatPreds = new Map<string, number[]>();
    for (let f = 0; f < 10; f++) {
      const train = live.filter((p) => fnv1a(p.slug) % 10 !== f);
      const test = live.filter((p) => fnv1a(p.slug) % 10 === f);
      const tf = fitV3c(train, snapshot.as_of);
      for (const p of test) {
        const c = catOf(p);
        if (!byCatPreds.has(c)) byCatPreds.set(c, []);
        byCatPreds.get(c)!.push(Math.abs(predictLog10(tf, p).log10pred - Math.log10(p.mcap_usd!)));
      }
    }
    for (const [c, errs] of byCatPreds) if (errs.length >= 4) tenfoldErr.set(c, round4(median(errs)));
  }
  const boardCountByCat = new Map<string, number>();
  for (const r of board) {
    const c = r.category ?? '(none)';
    boardCountByCat.set(c, (boardCountByCat.get(c) ?? 0) + 1);
  }
  const categories: CategoryCal[] = [...liveByCat.entries()]
    .map(([c, members]) => {
      const qs = members.map((p) => (cq.perCat.get(c) ?? cq.global) * TEMPORAL_WIDEN);
      return {
        category: c,
        live_n: members.length,
        board_n: boardCountByCat.get(c) ?? 0,
        median_multiple: round4(median(members.map((p) => p.mcap_usd! / p.tvl_usd))),
        tenfold_med_abs_log10: tenfoldErr.get(c) ?? null,
        median_interval_factor: round4(median(qs.map((q) => Math.pow(10, 2 * q)))),
      };
    })
    .sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  validation.categories = categories;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    temporal_widen: TEMPORAL_WIDEN,
    universe_size: snapshot.protocols.length,
    pre_token_size: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    coefficients: {
      intercept: round4(fit.w[0]!),
      log10_tvl: round4(fit.w[1]!),
      growth: round4(fit.w[2]!),
      breadth: round4(fit.w[3]!),
    },
    validation,
    rows: scored.map((s, i) => ({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      implied_value_usd: s.implied,
      interval_low_usd: s.lo,
      interval_high_usd: s.hi,
      launch_odds: s.odds,
      verdict: s.verdict,
      watchlist: watch.has(s.p.slug),
      workings: {
        tvl_log10: round4(Math.log10(s.p.tvl_usd)),
        growth_term: round4(s.growthTerm),
        breadth_term: round4(s.breadthTerm),
        offset_log10: round4(s.offset),
      },
      peers: s.peers,
      farm_steps: board[i]!.farm_steps,
    })),
    live: live
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        change_7d: p.change_7d,
        multiple: round4(p.mcap_usd! / p.tvl_usd),
      }))
      .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1)),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value: not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.model.interval_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.model.interval_high_usd)) return `${r.slug}'s interval does not bracket its implied value`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
