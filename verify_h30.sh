#!/bin/bash
# Verify the S2a+h30 TypeScript against the Python overlay.
set -e
KIT="$HOME/workspace/makefun/nvidia-forecast-kit/polymarket-nvidia-ceo-forecast-01-kit"
REPO="$HOME/workspace/makefun/makefun-nvidia-forecast"
WORK="$HOME/workspace/makefun/nvidia-forecast"
OUT="$WORK/h30-out"; OUT2="$WORK/h30-out2"; XOUT="/tmp/h30-xout"
rm -rf "$OUT" "$OUT2" "$XOUT" && mkdir -p "$OUT" "$OUT2" "$XOUT"
cd "$REPO"
START=$(date +%s%N)
MAKEFUN_INPUT_DIR="$KIT/input" MAKEFUN_OUTPUT_DIR="$OUT" node --experimental-strip-types main-s2a-h30.ts 2>/dev/null
END=$(date +%s%N)
echo "runtime_ms_total: $(( (END-START)/1000000 )) (6 practice cases)"
MAKEFUN_INPUT_DIR="$KIT/input" MAKEFUN_OUTPUT_DIR="$OUT2" node --experimental-strip-types main-s2a-h30.ts 2>/dev/null
diff -r "$OUT" "$OUT2" && echo "DETERMINISTIC: two runs byte-identical"
echo "--- output sizes (limit 1048576) ---"; ls -la "$OUT"
cd "$WORK"
python3 - "$OUT" <<'PY'
import sys
sys.path.insert(0, ".")
from scorer import score
outdir = sys.argv[1]
iw, med, cov, valid, per = score(outdir)
print(f"H30-TS PRACTICE LOSS_MEAN {iw:.6f}  MEDIAN_ERR {med:.4f}  COVERAGE {cov:.4f}  VALID {valid}")
print("PER_CASE " + " ".join(f"{c}={per[c]:.6f}" for c in ("p00","p01","p02","p03","p04","p05")))
print("TARGET: practice 0.256439 (Python) | S2a 0.257626")
PY
MAKEFUN_INPUT_DIR=/tmp/s2a-xin MAKEFUN_OUTPUT_DIR="$XOUT" node --experimental-strip-types "$REPO/main-s2a-h30.ts" 2>/dev/null
python3 - <<'PY'
import sys, json
sys.path.insert(0, ".")
import numpy as np
from eval12 import load_answers
from scorer import pinball, TAU
vals = []
for cid in ("x00","x01","x02","x03","x04","x05"):
    ans = load_answers(cid)
    fc = json.load(open(f"/tmp/h30-xout/{cid}.out"))
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
print(f"H30-TS EXTRA mean {float(np.mean(vals)):.6f}  (Python target 2.222035 | S2a 2.254139)")
PY
