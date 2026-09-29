FROM python:3.12.13-slim
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 V2_MODE=record V2_DATA_DIR=/data/v2
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
COPY artifacts ./artifacts
WORKDIR /app/src
CMD ["python", "service.py"]
