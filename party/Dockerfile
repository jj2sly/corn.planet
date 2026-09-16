# CPST Party — production image. Rooms live in memory, so run exactly one instance,
# and mount persistent storage at /data for the SQLite database.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

RUN mkdir -p /data && chown node:node /data
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/party.db \
    TRUST_PROXY=1
VOLUME ["/data"]
EXPOSE 3000

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/main.ts"]
