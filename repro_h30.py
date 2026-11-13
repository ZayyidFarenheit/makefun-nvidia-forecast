"""Independent reproduction of the persist_med_h30 overlay (M2 Validation C2).
Overlay: for h<=30, set the median to the last price x0 and shift the whole
band by the same delta; for h>30, S2a unchanged. No fitted parameters.
S2a is rebuilt from the prototypes (synth2), NOT taken from a cache."""
import numpy as np
from synth2 import s1, apply_scale
from common_c import score_forecasts, fmt, CASES, PRACTICE

s2a = apply_scale(s1)

def overlay(fc_by_case, h_cut):
    out = {}
    for cid, case in CASES.items():
        out[cid] = {}
        for m in case["markets"]:
            mid = m["id"]; x0 = float(m["prices"][-1])
            q = np.asarray(fc_by_case[cid][mid], dtype=float)
            new_med = q[:, 2].copy()
            new_med[:h_cut] = x0
            delta = new_med - q[:, 2]
            out[cid][mid] = np.sort(np.clip(q + delta[:, None], 0, 1), axis=1)
    return out

fmt("S2a (rebuilt, reference)", score_forecasts(s2a))
fmt("persist_med_h30", score_forecasts(overlay(s2a, 30)))
fmt("persist_med_all", score_forecasts(overlay(s2a, 240)))
