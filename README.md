# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kaduanganu/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kaduanganu/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by implied value, from a sealed DefiLlama snapshot. The board covers all 40 watchlist protocols plus every other rankable pre-token protocol below the $50M floor — 226 rows in all — each with a model breakdown and an eight-step farm plan with costs and times. Live-token protocols are set aside with their market caps, never mixed into the ranking.

The model, radar-2, scores each protocol from the snapshot alone: TVL times 0.28, a growth multiplier that penalises a falling TVL harder than it rewards a rising one, a maturity multiplier for how long it has run with no token, and a small multiplier for how many chains it is live on. No protocol name is special-cased. The full reasoning, including why each multiplier is the size it is, is written as a design note at the top of `lib/model.ts`.

## What the snapshot holds

The sealed snapshot, dated 2026-11-14, carries 758 protocols. They reconcile exactly:

- **226 on the board** — the 40 watchlist protocols plus 186 rankable pre-token protocols below the $50M floor.
- **53 pre-token protocols excluded** as exchanges or versioned names (a second version of a protocol is the same protocol, not a new candidate).
- **63 rankable pre-token protocols above the floor but outside the watchlist**, mostly bridges and liquid-staking wrappers, whose "token" would be a receipt for someone else's asset, so the snapshot's watchlist leaves them out. They are not ranked here, and the dashboard says so.
- **416 protocols that already carry a token field**, of which the dashboard's Live token view shows the 24 largest by market cap.

A protocol counts as pre-token when its record carries no token at all: no market cap, no CoinGecko id, no symbol. That is what the snapshot records, not proof that no token exists.

## What the dashboard shows

- **The board** — all 226 rows, strongest implied value first, with TVL, seven-day growth, age, and a readiness band (hot, warm, watch) that reads growth and maturity together. The band is a reading aid, not part of the rank.
- **Top movers** — the ten board rows whose TVL grew fastest over seven days.
- **Filters** — search by name, category or chain; filter by category, chain, readiness band, or watchlist only; sort by rank, name, TVL, growth, age or implied value. Every filter round-trips through the URL hash, so a filtered view or an open protocol can be shared as a link.
- **Detail drawer** — open any row to see the model's own inputs (TVL, growth, age, chains, all three multipliers), the page recomputing the row's implied value from the same function that wrote `board.json`, and the eight-step farm plan with its cost and time. The plan is derived from the protocol's category, chains, TVL and age, and it includes a safety step: claim only from the protocol's own published link, never from a direct message, an ad, or a copied post.
- **The model panel** — the formula in full, the board's summary (board TVL, median implied value, the hot/warm/watch split, the biggest categories and chains), and where the board lives by chain.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22 or later, standard library only, no install and no network. `main.ts` reads the snapshot, writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. Run it twice and the output is byte-identical: the build is deterministic, which the competition's sandbox re-runs to check.

Open `out/dashboard/index.html` in a browser to use the radar. Nothing on the page loads from the network; every byte it shows comes from `data.js`.

## Files

- `main.ts` — the entrypoint: reads the snapshot, builds the board, copies the dashboard and screenshots, writes the dossier.
- `lib/model.ts` — the model, the board builder, the farm plans, the live-token set, the movers, and the readiness bands.
- `vendor/makefun-board.ts` — the kit's board writer, copied verbatim as the kit instructs.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the whole dashboard, no build step.
- `screenshots/` — the three screenshots: the board, a protocol's detail view, and a filtered view.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
