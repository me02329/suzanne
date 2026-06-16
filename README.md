# suzanne

> Application auto-hébergée de suivi de finances quotidiennes : comptes, transactions, budgets, catégories, tags, récurrents, objectifs d'épargne, prévisionnel, santé financière, statistiques, assistant IA optionnel et import/export.

suzanne est une application web auto-hébergée, pensée pour suivre simplement les flux du quotidien : *« combien j'ai dépensé ce mois-ci, sur quels postes, depuis quels comptes, et quels mouvements restent à catégoriser ? »*

📖 **Pour apprendre à utiliser l'application, voir le [guide d'utilisation](docs/UTILISATION.md).**

---

## Captures d'écran

> Thème sombre, interface entièrement en français. Captures réalisées sur un jeu de données de démonstration.

![Vue générale](docs/screenshots/dashboard.png)
<sub>**Vue générale** — valeur nette et trajectoire, KPI du mois, répartition des dépenses et suivi des budgets.</sub>

<table>
<tr>
<td width="50%"><img src="docs/screenshots/transactions.png" alt="Transactions"><br><sub><b>Transactions</b> — tableau dense, montants colorés par direction, pills de type, édition inline.</sub></td>
<td width="50%"><img src="docs/screenshots/statistics.png" alt="Statistiques"><br><sub><b>Statistiques</b> — répartition par catégorie, top marchands, évolution mensuelle.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/wealth.png" alt="Patrimoine"><br><sub><b>Patrimoine</b> — actifs / passifs / liquidités et évolution par compte.</sub></td>
<td width="50%"><img src="docs/screenshots/health.png" alt="Santé financière"><br><sub><b>Santé financière</b> — taux d'épargne, fonds d'urgence, charges fixes / variables.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/budgets.png" alt="Budgets"><br><sub><b>Budgets</b> — limites mensuelles par catégorie et alerte de dépassement.</sub></td>
<td width="50%"><img src="docs/screenshots/goals.png" alt="Objectifs"><br><sub><b>Objectifs</b> — progression vers les objectifs d'épargne et échéances.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/accounts.png" alt="Comptes"><br><sub><b>Comptes</b> — comptes regroupés par établissement, multi-devises.</sub></td>
<td width="50%"><img src="docs/screenshots/recurring.png" alt="Récurrents"><br><sub><b>Récurrents</b> — charges et revenus réguliers, cadences et génération.</sub></td>
</tr>
</table>

<details>
<summary>Plus de captures (Factures, Catégories, Tags)</summary>

![Factures](docs/screenshots/bills.png)
![Catégories](docs/screenshots/categories.png)
![Tags](docs/screenshots/tags.png)

</details>

---

## Sommaire

