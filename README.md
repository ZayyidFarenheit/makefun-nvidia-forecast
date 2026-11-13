# Polymarket NVIDIA CEO Forecaster

Empirical-quantile forecaster for the make.fun bounty
`polymarket-nvidia-ceo-forecast-01`: forecast Polymarket's "Next CEO of
NVIDIA?" Yes prices minute by minute, 4 hours ahead.

## Model (v2)

1. Per market, centred empirical quantiles of h-step price moves from the
   last 12h (stride 7), levels [0.05, 0.25, 0.5, 0.75, 0.95], median centred
   on the last price. No drift: historical drift does not predict the future
   median here (tested, it hurts).
2. Outer quantiles (5%/95%) shrunk x0.7, inner (25%/75%) x0.8, then the
   48h-window outer quantiles floored at 0.5x, then every offset shrunk x0.7.
3. Each quantile's h-curve (h = 1..240) fitted by a power law
   offset(h) = a * h^alpha, alpha in {0.30..0.80 step 0.05}, least squares.
4. Sum-reversion: the 24 markets are mutually exclusive, so their Yes prices
   should sum to ~1. Medians are pulled toward the sum-consistent level:
   delta = (x / S - x) * 0.7, 1/S clamped to [0.85, 1.18]; the same delta
   shifts all five quantiles.
5. Rows sorted (non-decreasing), clamped to [0,1], rounded to 6 decimals.
   Deterministic: pure functions of the input, no randomness, no network.

## Verified results (local backtest, 2026-11-13)

- Practice cases p00-p05 (official): **pinball loss 0.283761** vs house
  baseline 0.363589 (**-22%**), median error 0.7537, 90% coverage 0.857.
- Volatile launch-day backtest (6 extra cases): mean loss 2.215 vs baseline
  2.060 — the model stays competitive in a much jumpier regime.
- Two runs byte-identical; ~0.35 s per case (limit 8 s); outputs 181-254 KB
  (limit 1 MiB); all rows non-decreasing, in [0,1].

Rejected after testing (each measured on the same 12-case backtest):
anchor mean-reversion, bounce reversal, drift/skewed median, asymmetric
tails, logit-space walk, window ensembles — all worse than v2.

## Run

```sh
node main.ts   # reads $MAKEFUN_INPUT_DIR (default /input),
               # writes $MAKEFUN_OUTPUT_DIR (default /output)
```

Node 22, stdlib only. No network access needed at run time.
