FROM node:22.22.1-bookworm-slim@sha256:ad8cfb998dd04bf13fa3434fd1497524222cc6d8ad04e5988926471aeef5b074

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src

USER 65532:65532
EXPOSE 8080
CMD ["node", "src/server.js"]
