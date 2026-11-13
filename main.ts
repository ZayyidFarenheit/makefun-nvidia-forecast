// Empirical-quantile forecaster for Polymarket "Next CEO of NVIDIA?" prices.
// Model v2 (verified 2026-11-13, practice loss 0.283761 vs house baseline
// 0.363589, 90% coverage 0.857, median error 0.7537):
//
//   1. Per market, centred empirical quantiles of h-step price moves from the
//      last CORE_WINDOW (stride 7), levels [0.05, 0.25, 0.5, 0.75, 0.95],
//      median centred on the last price (no drift: historical drift does not
//      predict the future median in this market; tested, it hurts).
//   2. Outer quantiles (5%/95%) shrunk xSHRINK_OUTER, inner (25%/75%)
//      xSHRINK_INNER, then the FLOOR_WINDOW outer quantiles floored at
//      FLOOR_K (so a quiet core window never pretends a jump is impossible),
//      then every offset shrunk xEXTRA.
//   3. Each quantile's h-curve (h = 1..240) is fitted by a power law
//      offset(h) = a * h^alpha, alpha in {0.30..0.80 step 0.05}, least squares
//      per quantile. This pools 240 noisy per-h estimates into 2 parameters.
//   4. Sum-reversion: the 24 markets are mutually exclusive, so their Yes
//      prices should sum to ~1. Medians are pulled toward the sum-consistent
//      level: delta = (x / S - x) * SUM_POWER with 1/S clamped to SUM_CLAMP,
//      S = sum of last prices; the same delta shifts all five quantiles.
//   5. Rows are sorted (non-decreasing quantiles), clamped to [0,1] and
//      rounded to 6 decimals. Output is deterministic: pure functions of the
//      input, no randomness, no network, no clock.
//
// Parameters are learned from the case's own history at prediction time only.
// No hardcoded prices or market ids. See ITERATIONS.md for the tuning log.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TAU = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
const HORIZON = 240;

// ---- parameters (v2 baseline) ----
const CORE_WINDOW_MIN = 720; // 12h (a7 ditolak, revert)
const FLOOR_WINDOW_MIN = 2880; // 48h
const SHRINK_OUTER = 0.7;
const SHRINK_INNER = 0.8;
const FLOOR_K = 0.5;
const EXTRA = 0.7;
const SUM_POWER = 0.7;
const SUM_CLAMP_LO = 0.85;
const SUM_CLAMP_HI = 1.18;
const STRIDE = 7;
const WINSOR_Q = 0; // 0 = off; else clip h-step samples at this two-sided quantile (e.g. 0.01)
const WINSOR_ABS = 0.1; // iter a3 accepted: clip h-step samples to [-0.10, +0.10]
const SMALL_THR = 0.02; // iter b1: markets with last price below this are "small"
const SMALL_K = 0.7; // iter b1: small markets' offsets x0.7 (pulled harder to last price)
const LARGE_THR = 0.05; // iter b2: markets with last price at/above this are "large"
const LARGE_K = 1.15; // iter b2: large markets' offsets x1.15 (looser)

function q6(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return Math.round(c * 1e6) / 1e6;
}

