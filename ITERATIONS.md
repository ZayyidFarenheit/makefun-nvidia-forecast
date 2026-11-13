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
