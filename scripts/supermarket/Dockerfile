# Repository's pinned Node workflow base.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
RUN apt-get update && apt-get install -y --no-install-recommends imagemagick tesseract-ocr tesseract-ocr-jpn tesseract-ocr-eng ca-certificates chromium chromium-sandbox fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
# Official local OCR weights. Keep the existing OK language unchanged.
ADD --chmod=0644 --checksum=sha256:36bdf9ac823f5911e624c30d0553e890b8abc7c31a65b3ef14da943658c40b79 https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/4.1.0/jpn.traineddata /usr/share/tesseract-ocr/5/tessdata/jpn_best.traineddata
WORKDIR /app
COPY scripts/supermarket/browser-deps/package.json scripts/supermarket/browser-deps/package-lock.json /opt/paluru-browser/
RUN npm ci --prefix /opt/paluru-browser --omit=dev --ignore-scripts --no-audit --fund=false
COPY features/shopping/supermarket-poc.js features/shopping/supermarket-poc.js
COPY scripts/supermarket/collector.mjs scripts/supermarket/edition-discovery.mjs scripts/supermarket/whole-corpus-store.mjs scripts/supermarket/iy-ocr.mjs scripts/supermarket/yaoko-ocr.mjs scripts/supermarket/tokubai-ocr.mjs scripts/supermarket/browser.mjs scripts/supermarket/rosen-dom.mjs scripts/supermarket/rosen-policy.mjs scripts/supermarket/run-daily-gcs.mjs scripts/supermarket/
USER node
ENTRYPOINT ["node","scripts/supermarket/run-daily-gcs.mjs"]
