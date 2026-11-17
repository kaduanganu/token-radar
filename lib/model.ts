// Token Radar, model radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and every other rankable pre-token protocol below the floor, by TVL.
// A protocol is pre-token when its record carries no token at all: no market
// cap, no CoinGecko id, no symbol. Live-token protocols are kept apart and
// shown with the market's own value, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. No protocol
// name is ever special-cased: the same function scores every row.
//
//   base         = tvl_usd x BASE_MULTIPLE
//   growth       = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT, where the weight is
//                  0.65 on a gain and 0.90 on a loss: a falling TVL is
//                  penalised harder than a rising TVL is rewarded, because a
//                  protocol losing deposits before it has a token is losing
//                  the users a launch would need.
//   maturity     = 0.55 + min(age_days, 1095) / 1095 x 0.50
//                  (age_days unknown: 365). A protocol that has run longer
//                  with no token has survived longer without one, so its
//                  launch, if it comes, rests on a longer record.
//   chainMult    = 1 + 0.03 x min(max(chains - 1, 0), 3)
//                  (1.00 to 1.09). A protocol live on more chains reaches
//                  more users and depends on no single chain.
//   implied      = max(1, round(base x growthMult x maturity x chainMult))
//
// The constants are stated in the dashboard and changeable in one place.
//
// Design notes, written while building radar-2.
//
// Why TVL times a multiple, and why 0.28: a pre-token protocol has no
// market, so the only honest anchor is what users have already trusted it
// with. A fully diluted value at launch usually lands well below the
// protocol's TVL for the largest names and well above it for the smallest,
// so a single multiple cannot be right for every row; 0.28 is the middle
// of the range the watchlist's own figures suggest, and the dashboard says
// so instead of hiding it. The board is a ranking first and a valuation
// second: the order of the rows matters more than any single dollar figure,
// which is why the multipliers are small and bounded.
//
// Why growth is asymmetric: a protocol gaining deposits is doing something
// users want, but a protocol losing them is losing the very users a token
// launch would need to reward. The 0.90 weight on a loss against 0.65 on a
// gain makes the ranking punish decline harder than it rewards growth,
// and the clamp at -60 and +120 keeps one wild week from deciding a rank.
//
// Why maturity is capped at three years: beyond that, surviving longer
// stops telling you much. A protocol that has run three years with no token
// has proven it can wait; a protocol listed last month has proven almost
// nothing, and the 0.55 floor keeps it on the board anyway, because the
// board is a radar, not a gate.
//
// Why chains are worth at most 9%: being on more chains is reach, not
// quality. A protocol on one chain that users love beats a protocol spread
// thin across four. The multiplier is deliberately small so it breaks ties
// between similar protocols instead of reordering the board on its own.
//
// Why the board holds 226 rows instead of 100: the watchlist is the floor,
// 40 protocols, and below it there are exactly 186 more rankable pre-token
// protocols in the snapshot. Cutting the board at 100 would hide 126 of
// them for no reason. The board is the watchlist plus the whole pre-token
// field beneath it — not the whole snapshot, and the dashboard says so.
// The 758 protocols reconcile exactly: 226 on the board, 53 pre-token
// protocols excluded as exchanges or versioned names, 63 rankable pre-token
// protocols above the floor but outside the watchlist (mostly bridges and
// liquid-staking wrappers, whose "token" would be a receipt for someone
// else's asset, so the snapshot's watchlist leaves them out), and 416
// protocols that already carry a token field, of which the Live token view
// shows the 24 largest by market cap.
//
// Why the readiness band is separate from the rank: the rank is the model's
// answer, and the band is a reading aid built from the same two inputs the
// reader already sees, growth and maturity. A hot band on a low-ranked row
// is worth a second look; a watch band on a high-ranked row is a warning
// that the implied value rests on a falling or very young protocol. Keeping
// the band out of the formula keeps the formula auditable in one place.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_steps: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.28,
  growth_weight_up: 0.65,
  growth_weight_down: 0.9,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_max_steps: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  watchlist: boolean;
  /** How close the protocol looks to a launch, from its own figures: hot
   *  when it is growing and has run a long time with no token, warm when it
   *  is holding its ground, watch when it is shrinking or very young. */
  band: 'hot' | 'warm' | 'watch';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
  band: 'hot' | 'warm' | 'watch';
}

/** A top mover: a board row whose seven-day TVL growth is the strongest,
 *  shown beside the ranking so a reader can see momentum at a glance. */
