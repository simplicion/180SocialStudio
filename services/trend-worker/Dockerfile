# trend-worker: last30days (pinned) + keyless web search (ddgs / SearXNG) + Scrapling HTTP fetcher, with a
# Playwright Chromium render fallback for JavaScript-only pages, behind a small FastAPI app.
# Built and run by docker-compose on the internal network only (no published port).
FROM python:3.12-slim

ARG LAST30DAYS_REF=v3.31.0
# 0 builds a smaller image without Chromium (the render fallback then stays off).
ARG WITH_BROWSER=1

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

# Chromium and its system libraries, in a shared path the unprivileged user can read.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN if [ "$WITH_BROWSER" = "1" ]; then python -m playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*; fi

RUN useradd --system --uid 10001 --home-dir /home/worker --create-home worker
USER worker

ENV LAST30DAYS_SCRIPT=/opt/last30days/skills/last30days/scripts/last30days.py \
    PYTHONUNBUFFERED=1 \
    TREND_WORKER_BROWSER=${WITH_BROWSER}
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:4010/health',timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4010"]
