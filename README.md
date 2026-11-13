# Polymarket NVIDIA CEO Forecaster

Empirical-quantile forecaster for the make.fun bounty
`polymarket-nvidia-ceo-forecast-01`: forecast Polymarket's "Next CEO of
NVIDIA?" Yes prices minute by minute, 4 hours ahead.

## Entry: S2a (candidate, `main-s2a.ts`)

S2a is a synthesis of three genuine layers on top of b2. Each layer was
verified separately on the 12-case local backtest (6 official practice
cases + 6 volatile launch-day cases) and the layers stack:

1. **b2-Hasym**: b2 with one change — the power-law h-curve fit is
   weighted: 12h core fit weights w = counts / h^2.5, 48h floor fit
   weights w = counts. Everything else identical to b2.
2. **Imitation**: b2 + anchor 0.1 (threshold 0.05, 24h mean) + bounce
   0.15 (60-min lookback) + asym_up 0.85 / asym_down 1.15 +
   z_inner 0.85, drift 0.
3. **Parametric z-model**: q = x + 0.6 * Z * sigma * sqrt(h), sigma =
   winsorized (1%/99%) 1-min return std over the last 720 min, floored
   at 0.0004; then the same sum-reversion shift as b2.
4. **Equal-weight blend** of (1)+(2)+(3) at 1/3 each, averaged per
   quantile, sorted, clipped to [0,1]. No tuned weights.
5. **Adaptive scale** on the final output: per market, scale =
   sqrt(mean squared 1-min diff over last 120 min / mean squared
   1-min diff over last 720 min), clamped to [0.7, 1.4]; rescale the
   blended quantiles around their median, then sort/clip.

## Fallback: b2 (`main.ts`)

1. Per market, centred empirical quantiles of h-step price moves from the
   last 12h (stride 7), levels [0.05, 0.25, 0.5, 0.75, 0.95], median centred
   on the last price. No drift: historical drift does not predict the future
   median here (tested, it hurts).
2. Outer quantiles (5%/95%) shrunk x0.7, inner (25%/75%) x0.8, then the
   48h-window outer quantiles floored at 0.5x, then every offset shrunk x0.7.
3. Each quantile's h-curve (h = 1..240) fitted by a power law
   offset(h) = a * h^alpha, alpha in {0.30..0.80 step 0.05}, least squares.
4. Winsorize h-step samples at ±0.10; small markets (last price < 0.02)
   offsets x0.7; large markets (>= 0.05) offsets x1.15.
5. Sum-reversion: the markets are mutually exclusive, so their Yes prices
   should sum to ~1. Medians are pulled toward the sum-consistent level:
   delta = (x / S - x) * 0.7, 1/S clamped to [0.85, 1.18]; the same delta
   shifts all five quantiles.
6. Rows sorted (non-decreasing), clamped to [0,1], rounded to 6 decimals.
   Deterministic: pure functions of the input, no randomness, no network.

## Verified results (local backtest, 2026-11-13)

| Model | Practice | Extra (volatile) | Med err | Coverage |
|---|---|---|---|---|
| House baseline | 0.363589 | 2.060 | 0.7675 | 0.9496 |
| **b2 (fallback, `main.ts`)** | **0.276910** | 2.358 | 0.7537 | 0.8258 |
| **S2a (candidate, `main-s2a.ts`)** | **0.257627** | **2.254** | 0.7534 | 0.8665 |
| **S2a+h30 (submitted entry, `main.ts`)** | **0.256439** | **2.222** | 0.7474 | 0.8705 |

S2a per-case: p00 0.3985, p01 0.2956, p02 0.3633, p03 0.2441,
p04 0.1991, p05 0.1039. It improves every practice case vs b2 except
p04 (+0.002) and improves the extra cases too — it passes the
genuine-vs-overfitting test. Still 0.0076 short of the 0.250 top-10
target. The remaining gap is a median problem: the median error is
0.7534 in every candidate (27% of b2's loss) and no method tried
(drift, anchor, bounce, trees, Kalman, copula) moved it.

**S2a+h30**: S2a plus the `persist_med_h30` overlay — for h≤30, the
median is the last price (persistence) and the whole band is shifted
by the same delta; for h>30, S2a unchanged. No fitted parameters.
Per-case: p00 0.4046, p01 0.2957, p02 0.3577, p03 0.2434, p04 0.1938,
p05 0.1030. It helps 4/6 practice cases and 5/6 extra cases (hurts
p00 +0.006). Two independent tracks found S2a's median is worse than
persistence at h1–30, because at short horizons the price barely
moves, so any median shift is pure error. The S3 program proved the
median is unpredictable from the available information (see below),
so S2a+h30 is the best verified model.

- S2a TypeScript reproduces the Python prototype: practice 0.257627
  vs 0.257626, extra 2.254139 exact, per-case matching to 4 decimals.
- Two runs byte-identical; ~0.68 s per case (limit 8 s); outputs
  443–607 KB for 19–24 markets, 648 KB even for 29 markets
  (limit 1 MiB); all rows non-decreasing, in [0,1].

Rejected after testing (each measured on the same 12-case backtest):
joint/copula (markets move together, +0.21 correlation — coherence
premise fails), Kalman standalone, GARCH MLE, gradient-boosted trees
(median unpredictable, med err 0.871, not distillable), jump/vol
widening (helps volatile extra, hurts calm practice), QR stacking,
conformal width calibration, time-of-day vol scale. See ITERATIONS.md
and `nvidia-forecast/LEADERBOARD.md` for the full log.

## Run

```sh
node main.ts         # b2 fallback: reads $MAKEFUN_INPUT_DIR (default /input),
                     # writes $MAKEFUN_OUTPUT_DIR (default /output)
node main-s2a.ts     # S2a candidate (same interface)
node main-s2a-h30.ts # S2a + persist_med_h30 overlay (same interface)
```

Node 22, stdlib only. No network access needed at run time.
