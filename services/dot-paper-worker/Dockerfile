# Image digest must be recorded after the first approved build.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DOT_PAPER_BIND=0.0.0.0 DOT_PAPER_DATA_DIR=/data/dot-paper/ledger
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && groupadd -g 10001 paper && useradd -r -u 10001 -g paper paper && mkdir -p /data/dot-paper
COPY worker ./worker
USER root
EXPOSE 8080
CMD ["python", "-I", "/app/worker/bootstrap.py"]
