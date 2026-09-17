# CPST Party — production image. Rooms live in memory, so run exactly one instance,
# and mount persistent storage at /data for the SQLite database (a Railway volume, or
# `docker run -v cpst-party-data:/data`). No VOLUME/HEALTHCHECK here: Railway rejects VOLUME
# and runs its own health check on /healthz (see railway.json).
# Runs as the image's default (root) user: platform volumes such as Railway's are mounted
# root-owned, so a non-root user couldn't write the database.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

RUN mkdir -p /data
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/party.db \
    TRUST_PROXY=1
EXPOSE 3000

CMD ["node", "server/main.ts"]
