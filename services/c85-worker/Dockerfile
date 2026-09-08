# C85 MULTI_META inference/training worker (c85-multi-meta-r1)
#
# The recovered auxiliary estimators are scikit-learn pickles, so the numerical
# stack is pinned to the exact reference replay environment. Changing the Python
# minor version or any pinned package invalidates the parity gate.
FROM python:3.12.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    C85_ARTIFACT_DIR=/artifacts

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt

# Model artifacts. Unpack C85_Lovable_Kit.zip and place its `models/`,
# `fixtures/` and `feature_order.json` under ./artifacts before building, or
# mount a private artifact volume at /artifacts at runtime. These are NEVER
# shipped in the frontend bundle.
COPY artifacts/ /artifacts/

COPY src/ ./src/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["python", "-m", "src.main"]
