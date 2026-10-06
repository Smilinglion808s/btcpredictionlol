FROM python:3.12.14-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package ./package
COPY risk_package ./risk_package
COPY src ./src
COPY tests ./tests

# Filtering defaults on; this does not enable signal delivery or betting.
ENV V3_DATA_DIR=/data/v3 V3_MODE=shadow V3_REVERSAL_MODE=enforce PORT=8080
EXPOSE 8080
CMD ["python", "src/service.py"]
