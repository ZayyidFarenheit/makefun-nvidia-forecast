// S2a — synthesis of three genuine layers on top of b2.
// Verified 2026-11-13 (Python prototypes, 12 cases):
//   practice loss 0.257626 vs b2 0.276910 (-0.0193, -7.0%)
//   extra-case (volatile launch-day) loss 2.254 vs b2 2.358
//   median error 0.7534 (unchanged — no method moved the median),
//   coverage 0.867. Per-case: p00 0.3985, p01 0.2956, p02 0.3633,
//   p03 0.2441, p04 0.1991, p05 0.1039. Improves every practice case
//   vs b2 except p04 (+0.002, negligible), and improves the extra
//   cases too — it passes the genuine-vs-overfitting test.
//   Still 0.0076 short of the 0.250 top-10 target; the remaining gap
//   is a median problem (27% of b2's loss) that no method tried has moved.
//
// Recipe (all components are deterministic functions of the case's own
// 72h history; stdlib-computable):
//   1. b2-Hasym: b2 with ONE change — the power-law h-curve fit is
//      weighted: 12h core fit weights w = counts / h^2.5, 48h floor fit
//      weights w = counts. Everything else identical to b2.
//   2. Imitation: b2 + anchor 0.1 (threshold 0.05, 24h mean) + bounce
//      0.15 (60-min lookback) + asym_up 0.85 / asym_down 1.15 +
//      z_inner 0.85, drift 0.
//   3. Parametric z-model: q = x + 0.6 * Z * sigma * sqrt(h), sigma =
//      winsorized (1%/99%) 1-min return std over the last 720 min,
//      floored at 0.0004; then the same sum-reversion shift as b2.
//   4. Equal-weight blend of (1)+(2)+(3) at 1/3 each, averaged per
//      quantile, sorted, clipped to [0,1]. No tuned weights.
//   5. Adaptive scale on the final output: per market, scale =
//      sqrt(mean squared 1-min diff over last 120 min / mean squared
//      1-min diff over last 720 min), clamped to [0.7, 1.4]; rescale
//      the blended quantiles around their median, then sort/clip.
//
// This file is the S2a CANDIDATE. main.ts remains the b2 fallback and is
// NOT touched. Do not submit this file without explicit approval.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TAU = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
const HORIZON = 240;

// ---- b2 parameters (identical to main.ts) ----
const CORE_WINDOW_MIN = 720; // 12h
const FLOOR_WINDOW_MIN = 2880; // 48h
const SHRINK_OUTER = 0.7;
const SHRINK_INNER = 0.8;
const FLOOR_K = 0.5;
const EXTRA = 0.7;
const SUM_POWER = 0.7;
const SUM_CLAMP_LO = 0.85;
const SUM_CLAMP_HI = 1.18;
const STRIDE = 7;
const WINSOR_ABS = 0.1;
const SMALL_THR = 0.02;
const SMALL_K = 0.7;
const LARGE_THR = 0.05;
const LARGE_K = 1.15;
const SHORT_HIST_MIN = 720;
const SHORT_K = 1.0;

// ---- imitation parameters (P_FINAL, round 3) ----
const IMIT_ANCHOR_A = 0.1;
const IMIT_ANCHOR_THR = 0.05;
const IMIT_ANCHOR_WIN = 1440; // 24h mean
const IMIT_BOUNCE_FRAC = 0.15;
const IMIT_BOUNCE_LB = 60;
const IMIT_ASYM_UP = 0.85;
const IMIT_ASYM_DOWN = 1.15;
const IMIT_Z_INNER = 0.85;

// ---- z-model parameters ----
const Z_W = 720;
const Z_K = 0.6;
const Z_WINSOR_Q = 0.01;
const Z_FLOOR = 0.0004;

// ---- adaptive scale parameters ----
const SCALE_RECENT = 120;
const SCALE_LONG = 720;
const SCALE_LO = 0.7;
const SCALE_HI = 1.4;

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

function popStd(arr: number[]): number {
  const n = arr.length;
  if (n === 0) return 0;
  let mean = 0;
  for (const v of arr) mean += v;
  mean /= n;
  let ss = 0;
  for (const v of arr) {
    const d = v - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / n);
}