export interface MoverRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  band: 'hot' | 'warm' | 'watch';
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The board's own summary figures, computed from the rows it scores. */
export interface BoardSummary {
  board_tvl_usd: number;
  median_implied_usd: number;
  hot_count: number;
  warm_count: number;
  watch_count: number;
  /** The board's categories by row count, strongest first. */
  categories: { category: string; rows: number }[];
  /** The board's chains by row count, strongest first. */
  chains: { chain: string; rows: number }[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  summary: BoardSummary;
  /** The board's ten strongest seven-day growers, by change_7d. */
  movers: MoverRow[];
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_weight_up : model.growth_weight_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Array.isArray(protocol.chains) ? protocol.chains.length : 0;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(chainCount - 1, 0), model.chain_max_steps);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * A row's readiness band, from the same figures the model scores: a
 * protocol is hot when its TVL is growing and it has run a long time with
 * no token, warm when it is roughly holding its ground, and watch when its
 * TVL is falling hard or it is too young to have a record yet. The band
 * never changes a row's rank: it is a reading aid, computed after the
 * ranking, so two rows with the same implied value keep their order.
 */
export function readinessBand(growthPct: number, maturityMult: number, age: number | null): 'hot' | 'warm' | 'watch' {
  if (growthPct < -15 || (age !== null && age < 90)) return 'watch';
  if (growthPct > 0 && maturityMult >= 0.85) return 'hot';
  if (growthPct >= -5) return 'warm';
  return 'watch';
}

/** The board's summary figures, from the rows it scored. */
export function summaryStats(board: BoardRow[]): BoardSummary {
  const tvl = board.reduce((s, r) => s + r.tvl_usd, 0);
  const implied = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const median = implied.length === 0 ? 0 : implied[Math.floor(implied.length / 2)]!;
  const byCategory = new Map<string, number>();
  const byChain = new Map<string, number>();
  for (const r of board) {
    byCategory.set(r.category ?? 'Other', (byCategory.get(r.category ?? 'Other') ?? 0) + 1);
    for (const c of r.chains) byChain.set(c, (byChain.get(c) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, key: string) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 8)
      .map(([name, rows]) => ({ [key]: name, rows }) as never);
  return {
    board_tvl_usd: tvl,
    median_implied_usd: median,
    hot_count: board.filter((r) => r.band === 'hot').length,
    warm_count: board.filter((r) => r.band === 'warm').length,
    watch_count: board.filter((r) => r.band === 'watch').length,
    categories: top(byCategory, 'category') as BoardSummary['categories'],
    chains: top(byChain, 'chain') as BoardSummary['chains'],
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot
  // no longer carries (it cannot, but coverage is the gate's row and is never
  // gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist
  // floor, by TVL. No cap: this snapshot holds 186 of them, and the board
  // exists to find them. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    watchlist: watch.has(s.p.slug),
    band: readinessBand(s.growthPct, s.maturityMult, s.age),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL and age), never from a hand-written list of names. Step 5
 * asks the farmer to read the docs and the audit before adding capital,
 * and step 6 is the safety step: airdrop claims are the most common way
 * farmers lose money, so the plan says where to claim and what never to
 * pay before it says to log the position.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that will hold only this farm's funds, write its seed phrase on paper, and keep that paper offline and apart from your phone.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week, such as a deposit, a borrow, a swap or a governance vote, and vary the action so the history reads as real use.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Leave the position untouched for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early to chase another farm.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Read the protocol's own documentation and, where it has one, its audit report, before you add more capital than the first deposit.`,
      cost: 'nothing to read',
      time: '20 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes itself, and claim only there.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Never connect this wallet to a claim link from a direct message, a search ad or a copied post, and never sign a transaction you cannot read.`,
      cost: 'nothing, and it saves the whole position',
      time: '1 minute to check the link',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The board's ten strongest seven-day growers, by change_7d, ties broken
 *  by implied value so the order is deterministic. A mover is a board row,
 *  never a live-token protocol: momentum here is momentum before a token. */
export function topMovers(board: BoardRow[]): MoverRow[] {
  return board
    .filter((r) => r.change_7d !== null)
    .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0) || b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 10)
    .map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      band: r.band,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: row.watchlist,
    band: row.band,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    summary: summaryStats(board),
    movers: topMovers(board),
    rows: board.map(radarRow),
    live,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
