# suzanne-lite

Version web/VPS de Suzanne centrée uniquement sur le suivi quotidien : comptes, dépenses, revenus, catégories, budgets et récurrents.

Contrairement au repo `Suzanne` historique, ce projet ne contient pas la partie PEA/investissements et ne dépend pas de Tauri. Il suit le standard VPS : Docker Compose, Postgres commun, réseau `proxy`, Caddy global.

## Stack

- Frontend : React + Vite + TypeScript
- Backend : Express + Prisma + Zod
- DB : PostgreSQL
- Déploiement : Docker Compose dans `/opt/stacks/suzanne-lite`

## Modules MVP

- Comptes avec solde initial
- Plusieurs utilisateurs isolés
- Institutions bancaires
- Catégories dépenses/revenus
- Transactions quotidiennes avec filtre mensuel
- Budgets mensuels par catégorie
- Transactions récurrentes mensuelles
- Règles d'auto-catégorisation par mot-clé
- Objectifs d'épargne
- Snapshots de solde par compte
- Import CSV simple avec application des règles
- Export CSV des transactions et sauvegarde JSON
- Recherche globale
- Dashboard mensuel : solde estimé, revenus, dépenses, net et ventilation par catégorie

## Hors périmètre

- PEA
- CTO
- actifs financiers
- dividendes
- allocation/rebalancing
- données de marché

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