// ---- b2 raw offsets (verbatim from main.ts) ----
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

// ---- b2 power fit, unweighted (verbatim from main.ts) ----
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

// ---- b2 market offsets (verbatim from main.ts forecastMarket) ----
function b2Offsets(prices: number[]): number[][] {
  const rawCore = rawOffsets(prices, CORE_WINDOW_MIN);
  const rawFloor = rawOffsets(prices, FLOOR_WINDOW_MIN);
  const cCore = rawCore.map((row) => row.map((v) => v - row[2]));
  const cFloor = rawFloor.map((row) => row.map((v) => v - row[2]));
  const o = powerFit(cCore);
  const oFloor = powerFit(cFloor);
  for (let h = 0; h < HORIZON; h++) {
    o[h][0] *= SHRINK_OUTER; o[h][4] *= SHRINK_OUTER;
    o[h][1] *= SHRINK_INNER; o[h][3] *= SHRINK_INNER;
    o[h][0] = Math.min(o[h][0], FLOOR_K * oFloor[h][0]);
    o[h][4] = Math.max(o[h][4], FLOOR_K * oFloor[h][4]);
  }
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
  if (prices.length < SHORT_HIST_MIN) {
    for (let h = 0; h < HORIZON; h++) {
      for (let j = 0; j < 5; j++) o[h][j] *= SHORT_K;
    }
  }
  return o;
}

// b2 quantiles for one market (q6-rounded), given the case sum factor f.
function b2Quantiles(prices: number[], f: number): number[][] {
  const x = prices[prices.length - 1];
  const o = b2Offsets(prices);
  const delta = (x * f - x) * SUM_POWER;
  const rows: number[][] = [];
  for (let h = 0; h < HORIZON; h++) {
    const row = o[h].map((v) => q6(x + v * EXTRA + delta)).sort((a, b) => a - b);
    rows.push(row);
  }
  return rows;
}

// ---- Hasym raw offsets + counts (matches hcurve_c.raw_offsets_w) ----
function rawOffsetsW(prices: number[], windowMin: number): { offs: number[][]; counts: number[] } {
  const p = prices.length > windowMin ? prices.slice(prices.length - windowMin) : prices;
  const n = p.length;
  const offs: number[][] = [];
  const counts: number[] = [];
  let last: number[] | null = null;
  let lastC = 1;
  for (let h = 1; h <= HORIZON; h++) {
    let qs: number[];
    if (n - h >= 30) {
      const d: number[] = [];
      for (let i = 0; i < n - h; i += STRIDE) d.push(p[i + h] - p[i]);
      d.sort((a, b) => a - b);
      for (let k = 0; k < d.length; k++) d[k] = Math.min(WINSOR_ABS, Math.max(-WINSOR_ABS, d[k]));
      qs = TAU.map((t) => quantile(d, t));
      last = qs;
      lastC = d.length;
    } else if (n - h >= 5) {
      const d: number[] = [];
      for (let i = 0; i < n - h; i++) d.push(p[i + h] - p[i]);
      d.sort((a, b) => a - b);
      for (let k = 0; k < d.length; k++) d[k] = Math.min(WINSOR_ABS, Math.max(-WINSOR_ABS, d[k]));
      qs = TAU.map((t) => quantile(d, t));
      last = qs;
      lastC = d.length;
    } else if (last !== null) {
      qs = last;
    } else {
      qs = Z.map((z) => z * 0.0025 * Math.sqrt(h));
    }
    offs.push(qs);
    counts.push(lastC);
  }
  return { offs, counts };
}

