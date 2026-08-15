"""Pinned sklearn oracle for ES1 price-head fits.

Reproduces bundled artifacts exactly and mints new ones.
"""
import json, hashlib, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import numpy as np
import sklearn, scipy
from sklearn.preprocessing import RobustScaler
from sklearn.linear_model import LogisticRegression

TOL = 1e-4
MAX_ITER = 1000
C = 0.01
QR = (10.0, 90.0)
BOISE = ZoneInfo("America/Boise")


def day_weights(tss):
    days = [datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(BOISE).strftime("%Y-%m-%d") for t in tss]
    counts = {}
    for d in days:
        counts[d] = counts.get(d, 0) + 1
    raw = np.array([1.0 / counts[d] for d in days])
    return raw / raw.mean()


def fit(rows):
    X = np.array([r["vector"] for r in rows], dtype=float)
    y = np.array([r["label"] for r in rows], dtype=int)
    w = day_weights([r["targetTs"] for r in rows])
    sc = RobustScaler(quantile_range=QR).fit(X)
    Z = sc.transform(X)
    lr = LogisticRegression(C=C, solver="lbfgs", max_iter=MAX_ITER, tol=TOL,
                            fit_intercept=True, penalty="l2", class_weight=None)
    lr.fit(Z, y, sample_weight=w)
    return sc, lr, rows


def artifact(boundary, rows, sc, lr, fingerprint):
    return {
        "boundary": boundary,
        "trainingRowCount": len(rows),
        "trainingStartTs": rows[0]["targetTs"],
        "trainingEndTs": rows[-1]["targetTs"],
        "trainingStartIndex": rows[0]["index"],
        "trainingEndIndex": rows[-1]["index"],
        "windowFingerprint": fingerprint,
        "center": list(map(float, sc.center_)),
        "scale": list(map(float, sc.scale_)),
        "coefficients": list(map(float, lr.coef_[0])),
        "intercept": float(lr.intercept_[0]),
    }


def main():
    data = json.load(open("/tmp/es1/window.json"))
    existing = {f["boundary"]: f for f in json.load(open("src/lib/b4x4es1/frozen-fits.json"))["fits"]}
    out = {}
    for blk in data["boundaries"]:
        b = blk["boundary"]
        sc, lr, rows = fit(blk["rows"])
        a = artifact(b, rows, sc, lr, blk["fingerprint"])
        out[b] = a
        if b in existing:
            e = existing[b]
            for k in ("center", "scale", "coefficients"):
                d = float(np.max(np.abs(np.array(a[k]) - np.array(e[k]))))
                print(f"boundary {b} {k} maxabsdiff {d:.3e}")
            print(f"boundary {b} intercept diff {abs(a['intercept'] - e['intercept']):.3e}")
            print(f"boundary {b} fingerprint match {a['windowFingerprint'] == e['windowFingerprint']}")
        else:
            print(f"boundary {b} NEW", json.dumps(a)[:200])
    json.dump({
        "oracle": {
            "sklearn": sklearn.__version__,
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "tol": TOL, "max_iter": MAX_ITER, "C": C, "quantile_range": list(QR),
        },
        "fits": out,
    }, open("/tmp/es1/oracle_fits.json", "w"), indent=1)


if __name__ == "__main__":
    main()
