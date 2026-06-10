# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++ openssl
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm install --no-audit --no-fund

COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl tini wget
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Plafonne le heap V8 : GC plus agressif, RAM résidente bornée. Largement
# suffisant pour l'app (les pics viennent des gros imports JSON) ;
# surchargeable via l'environnement du conteneur si besoin.
ENV NODE_OPTIONS="--max-old-space-size=128"

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/prisma.config.ts ./backend/prisma.config.ts
COPY --from=build /app/frontend/dist ./backend/public
COPY --from=build /app/node_modules ./node_modules

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget --quiet --spider http://localhost:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "cd /app/backend && npx --no -- prisma migrate deploy && cd /app && node backend/dist/server.js"]
