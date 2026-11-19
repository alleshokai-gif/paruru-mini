# Repository's pinned Node workflow base.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
RUN apt-get update && apt-get install -y --no-install-recommends imagemagick tesseract-ocr tesseract-ocr-jpn tesseract-ocr-eng ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY features/shopping/supermarket-poc.js features/shopping/supermarket-poc.js
COPY scripts/supermarket/collector.mjs scripts/supermarket/ok-ocr.mjs scripts/supermarket/run-daily-gcs.mjs scripts/supermarket/
USER node
ENTRYPOINT ["node","scripts/supermarket/run-daily-gcs.mjs"]
