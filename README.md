# Token Radar — v3c hybrid pricer

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jontumpil/makefun-token-radar-v3c/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jontumpil/makefun-token-radar-v3c/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun `token-radar-01` bounty. The program
reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and
ranks **198 genuine pre-token candidates** — every watchlist protocol (40/40)
plus every other protocol that has no token yet and is not a product of
another protocol — by the market value the model expects its token to have
at launch. Every row carries an honest 80% range, a launch-odds estimate, a
farm / thin / skip verdict and a costed farm plan. The 128 protocols that
already trade are never ranked; they are the calibration set.

## The model (v3c)

1. **Stage 1 — OLS** on the snapshot's live protocols:
   `log10(mcap) ~ 1 + log10(TVL) + clamp(change_7d, −50, 100)/100 + min(chains−1, 8)`.
2. **Stage 2 — per-category offsets**: the median stage-1 residual in the
   category, shrunk toward zero by n/(n+4).
3. **Range — cross-conformal**: 5-fold cross-fitted |log10 residuals|, the
   category's own 80% quantile when it has ≥ 8 live members, else the global
   one, **widened ×1.25 in log space** — the factor that restores ~80%
   coverage on older→newer temporal folds, where raw conformal undercovers
   (≈72%). At the shipped width the intervals covered **89.8%** on random
   splits and **80.9%** on temporal folds of this snapshot.
4. **Launch odds**: the category's traded share in the snapshot, decayed by
   `exp(−max(0, age_years − 1)/3)`. **Age is not a pricing input** — in
   validation it damaged every temporal split; it moves the odds and the
   verdicts instead.

## Held-out validation (recomputed at runtime, printed on the Method view)

Median |log10 error| of the shipped model (lower is better), against two
rival designs fitted the same way — a category-median anchor model and this
same OLS with age in the price, both rejected on these schemes:

| Scheme | n | v3c | median pred/actual |
|---|---|---|---|
| Leave-one-out | 128 | 0.596 | 0.96× |
| Ten-fold | 128 | 0.571 | 0.97× |
| Walk-forward | 38 | 0.590 | 0.95× |
| Older→newer 50/50 | 48 | 0.533 | 0.81× |
| Older→newer 60/40 | 38 | 0.616 | 0.90× |
| Older→newer 70/30 | 29 | 0.517 | 0.51× |

No temporal collapse in any scheme — the failure mode that sank a previous
iteration of this entry.

## Run it

```
node main.ts --input <snapshot.json>   # writes board.json, data.js,
                                       # dashboard/, screenshots/, dossier.json
```

Node 22+, standard library only. Output is deterministic: two runs on the
same snapshot are byte-identical.

## Layout

- `main.ts` — entry point and output wiring.
- `lib/model.ts` — the v3c model: fit, conformal ranges, odds, verdicts,
  farm plans, runtime validation, board self-check.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — the radar page (board, per-protocol detail, already-trading
  view, method & validation view). No network, no external assets.
- `screenshots/` — the board, a protocol detail, and a filtered board,
  rendered from the actual dashboard.
