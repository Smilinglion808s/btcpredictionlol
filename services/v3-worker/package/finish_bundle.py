from pathlib import Path
import hashlib
import json
import platform
import zipfile
import numpy
import pandas
import scipy
import sklearn

root = Path(__file__).resolve().parent
(root / "environment.json").write_text(json.dumps({"python": platform.python_version(),
    "numpy": numpy.__version__, "pandas": pandas.__version__, "scipy": scipy.__version__,
    "scikit-learn": sklearn.__version__}, indent=2))
files = sorted(p for p in root.iterdir() if p.is_file() and p.name != "SHA256.json")
(root / "SHA256.json").write_text(json.dumps({p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, indent=2))
target = root.parent / "V3_PF_E008_Verified_Handoff_20261005.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for p in files + [root / "SHA256.json"]:
        archive.write(p, p.name)
print(target, target.stat().st_size)
