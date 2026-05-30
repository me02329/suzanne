# suzanne-lite

[![CI](https://github.com/me02329/suzanne-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/me02329/suzanne-lite/actions/workflows/ci.yml)

> Application personnelle de suivi de finances quotidiennes : comptes, transactions, budgets, catégories, récurrents, objectifs d'épargne, statistiques et import/export.

suzanne-lite est une application web auto-hébergée, pensée pour suivre simplement les flux du quotidien : *« combien j'ai dépensé ce mois-ci, sur quels postes, depuis quels comptes, et quels mouvements restent à catégoriser ? »*

📖 **Pour apprendre à utiliser l'application, voir le [guide d'utilisation](docs/UTILISATION.md).**

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Périmètre](#périmètre)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Démarrage rapide (dev)](#démarrage-rapide-dev)
- [Validation](#validation)
- [Déploiement (VPS)](#déploiement-vps)
- [Variables d'environnement](#variables-denvironnement)
- [Référence API](#référence-api)
- [Sécurité](#sécurité)

---

## Fonctionnalités

- **Tableau de bord mensuel** — revenus, dépenses, net, solde estimé, comptes, ventilation par catégorie et évolution des flux.
- **Transactions** — dépenses, revenus et transferts, filtre par mois, recherche, édition inline du compte/de la catégorie, sélection multiple et modification en lot.
- **Comptes** — comptes bancaires, livrets, investissements, crypto, espèces, crédits et emprunts, avec devises et regroupement par type.
- **Snapshots de solde** — suivi de soldes datés par compte, avec saisie individuelle ou batch.
- **Catégories** — catégories dépenses/revenus personnalisables, couleurs et icônes.
- **Budgets** — limites mensuelles par catégorie, avec suivi du dépensé.
- **Transactions récurrentes** — charges ou revenus réguliers, génération automatique et liaison à une transaction existante.
- **Règles d'auto-catégorisation** — mots-clés appliqués à l'import CSV.
- **Statistiques** — répartition par catégorie, top marchands, évolution mensuelle des dépenses et prise en charge des non-catégorisées.
- **Objectifs d'épargne** — suivi d'objectifs avec montant cible, progression et échéance.
- **Import / Export** — import CSV configurable, export CSV des transactions et sauvegarde JSON complète.
- **Confort** — multi-utilisateurs, recherche globale, devise de reporting, interface responsive.

Interface entièrement en français.

## Périmètre

suzanne-lite est volontairement centrée sur le suivi quotidien. Elle ne remplace pas les applications patrimoniales ou de courtage.

Hors périmètre :

- PEA, CTO et suivi de positions boursières ;
- dividendes, allocation, rebalancing ;
- récupération de cours de marché ;
- authentification applicative intégrée.

Pour le suivi PEA, voir le projet séparé `njord`.

## Stack technique

| Couche | Technologies |
|---|---|
| Backend | Node 20, Express, Prisma (PostgreSQL), Zod, TypeScript |
| Frontend | React 18, Vite, TypeScript, Recharts, lucide-react |
| Monorepo | npm workspaces — `shared/` (DTO et taxonomies), `backend/`, `frontend/` |
| Déploiement | Docker multi-stage, Docker Compose, migrations Prisma au démarrage |

## Architecture

```
shared/      types partagés back ↔ front, taxonomie des comptes
backend/     API Express + Prisma + import/export + agrégations
frontend/    SPA React (servie en prod par le backend en statique)
```

En production, **un seul conteneur** Node sert l'API (`/api/*`), le healthcheck (`/healthz`) et le bundle frontend. Les migrations Prisma sont appliquées au démarrage (`prisma migrate deploy`).

## Démarrage rapide (dev)

**Prérequis :** Node.js 20+, un PostgreSQL accessible.

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer la base
cp .env.example .env          # puis éditer DATABASE_URL si besoin

# 3. Lancer un Postgres local jetable
docker compose -f compose.dev.yml up -d postgres

# 4. Migrer et créer les données de départ
npm run migrate:dev -w @suzanne-lite/backend
npm run db:seed

# 5. Lancer backend (port 3000) et frontend (port 5173) dans deux terminaux
npm run dev:backend
npm run dev:frontend
# Vite proxie /api -> http://localhost:3000 — ouvrir http://localhost:5173
```

Pour valider la chaîne conteneur + migrations + healthcheck :

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/healthz      # {"status":"ok","db":true}
```

## Validation

```bash
npm test
npm run build
```

La suite Vitest couvre les helpers partagés, la validation backend, les formats de dates/montants et les utilitaires frontend purs. Le build compile les types partagés, le frontend et le backend, puis génère le client Prisma.

## Déploiement (VPS)

> ⚠️ suzanne-lite n'a **aucune authentification intégrée**. Déploie-la derrière un VPN, un reverse-proxy avec authentification, ou sur une interface privée.

Le fichier `compose.yml` attend un PostgreSQL joignable via `DATABASE_URL` et un réseau Docker externe nommé `proxy`.

```bash
cd /opt/stacks
gh repo clone me02329/suzanne-lite suzanne-lite
cd suzanne-lite

cat > .env <<ENV
DATABASE_URL=postgres://suzanne:<password>@postgres:5432/suzanne
ENV

docker compose up -d --build
docker compose exec -T suzanne-lite sh -c 'cd backend && npx prisma db seed'
curl http://127.0.0.1:3000/healthz
```

Exemple Caddy :

```caddy
finance.example.internal {
    tls internal
    reverse_proxy suzanne-lite:3000
}
```

Exemple CoreDNS :

```txt
10.0.0.10 finance.example.internal
```

### Mise à jour

```bash
git pull
docker compose up -d --build
docker image prune -f
```

Les migrations sont appliquées automatiquement au démarrage du conteneur.

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `DATABASE_URL` | *(requis)* | URL PostgreSQL (`postgres://user:pwd@host:5432/db`) |
| `PORT` | `3000` | Port HTTP interne |
| `NODE_ENV` | `development` | `production` en prod |
| `AI_API_KEY` / `OPENAI_API_KEY` | *(vide)* | Clé API utilisée par l'assistant IA |
| `AI_MODEL` | `gpt-4.1-mini` | Modèle compatible Chat Completions |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Endpoint OpenAI-compatible (OpenAI, proxy, local, etc.) |

## Référence API

Toutes les routes métier sont préfixées par `/api`.

| Verbe | Route | Description |
|---|---|---|
| GET | `/healthz` | Healthcheck (ping DB) |
| GET / POST | `/api/users` | Lister / créer un utilisateur |
| DELETE | `/api/users/:id` | Supprimer un utilisateur |
| GET / POST | `/api/users/:user_id/accounts` | Lister / créer les comptes |
| PATCH / DELETE | `/api/users/:user_id/accounts/:id` | Modifier / supprimer un compte |
| GET / POST | `/api/users/:user_id/institutions` | Lister / créer les institutions |
| DELETE | `/api/users/:user_id/institutions/:id` | Supprimer une institution |
| GET / POST | `/api/users/:user_id/categories` | Lister / créer les catégories |
| PATCH / DELETE | `/api/users/:user_id/categories/:id` | Modifier / supprimer une catégorie |
| GET / POST | `/api/users/:user_id/transactions` | Lister / créer les transactions |
| PATCH / DELETE | `/api/users/:user_id/transactions/:id` | Modifier / supprimer une transaction |
| POST | `/api/users/:user_id/transactions/:id/link-recurring` | Lier / délier une transaction récurrente |
| GET / POST | `/api/users/:user_id/budgets` | Lister / définir les budgets |
| DELETE | `/api/users/:user_id/budgets/:id` | Supprimer un budget |
| GET / POST | `/api/users/:user_id/recurring-transactions` | Lister / créer les récurrents |
| PATCH / DELETE | `/api/users/:user_id/recurring-transactions/:id` | Modifier / supprimer un récurrent |
| POST | `/api/users/:user_id/recurring-transactions/generate` | Générer les récurrents actifs |
| GET / POST | `/api/users/:user_id/category-rules` | Lister / créer les règles |
| DELETE | `/api/users/:user_id/category-rules/:id` | Supprimer une règle |
| GET / POST | `/api/users/:user_id/savings-goals` | Lister / créer les objectifs |
| PATCH / DELETE | `/api/users/:user_id/savings-goals/:id` | Modifier / supprimer un objectif |
| GET / POST | `/api/users/:user_id/account-snapshots` | Lister / créer les snapshots |
| POST | `/api/users/:user_id/account-snapshots/batch` | Saisir plusieurs snapshots |
| DELETE | `/api/users/:user_id/account-snapshots/:id` | Supprimer un snapshot |
| GET | `/api/users/:user_id/dashboard` | Résumé mensuel |
| GET | `/api/users/:user_id/wealth-history` | Historique de patrimoine |
| GET | `/api/users/:user_id/statistics` | Statistiques long terme |
| GET | `/api/users/:user_id/search` | Recherche globale |
| POST | `/api/users/:user_id/ai/chat` | Assistant IA avec tools lecture/action confirmée |
| POST | `/api/users/:user_id/ai/confirm` | Confirmer une action proposée par l'IA |
| POST | `/api/users/:user_id/import.csv` | Import CSV de transactions |
| GET | `/api/users/:user_id/transactions.csv` | Export CSV des transactions |
| GET | `/api/users/:user_id/export.json` | Sauvegarde JSON |

## Sécurité

suzanne-lite **n'embarque pas d'authentification applicative** : toute personne capable d'atteindre l'application a accès aux données de tous les utilisateurs configurés. C'est un choix assumé pour un usage personnel sur réseau privé.

En conséquence :

- ne l'expose **jamais** directement sur Internet ;
- place-la derrière un VPN (WireGuard, Tailscale...), un reverse-proxy avec authentification, ou une interface privée ;
- garde `.env` hors Git : il contient la connexion PostgreSQL ;
- fais des exports JSON réguliers si la base contient des données importantes.

La suppression d'un utilisateur efface ses données liées via les contraintes de base.

### Token d'accès optionnel (`APP_TOKEN`)

Pour une couche de protection légère — utile notamment parce que l'assistant IA consomme la clé OpenAI à chaque requête —, tu peux définir la variable d'environnement `APP_TOKEN` côté backend :

- **non définie** → comportement historique, aucune auth ;
- **définie** → toute requête `/api/*` doit présenter l'en-tête `Authorization: Bearer <APP_TOKEN>`, sinon `401`. Au premier `401`, le frontend ouvre un modal de saisie ; le token est ensuite stocké en `localStorage` et envoyé sur chaque requête.

Ce n'est **pas** de la gestion d'utilisateurs : juste un secret partagé. Les téléchargements directs (`export.json`, `transactions.csv`) ouverts via un lien `<a>` ne portent pas l'en-tête et ne fonctionneront donc pas tant que `APP_TOKEN` est défini — utilise l'export sélectif depuis l'interface dans ce cas.