// ---- weighted power-law grid fit (matches hcurve_c._grid_fit) ----
function powerFitW(offs: number[][], w: number[]): number[][] {
  const out: number[][] = [];
  for (let j = 0; j < 5; j++) {
    let bestErr = Infinity, bestA = 0, bestAlpha = 0.5;
    for (let k = 0; k <= 10; k++) {
      const alpha = 0.3 + 0.05 * k;
      let num = 0, den = 0;
      for (let h = 1; h <= HORIZON; h++) {
        const v = Math.pow(h, alpha);
        num += w[h - 1] * v * offs[h - 1][j];
        den += w[h - 1] * v * v;
      }
      const a = den > 0 ? num / den : 0;
      let err = 0;
      for (let h = 1; h <= HORIZON; h++) {
        const v = Math.pow(h, alpha);
        const diff = a * v - offs[h - 1][j];
        err += w[h - 1] * diff * diff;
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

// b2-Hasym quantiles for one market (q6-rounded), given the case sum factor f.
function hasymQuantiles(prices: number[], f: number): number[][] {
  const x = prices[prices.length - 1];
  const rc = rawOffsetsW(prices, CORE_WINDOW_MIN);
  const rf = rawOffsetsW(prices, FLOOR_WINDOW_MIN);
  const c = rc.offs.map((row) => row.map((v) => v - row[2]));
  const cf = rf.offs.map((row) => row.map((v) => v - row[2]));
  const wC = rc.counts.map((cnt, idx) => cnt / Math.pow(idx + 1, 2.5));
  const o = powerFitW(c, wC);
  const of = powerFitW(cf, rf.counts);
  for (let h = 0; h < HORIZON; h++) {
    o[h][0] *= SHRINK_OUTER; o[h][4] *= SHRINK_OUTER;
    o[h][1] *= SHRINK_INNER; o[h][3] *= SHRINK_INNER;
    o[h][0] = Math.min(o[h][0], FLOOR_K * of[h][0]);
    o[h][4] = Math.max(o[h][4], FLOOR_K * of[h][4]);
  }
  if (x < SMALL_THR) {
    for (let h = 0; h < HORIZON; h++) {
      for (let j = 0; j < 5; j++) o[h][j] *= SMALL_K;
    }
  } else if (x >= LARGE_THR) {
    for (let h = 0; h < HORIZON; h++) {
      for (let j = 0; j < 5; j++) o[h][j] *= LARGE_K;
    }
  }
  if (prices.length < SHORT_HIST_MIN) {
    for (let h = 0; h < HORIZON; h++) {
      for (let j = 0; j < 5; j++) o[h][j] *= SHORT_K;
    }
  }
  const delta = (x * f - x) * SUM_POWER;
  const rows: number[][] = [];
  for (let h = 0; h < HORIZON; h++) {
    const row = o[h].map((v) => q6(x + v * EXTRA + delta)).sort((a, b) => a - b);
    rows.push(row);
  }
  return rows;
}

// ---- imitation transform on a b2 quantile array (matches imit.build_imit) ----
function imitQuantiles(b2q: number[][], prices: number[]): number[][] {
  const x = prices[prices.length - 1];
  const p = prices;
  // re-tuned inner z
  let q = b2q.map((row) => {
    const med = row[2];
    return [
      row[0],
      med + (row[1] - med) * IMIT_Z_INNER,
      row[2],
      med + (row[3] - med) * IMIT_Z_INNER,
      row[4],
    ];
  });
  // asymmetric up/down scaling
  q = q.map((row) => {
    const med = row[2];
    return row.map((v) => (v > med ? med + (v - med) * IMIT_ASYM_UP : med + (v - med) * IMIT_ASYM_DOWN));
  });
  // median shifts, phased in with h/240
  const shift: number[] = new Array(HORIZON).fill(0);
  // anchor mean-reversion with threshold (24h mean)
  {
    const win = IMIT_ANCHOR_WIN;
    const seg = p.length > win ? p.slice(p.length - win) : p;
    let anchor = 0;
    for (const v of seg) anchor += v;
    anchor /= seg.length;
    const dev = anchor - x;
    if (Math.abs(dev) > IMIT_ANCHOR_THR) {
      for (let h = 0; h < HORIZON; h++) shift[h] += IMIT_ANCHOR_A * dev * ((h + 1) / HORIZON);
    }
  }
  // bounce reversal (60-min lookback)
  {
    const lb = IMIT_BOUNCE_LB;
    const lm = p.length > lb ? x - p[p.length - 1 - lb] : 0;
    for (let h = 0; h < HORIZON; h++) shift[h] -= IMIT_BOUNCE_FRAC * lm * ((h + 1) / HORIZON);
  }
  const rows: number[][] = [];
  for (let h = 0; h < HORIZON; h++) {
    const row = q[h].map((v) => q6(v + shift[h])).sort((a, b) => a - b);
    rows.push(row);
  }
  return rows;
}

// ---- parametric z-model quantiles (matches ens_c.build_z_sumrev) ----
// NOTE: the base is q6-rounded, then delta is added and the row sorted
// WITHOUT re-rounding (matches the Python exactly).
function zQuantiles(prices: number[], f: number): number[][] {
  const p = prices;
  const x = p[p.length - 1];
  const seg = p.length > Z_W ? p.slice(p.length - Z_W) : p;
  const d: number[] = [];
  for (let i = 1; i < seg.length; i++) d.push(seg[i] - seg[i - 1]);
  let sig: number;
  if (d.length >= 10) {
    const sorted = [...d].sort((a, b) => a - b);
    const lo = quantile(sorted, Z_WINSOR_Q);
    const hi = quantile(sorted, 1 - Z_WINSOR_Q);
    for (let k = 0; k < d.length; k++) d[k] = Math.min(hi, Math.max(lo, d[k]));
    sig = Math.max(Z_FLOOR, popStd(d));
  } else {
    sig = 0.0025;
  }
  const zz = Z.map((z) => z * Z_K);
  const delta = (x * f - x) * SUM_POWER;
  const rows: number[][] = [];
  for (let h = 1; h <= HORIZON; h++) {
    const sq = Math.sqrt(h);
    const row = zz.map((z) => q6(x + sq * z * sig));
    const shifted = row.map((v) => v + delta).sort((a, b) => a - b);
    rows.push(shifted);
  }
  return rows;
}

// ---- adaptive scale windowed variance (matches garch_b._win_var) ----
function winVar(p: number[], W: number): number {
  const arr = p.length > W ? p.slice(p.length - W - 1) : p;
  let ss = 0;
  let n = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    ss += d * d;
    n++;
  }
  return n > 0 ? ss / n : 0;
}

interface MarketIn { id: string; prices: number[]; }

function forecastCaseS2a(markets: MarketIn[]): Record<string, number[][]> {
  const sum = markets.reduce((s, m) => s + m.prices[m.prices.length - 1], 0);
  let f = sum > 0 ? 1 / sum : 1;
  f = Math.min(SUM_CLAMP_HI, Math.max(SUM_CLAMP_LO, f));
  const out: Record<string, number[][]> = {};
  for (const m of markets) {
    const c1 = hasymQuantiles(m.prices, f);
    const c2 = imitQuantiles(b2Quantiles(m.prices, f), m.prices);
    const c3 = zQuantiles(m.prices, f);
    // equal-weight blend (1/3 each), sort, clip
    const blended: number[][] = [];
    for (let h = 0; h < HORIZON; h++) {
      const row: number[] = [];
      for (let j = 0; j < 5; j++) {
        row.push((c1[h][j] + c2[h][j] + c3[h][j]) / 3);
      }
      row.sort((a, b) => a - b);
      blended.push(row.map((v) => Math.min(1, Math.max(0, v))));
    }
    // adaptive scale around the median
    const vr = winVar(m.prices, SCALE_RECENT);
    const vl = winVar(m.prices, SCALE_LONG);
    let scale = vl > 0 ? Math.sqrt(vr / vl) : 1.0;
    scale = Math.min(SCALE_HI, Math.max(SCALE_LO, scale));
    const scaled: number[][] = blended.map((row) => {
      const med = row[2];
      const r = row.map((v) => med + (v - med) * scale);
      r.sort((a, b) => a - b);
      return r.map((v) => Math.min(1, Math.max(0, v)));
    });
    out[m.id] = scaled;
  }
  return out;
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outputDir, { recursive: true });

const files = readdirSync(inputDir).filter((f) => f.endsWith(".in")).sort();
for (const file of files) {
  const data = JSON.parse(readFileSync(join(inputDir, file), "utf-8"));
  const fc = forecastCaseS2a(data.markets);
  const forecasts = data.markets.map((m: MarketIn) => ({ id: m.id, q: fc[m.id] }));
  const outFile = file.replace(/\.in$/, ".out");
  writeFileSync(join(outputDir, outFile), JSON.stringify({ forecasts }));
}
