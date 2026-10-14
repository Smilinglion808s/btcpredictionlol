FROM python:3.12-slim
RUN useradd -u 10002 -m alt
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY alt ./alt
USER alt
ENV DATA_DIR=/tmp/dot-alt
CMD ["python", "-m", "alt.main"]
