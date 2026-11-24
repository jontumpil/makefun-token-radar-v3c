# Token Radar v3c — build report (2026-11-24, main session)

## What was built

`lib/model.ts` implementing the validated v3c design from
`~/workspace/makefun/token-radar-v3b-validation/VALIDATION-REPORT.md`:
OLS [1, log10 TVL, growth, breadth] + shrunk per-category offsets +
cross-conformal intervals widened ×1.25 (factor derived 2026-11-24:
temporal coverage 71.6% → 80.6% at ×1.25; random-split 89.8%).
Age excluded from price; drives launch odds (category traded share,
age-decayed) and verdicts. Fresh `main.ts`, fresh dashboard (board /
detail / already-trading / method views, deep links `#detail=`, `#cat=`),
vendor library copied byte-for-byte (sha256 verified), owner.json set.

## Verification

- Board: **198 rows** (matches the published candidate accounting),
  watchlist **40/40**, ranks 1..198, implied non-increasing, every
  interval brackets its implied value, farm steps 6 × 20–600 chars.
- Runtime validation reproduces the analysis numbers: LOO 0.596,
  ten-fold 0.571, walk-forward 0.590, older→newer 0.533 / 0.616 / 0.517;
  coverage 89.8% random / 80.9% temporal at the shipped widening.
- Two runs on the sealed snapshot are **byte-identical**.
- Screenshots rendered from the actual dashboard with headless Chromium
  (1280×1000, 227 / 196 / 191 KB): board, Steakhouse Financial detail
  (workings, range bar, traded peer, farm plan), RWA-filtered board.
- Verdict census: 3 farm (all RWA), 14 thin, 181 skip — the top of the
  board by value (Risk Curators) carries low launch odds because that
  category rarely tokenises in this snapshot; the Method view states the
  thresholds so the verdicts can be argued with.

## Submit decision

A v3c submission REPLACES v2 (rank ~504, closes 14 Dec) as the final
entry. The validation report's standing instruction: submit only if the
dashboard is at least v2's equal on every judge criterion, and let the
user/main agent make the call — NOT on model numbers alone. Build is
complete and kit-checkable; the submit call is presented to the user
with the comparison before anything is sent.
