# Iteration log — polymarket-nvidia-ceo-forecast-01
Measurement: `bash ~/workspace/makefun/nvidia-forecast/grade.sh` every time
(the kit's `grade-local` refuses program/v1 competitions — server-only grading,
RULES.txt line 100; the local scorer reproduces the house baseline's published
practice numbers exactly: loss 0.363589, median error 0.767503, coverage 0.949642).
Accept a change only if LOSS_MEAN improves and no case worsens sharply.
Kept components: sum-reversion, power-law horizon curve.
Rejected (do not repeat): long-run mean-reversion, bounce reversal, drift,
asymmetric tails, logit model, momentum, EWMA.

| ver | change | p00 | p01 | p02 | p03 | p04 | p05 | LOSS_MEAN | COV | MED | verdict |
|-----|--------|-----|-----|-----|-----|-----|-----|-----------|-----|-----|---------|
| v2 | baseline: 12h core, 48h floor 0.5, shrink 0.7/0.8, extra 0.7, sumrev 0.7 clamp [0.85,1.18] | 0.424363 | 0.324256 | 0.372598 | 0.317638 | 0.205195 | 0.116166 | 0.283761 | 0.8574 | 0.7537 | baseline |
| a1 | core window 12h → 16h | 0.432810 | 0.322241 | 0.368353 | 0.327171 | 0.209351 | 0.121920 | 0.287657 | 0.8580 | 0.7537 | TOLAK (mean +0.0039, 4/6 case memburuk) — revert ke 12h |
| a2 | winsorize sampel Δ(h) di kuantil 1%/99% | 0.424363 | 0.324256 | 0.372598 | 0.317637 | 0.205199 | 0.116166 | 0.283762 | 0.8574 | 0.7537 | TOLAK (no-op: winsorize di 1% tidak mengubah kuantil 5%/95% — lihat catatan) — revert ke off |
| a3 | winsorize absolut: clip sampel Δ(h) ke ±0.10 | 0.414304 | 0.317304 | 0.376691 | 0.311604 | 0.201815 | 0.114231 | 0.279763 | 0.8341 | 0.7537 | TERIMA (mean -0.0040, 5/6 case membaik; p02 +0.004, tidak tajam) |
| a4 | winsorize absolut ±0.10 → ±0.05 | 0.468131 | 0.328218 | 0.382027 | 0.343074 | 0.199268 | 0.112122 | 0.294947 | 0.7815 | 0.7537 | TOLAK (mean +0.0152, p00/p03 memburuk tajam, coverage 0.78) — revert ke ±0.10 |
| a5 | winsorize absolut ±0.10 → ±0.20 | 0.416534 | 0.321781 | 0.371566 | 0.315435 | 0.205130 | 0.116154 | 0.281668 | 0.8553 | 0.7537 | TOLAK (mean +0.0019 vs a3, 5/6 case memburuk) — revert ke ±0.10 |
| a6 | core window 12h → 8h (winsorize ±0.10 tetap) | 0.408219 | 0.304776 | 0.396096 | 0.305812 | 0.196225 | 0.109230 | 0.276854 | 0.8318 | 0.7537 | TOLAK (mean membaik -0.0029 tapi p02 memburuk tajam +0.019 — melanggar aturan terima) — revert ke 12h |
| a7 | core window 12h → 24h (winsorize ±0.10 tetap) | 0.424791 | 0.312885 | 0.388277 | 0.323164 | 0.209737 | 0.116286 | 0.286332 | 0.8402 | 0.7537 | TOLAK (mean +0.0066, 5/6 case memburuk) — revert ke 12h |
| b1 | market kecil (x<0.02) offsets ×0.7 | 0.414486 | 0.313937 | 0.377409 | 0.309595 | 0.199372 | 0.112665 | 0.278284 | 0.8165 | 0.7537 | TERIMA (mean -0.0015, tidak ada case memburuk) |
