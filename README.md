# suzanne-lite

Version web/VPS de Suzanne centrée uniquement sur le suivi quotidien : comptes, dépenses, revenus, catégories, budgets et récurrents.

Contrairement au repo `Suzanne` historique, ce projet ne contient pas la partie PEA/investissements et ne dépend pas de Tauri. Il suit le standard VPS : Docker Compose, Postgres commun, réseau `proxy`, Caddy global.

## Stack

- Frontend : React + Vite + TypeScript
- Backend : Express + Prisma + Zod
- DB : PostgreSQL
- Déploiement : Docker Compose dans `/opt/stacks/suzanne-lite`

## Modules MVP

- Comptes
- Catégories dépenses/revenus
- Transactions quotidiennes
- Budgets mensuels
- Transactions récurrentes
- Dashboard mensuel

## Développement

```bash
npm install
cp .env.example .env
npm run migrate:dev -w @suzanne-lite/backend
npm run db:seed
npm run dev:backend
npm run dev:frontend
```

## VPS

```bash
cd /opt/stacks
gh repo clone me02329/suzanne-lite suzanne-lite
cd suzanne-lite
cat > .env <<ENV
DATABASE_URL=postgres://suzanne:<password>@postgres:5432/suzanne
ENV
docker compose up -d --build
docker compose exec -T suzanne-lite sh -c 'cd backend && npx prisma db seed'
```

Caddy :

```caddy
finance.example.internal {
    tls internal
    reverse_proxy suzanne-lite:3000
}
```

CoreDNS :

```txt
10.0.0.10 finance.example.internal
```
