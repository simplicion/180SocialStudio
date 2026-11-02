# trend-worker: last30days (pinned) + Scrapling HTTP fetcher behind a small FastAPI app.
# Built and run by docker-compose on the internal network only (no published port).
FROM python:3.12-slim

ARG LAST30DAYS_REF=v3.31.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# last30days has no runtime dependencies; a shallow, pinned checkout without git metadata is enough.
RUN git clone --depth 1 --branch "${LAST30DAYS_REF}" https://github.com/mvanhorn/last30days-skill /opt/last30days \
    && rm -rf /opt/last30days/.git

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

RUN useradd --system --uid 10001 --home-dir /home/worker --create-home worker
USER worker

ENV LAST30DAYS_SCRIPT=/opt/last30days/skills/last30days/scripts/last30days.py \
    PYTHONUNBUFFERED=1
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:4010/health',timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4010"]