- [Captures d'écran](#captures-décran)
- [Fonctionnalités](#fonctionnalités)
- [Périmètre](#périmètre)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Démarrage rapide (dev)](#démarrage-rapide-dev)
- [Validation](#validation)
- [Contribuer](#contribuer)
- [Partager le dépôt](#partager-le-dépôt)
- [Déploiement (VPS)](#déploiement-vps)
- [Variables d'environnement](#variables-denvironnement)
- [Référence API](#référence-api)
- [Sécurité](#sécurité)
- [Licence](#licence)

---

## Fonctionnalités

- **Tableau de bord mensuel** — revenus, dépenses, net, solde estimé, comptes, ventilation par catégorie et évolution des flux.
- **Transactions** — dépenses, revenus et transferts, tags, filtre par mois, recherche, édition inline du compte/de la catégorie, sélection multiple et modification en lot.
- **Comptes** — comptes bancaires, livrets, investissements, crypto, espèces, crédits et emprunts, avec devises et regroupement par type.
- **Détail par compte** — historique de solde, mouvements récents, snapshots et alertes de plafond pour les livrets réglementés.
- **Snapshots de solde** — suivi de soldes datés par compte, avec saisie batch et pré-remplissage depuis le dernier solde connu.
- **Catégories** — catégories dépenses/revenus personnalisables, couleurs et icônes.
- **Tags** — étiquettes libres multi-valeurs sur les transactions, indépendantes des catégories.
- **Budgets** — limites mensuelles par catégorie, avec suivi du dépensé.
- **Transactions récurrentes / abonnements** — charges ou revenus réguliers, cadence hebdomadaire/mensuelle/annuelle, génération automatique et liaison à une transaction existante.
- **Prévisionnel** — projection du solde liquide à partir des récurrents actifs et des échéances d'objectifs.
- **Santé financière** — taux d'épargne, fonds d'urgence, poids des récurrents, charges fixes/variables et adhérence aux budgets.
- **Règles d'auto-catégorisation** — mots-clés appliqués à l'import CSV.
- **Statistiques** — répartition par catégorie, top marchands, évolution mensuelle des dépenses et prise en charge des non-catégorisées.
- **Objectifs d'épargne** — suivi d'objectifs avec montant cible, progression et échéance.
- **Import / Export** — import CSV configurable, exports rapides, export sélectif JSON réimportable et restauration JSON.
- **Assistant IA optionnel** — analyse et actions proposées avec confirmation utilisateur, compatible OpenAI ou endpoint Chat Completions équivalent.
- **Confort** — multi-utilisateurs, recherche globale, devise de reporting, raccourcis clavier, thème clair/sombre et interface responsive.

Interface entièrement en français.

## Périmètre

suzanne est volontairement centrée sur le suivi quotidien. Elle ne remplace pas les applications patrimoniales ou de courtage.

Hors périmètre :

- suivi de positions boursières ou de performance d'actifs ;
- dividendes, allocation, rebalancing ;
- récupération de cours de marché ;
- authentification multi-utilisateurs complète.

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
npm run migrate:dev -w @suzanne/backend
npm run db:seed

# 5. Lancer backend (port 3000) et frontend (port 5174) dans deux terminaux
npm run dev:backend
npm run dev:frontend
# Vite proxie /api -> http://localhost:3000 — ouvrir http://localhost:5174
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

## Contribuer

Les contributions sont bienvenues tant qu'elles respectent le périmètre self-host privé du projet. Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour les commandes de développement, les validations attendues et les règles sur les données personnelles.

## Partager le dépôt

Le dépôt est prévu pour être partagé sans données personnelles :

- `.env`, `.env.*`, `.data/`, `node_modules/`, les builds et les fichiers locaux d'assistants (`AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`, `.codex/`) sont ignorés ;
- `.env.example` contient uniquement des valeurs de développement génériques ;
- le seed crée un utilisateur `Démo`, un compte courant vide et des catégories génériques ;
- la documentation utilise des domaines et IP d'exemple (`finance.example.internal`, `10.0.0.10`).

Avant de publier une archive manuelle, vérifie qu'elle ne contient pas ton `.env` local ni une sauvegarde JSON réelle.

## Déploiement (VPS)

> ⚠️ suzanne n'a **aucune authentification intégrée**. Déploie-la derrière un VPN, un reverse-proxy avec authentification, ou sur une interface privée.

Le fichier `compose.yml` attend un PostgreSQL joignable via `DATABASE_URL` et un réseau Docker externe nommé `proxy`.

```bash
cd /opt/stacks
git clone https://github.com/<owner>/suzanne.git suzanne
cd suzanne

cat > .env <<ENV
DATABASE_URL=postgres://suzanne:<password>@postgres:5432/suzanne
APP_TOKEN=<long-random-shared-secret>
NODE_ENV=production
ENV

docker compose up -d --build
docker compose exec -T suzanne sh -c 'cd backend && npx prisma db seed'
curl http://127.0.0.1:3000/healthz
```

Exemple Caddy :

```caddy
finance.example.internal {
    tls internal
    reverse_proxy suzanne:3000
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
| `APP_TOKEN` | *(vide)* | Secret partagé optionnel exigé par les routes `/api/*` |
| `AI_PROVIDER` | `openai` | Libellé du fournisseur IA affiché côté paramètres |
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
| GET / POST | `/api/users/:user_id/tags` | Lister / créer les tags |
| PATCH / DELETE | `/api/users/:user_id/tags/:id` | Modifier / supprimer un tag |
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
| POST | `/api/users/:user_id/export` | Export JSON sélectif |
| POST | `/api/users/:user_id/import.json` | Restauration JSON |
| GET / PUT | `/api/settings/ai` | Lire / modifier la configuration IA stockée |
| GET | `/api/ai/health` | État de configuration et test de connexion IA |

## Sécurité

suzanne **n'embarque pas d'authentification applicative** : toute personne capable d'atteindre l'application a accès aux données de tous les utilisateurs configurés. C'est un choix assumé pour un usage personnel sur réseau privé.

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

## Licence

Distribué sous licence MIT. Voir [LICENSE](LICENSE).
