FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY core ./core
COPY config ./config
COPY http ./http
COPY runtime ./runtime
COPY providers/kawasaki/adapter.js providers/kawasaki/config.js providers/kawasaki/attribution.js providers/kawasaki/context.js providers/kawasaki/position-reference.js ./providers/kawasaki/
COPY generated/p0-static.json ./generated/p0-static.json
USER node
EXPOSE 8080
CMD ["node", "runtime/start.js"]
