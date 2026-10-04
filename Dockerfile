# syntax = docker/dockerfile:1

FROM docker.io/library/node:24.21.0-slim
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY src/ src/
COPY public/ public/
COPY README.md ./
# /data is the Fly volume (a tmpfs in CI)
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "src/server.ts"]
