#!/bin/bash
# Verify the S2a TypeScript against the Python prototypes:
# practice (scorer.py) + extra cases + determinism + runtime + size.
set -e
KIT="$HOME/workspace/makefun/nvidia-forecast-kit/polymarket-nvidia-ceo-forecast-01-kit"
REPO="$HOME/workspace/makefun/makefun-nvidia-forecast"
WORK="$HOME/workspace/makefun/nvidia-forecast"
OUT="$WORK/s2a-out"; OUT2="$WORK/s2a-out2"; XIN="/tmp/s2a-xin"; XOUT="/tmp/s2a-xout"
rm -rf "$OUT" "$OUT2" "$XIN" "$XOUT" && mkdir -p "$OUT" "$OUT2" "$XIN" "$XOUT"
cd "$REPO"
START=$(date +%s%N)
MAKEFUN_INPUT_DIR="$KIT/input" MAKEFUN_OUTPUT_DIR="$OUT" node --experimental-strip-types main-s2a.ts 2>/dev/null
END=$(date +%s%N)
echo "runtime_ms_total: $(( (END-START)/1000000 )) (6 practice cases)"
MAKEFUN_INPUT_DIR="$KIT/input" MAKEFUN_OUTPUT_DIR="$OUT2" node --experimental-strip-types main-s2a.ts 2>/dev/null
diff -r "$OUT" "$OUT2" && echo "DETERMINISTIC: two runs byte-identical"
echo "--- output sizes (limit 1048576) ---"; ls -la "$OUT"
cd "$WORK"
python3 - "$OUT" <<'PY'
import sys, json
sys.path.insert(0, ".")
from scorer import score
outdir = sys.argv[1]
iw, med, cov, valid, per = score(outdir)
print(f"S2a-TS PRACTICE LOSS_MEAN {iw:.6f}  MEDIAN_ERR {med:.4f}  COVERAGE {cov:.4f}  VALID {valid}")
print("PER_CASE " + " ".join(f"{c}={per[c]:.6f}" for c in ("p00","p01","p02","p03","p04","p05")))
print("TARGET: practice 0.257626 (Python) | b2 0.276910")
PY
# extra cases: build .in files, run TS, score
python3 - <<'PY'
import json, os
d = json.load(open("extra-cases.json"))
os.makedirs("/tmp/s2a-xin", exist_ok=True)
for cid, c in d.items():
    markets = [{"id": m["id"], "prices": m["prices"]} for m in c["markets"]]
    json.dump({"markets": markets}, open(f"/tmp/s2a-xin/{cid}.in", "w"))
print("extra .in files written")
PY
cd "$REPO"
MAKEFUN_INPUT_DIR="$XIN" MAKEFUN_OUTPUT_DIR="$XOUT" node --experimental-strip-types main-s2a.ts 2>/dev/null
cd "$WORK"
python3 - <<'PY'
import sys, json
sys.path.insert(0, ".")
import numpy as np
from eval12 import load_answers
from scorer import pinball, TAU
vals = []
for cid in ("x00","x01","x02","x03","x04","x05"):
    ans = load_answers(cid)
    fc = json.load(open(f"/tmp/s2a-xout/{cid}.out"))
    rows = {f["id"]: f["q"] for f in fc["forecasts"]}
    tot = n = 0.0
    for mid, v in ans.items():
        q = rows[mid]
        for h in range(240):
            y = v[h]
            if y is None: continue
            for j, tau in enumerate(TAU):
                tot += pinball(y, q[h][j], tau); n += 1
    vals.append(tot/n)
    print(f"  {cid} extra loss {tot/n:.6f}")
print(f"S2a-TS EXTRA mean {float(np.mean(vals)):.6f}  (Python target 2.254139 | b2 2.358)")
PY
