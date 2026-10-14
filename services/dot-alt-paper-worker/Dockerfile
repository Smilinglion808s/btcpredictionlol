FROM python:3.12-slim
RUN groupadd -g 10002 alt && useradd -u 10002 -g 10002 -m alt
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY alt ./alt
ENV DATA_DIR=/tmp/dot-alt
# Starts as root only to create/chown DATA_DIR/events, then drops to uid 10002 (alt/entry.py).
CMD ["python", "-m", "alt.entry"]