function quantile(sorted: number[], tau: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = tau * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Raw (uncentred) empirical quantiles of h-step moves for one market.
function rawOffsets(prices: number[], windowMin: number): number[][] {
  const p = prices.length > windowMin ? prices.slice(prices.length - windowMin) : prices;
  const n = p.length;
  const out: number[][] = [];
  let last: number[] | null = null;
  for (let h = 1; h <= HORIZON; h++) {
    let qs: number[];
    if (n - h >= 30) {
      const d: number[] = [];
      for (let i = 0; i < n - h; i += STRIDE) d.push(p[i + h] - p[i]);
      d.sort((a, b) => a - b);
      if (WINSOR_ABS > 0) {
        for (let k = 0; k < d.length; k++) d[k] = Math.min(WINSOR_ABS, Math.max(-WINSOR_ABS, d[k]));
      }
      if (WINSOR_Q > 0 && d.length >= 20) {
        const lo = quantile(d, WINSOR_Q);
        const hi = quantile(d, 1 - WINSOR_Q);
        for (let k = 0; k < d.length; k++) d[k] = Math.min(hi, Math.max(lo, d[k]));
      }
      qs = TAU.map((t) => quantile(d, t));
      last = qs;
    } else if (n - h >= 5) {
      const d: number[] = [];
      for (let i = 0; i < n - h; i++) d.push(p[i + h] - p[i]);
      d.sort((a, b) => a - b);
      if (WINSOR_ABS > 0) {
        for (let k = 0; k < d.length; k++) d[k] = Math.min(WINSOR_ABS, Math.max(-WINSOR_ABS, d[k]));
      }
      qs = TAU.map((t) => quantile(d, t));
      last = qs;
    } else if (last !== null) {
      qs = last;
    } else {
      qs = Z.map((z) => z * 0.0025 * Math.sqrt(h));
    }
    out.push(qs);
  }
  return out;
}

// Fit each column of offs (240 x 5) by offset(h) = a * h^alpha, alpha on a grid.
function powerFit(offs: number[][]): number[][] {
  const out: number[][] = [];
  for (let j = 0; j < 5; j++) {
    let bestErr = Infinity, bestA = 0, bestAlpha = 0.5;
    for (let k = 0; k <= 10; k++) {
      const alpha = 0.3 + 0.05 * k;
      let num = 0, den = 0;
      for (let h = 1; h <= HORIZON; h++) {
        const v = Math.pow(h, alpha);
        num += v * offs[h - 1][j];
        den += v * v;
      }
      const a = den > 0 ? num / den : 0;
      let err = 0;
      for (let h = 1; h <= HORIZON; h++) {
        const diff = a * Math.pow(h, alpha) - offs[h - 1][j];
        err += diff * diff;
      }
      if (err < bestErr) { bestErr = err; bestA = a; bestAlpha = alpha; }
    }
    for (let h = 1; h <= HORIZON; h++) {
      if (!out[h - 1]) out[h - 1] = [];
      out[h - 1][j] = bestA * Math.pow(h, bestAlpha);
    }
  }
  return out;
}

function forecastMarket(prices: number[]): number[][] {
  const rawCore = rawOffsets(prices, CORE_WINDOW_MIN);
  const rawFloor = rawOffsets(prices, FLOOR_WINDOW_MIN);
  // centre on the median column, then power-fit each column
  const cCore = rawCore.map((row) => row.map((v) => v - row[2]));
  const cFloor = rawFloor.map((row) => row.map((v) => v - row[2]));
  const o = powerFit(cCore);
  const oFloor = powerFit(cFloor);
  // shrink + floor-window outer floor
  for (let h = 0; h < HORIZON; h++) {
    o[h][0] *= SHRINK_OUTER; o[h][4] *= SHRINK_OUTER;
    o[h][1] *= SHRINK_INNER; o[h][3] *= SHRINK_INNER;
    o[h][0] = Math.min(o[h][0], FLOOR_K * oFloor[h][0]);
    o[h][4] = Math.max(o[h][4], FLOOR_K * oFloor[h][4]);
  }
  // (b) small/thin markets: pull harder to the last price (narrower bands);
  // large markets: looser (wider bands)
  const x = prices[prices.length - 1];
  if (x < SMALL_THR) {
    for (let h = 0; h < HORIZON; h++) {
      for (let j = 0; j < 5; j++) o[h][j] *= SMALL_K;
    }
  } else if (x >= LARGE_THR) {
    for (let h = 0; h < HORIZON; h++) {
      for (let j = 0; j < 5; j++) o[h][j] *= LARGE_K;
    }
  }
  return o;
}

interface MarketIn { id: string; prices: number[]; }

function forecastCase(markets: MarketIn[]): Record<string, number[][]> {
  const sum = markets.reduce((s, m) => s + m.prices[m.prices.length - 1], 0);
  let f = sum > 0 ? 1 / sum : 1;
  f = Math.min(SUM_CLAMP_HI, Math.max(SUM_CLAMP_LO, f));
  const out: Record<string, number[][]> = {};
  for (const m of markets) {
    const x = m.prices[m.prices.length - 1];
    const o = forecastMarket(m.prices);
    const delta = (x * f - x) * SUM_POWER;
    const rows: number[][] = [];
    for (let h = 0; h < HORIZON; h++) {
      const row = o[h].map((v) => q6(x + v * EXTRA + delta)).sort((a, b) => a - b);
      rows.push(row);
    }
    out[m.id] = rows;
  }
  return out;
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outputDir, { recursive: true });

const files = readdirSync(inputDir).filter((f) => f.endsWith(".in")).sort();
for (const file of files) {
  const data = JSON.parse(readFileSync(join(inputDir, file), "utf-8"));
  const fc = forecastCase(data.markets);
  const forecasts = data.markets.map((m: MarketIn) => ({ id: m.id, q: fc[m.id] }));
  const outFile = file.replace(/\.in$/, ".out");
  writeFileSync(join(outputDir, outFile), JSON.stringify({ forecasts }));
}
