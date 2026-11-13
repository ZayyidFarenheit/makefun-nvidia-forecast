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
| b2 | market besar (x>=0.05) offsets ×1.15 | 0.405920 | 0.314291 | 0.372810 | 0.311667 | 0.197089 | 0.115777 | 0.276910 | 0.8258 | 0.7537 | TERIMA (mean -0.0014, p03 +0.002 / p05 +0.003, tidak tajam) |
| c1 | histori pendek (<720 mnt) offsets ×1.25 | 0.404752 | 0.320125 | 0.372810 | 0.306411 | 0.195977 | 0.118762 | 0.277010 | 0.8382 | 0.7537 | TOLAK (mean +0.0001, p01 +0.006) — revert |
| c2 | histori pendek (<720 mnt) offsets ×0.8 | 0.416788 | 0.313410 | 0.372810 | 0.316360 | 0.199086 | 0.113626 | 0.279207 | 0.8116 | 0.7537 | TOLAK (mean +0.0023, p00/p03 memburuk) — revert; penskalaan lebar band untuk histori pendek tidak membantu dua arah |
| d1 | kalibrasi lebar per-market (rolling-origin, 3 titik) | — | — | — | — | — | — | 0.277959 | 0.815 | 0.7537 | TOLAK (mean +0.0010 vs b2; pengali terpilih tidak stabil antar case) — prototipe Python, tidak di-port ke TS |
| d2 | kalibrasi lebar global per-case (rolling-origin, pooled) | — | — | — | — | — | — | 0.281700 | 0.797 | 0.7537 | TOLAK (mean +0.0048; pengali terpilih berayun 0.7–1.3 antar case — lebar optimal 4h lalu tidak berpindah ke 4h berikut) — prototipe Python, tidak di-port ke TS |

Kesimpulan temuan (a)–(d):
- (a) Volatilitas: jendela 16h/24h lebih buruk dari 12h; jendela 8h membaik di rata-rata tapi p02 memburuk tajam (ditolak aturan); winsorize kuantil no-op; **winsorize absolut ±0.10 diterima (-0.0040)**.
- (b) Ukuran market: **kecil (x<0.02) ×0.7 diterima (-0.0015); besar (x≥0.05) ×1.15 diterima (-0.0014)**.
- (c) Histori pendek: penskalaan lebar dua arah gagal (×1.25: +0.0001; ×0.8: +0.0023).
- (d) Kalibrasi conformal lebar band: gagal dua bentuk (per-market +0.0010; global +0.0048). Lebar optimal pada 4h lalu tidak berpindah ke 4h berikut (regim berubah).

Versi terbaik: **b2 — 0.276910** (v2 + winsorize ±0.10 + kecil ×0.7 + besar ×1.15). Target <0.268 dan <0.250 TIDAK tercapai. Berhenti setelah 4 iterasi berturut-turut tidak membaik (c1, c2, d1, d2).
