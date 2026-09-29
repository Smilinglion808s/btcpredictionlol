FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package ./package
COPY seed ./seed
COPY src ./src
COPY tests ./tests

ENV V2_MODE=shadow V2_DATA_DIR=/data/v2 PORT=8080
EXPOSE 8080

# Recording only. No exchange or betting credentials are used by this image.
CMD ["python", "src/service.py"]
