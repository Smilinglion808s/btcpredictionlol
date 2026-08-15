import json, numpy as np
from sklearn.preprocessing import RobustScaler
from sklearn.linear_model import LogisticRegression

def lcg(n):
    s = 123456789
    out = []
    for _ in range(n):
        s = (1103515245 * s + 12345) % (2**31)
        out.append(s / (2**31))
    return out

N, D = 400, 8
vals = lcg(N * D)
X = np.array(vals, dtype=float).reshape(N, D) * 2 - 1
X[:, 3] *= 0.001
y = ((X[:, 0] * 1.5 - X[:, 2] * 0.8 + X[:, 5] * 0.3) > 0).astype(int)
wraw = np.array([1.0 + (i % 7) * 0.1 for i in range(N)])
w = wraw / wraw.mean()
sc = RobustScaler(quantile_range=(10.0, 90.0)).fit(X)
Z = sc.transform(X)
lr = LogisticRegression(C=0.01, solver="lbfgs", max_iter=1000, tol=1e-4).fit(Z, y, sample_weight=w)
json.dump({
  "n": N, "d": D,
  "center": list(map(float, sc.center_)), "scale": list(map(float, sc.scale_)),
  "coefficients": list(map(float, lr.coef_[0])), "intercept": float(lr.intercept_[0]),
  "sklearn_version": __import__("sklearn").__version__,
}, open("src/lib/b4x4es1/__tests__/oracle-parity-fixture.json", "w"), indent=1)
print("ok")
