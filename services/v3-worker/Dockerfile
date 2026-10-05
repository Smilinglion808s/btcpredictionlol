FROM python:3.12.14-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package ./package
COPY src ./src
COPY tests ./tests

# Capture-only by default: V3_DELIVERY_ENABLED is unset, so nothing is POSTed.
ENV V3_DATA_DIR=/data/v3 V3_MODE=shadow PORT=8080
EXPOSE 8080
CMD ["python", "src/service.py"]
