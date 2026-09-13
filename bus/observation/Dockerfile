FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY observation/package.json observation/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY observation/package.json observation/package-lock.json ./
COPY core ./core
COPY config ./config
COPY departure ./departure
COPY position ./position
COPY runtime/static-artifact.js ./runtime/static-artifact.js
COPY providers/kawasaki/adapter.js providers/kawasaki/config.js providers/kawasaki/departure.js ./providers/kawasaki/
COPY observation ./observation
COPY generated/p0-static.json generated/p1-position-static.json ./generated/
USER node
CMD ["node", "observation/job.js"]
