# Idées d'amélioration — inspirées d'apps open-source comparables

> Issu d'une revue (2026-05-31) de 4 trackers de finances perso open-source, clonés et
> inspectés pour leur modèle de données et leurs features : **Ghostfolio** (TS/NestJS,
> patrimoine/investissement), **Firefly III** (PHP/Laravel, le PFM de référence),
> **Actual** (TS, budget enveloppe local-first), **Kresus** (FR, agrégation bancaire).
>
> Chaque section ci-dessous est rédigée pour devenir une issue. Format :
> **Quoi · Modèle de référence · Valeur · Effort · Notes.**

---

## A. Validées par le terrain (déjà au backlog, confirmées par ces apps)

### A1. Alertes configurables
- **Quoi** : alertes paramétrables (solde sous X, transaction au-dessus de Y, objectif en retard, compte sans snapshot récent, solde projeté négatif).
- **Modèle de référence (Kresus)** — d'une simplicité parfaite à reprendre :
  `alert = { account_id, type: 'balance' | 'transaction', order: 'lt' | 'gt', limit, frequency }`
  + méthodes `testBalance(balance)` / `testTransaction(amount)`.
- **Valeur** : haute. Déjà sur le backlog (issue #16).
- **Effort** : moyen (modèle + évaluation + UI de config + canal de notif).
- **Notes** : commencer par l'évaluation à la volée (au reload) avant d'ajouter un envoi e-mail/push.

### A2. Page « Anomalies » / doublons
- **Quoi** : transactions sans compte, sans catégorie, **doublons probables**, montants suspects.
- **Modèle de référence (Kresus)** : détection de doublons par paires (même montant, dates proches).
- **Valeur** : haute (nettoyage de données). Déjà sur le backlog.
- **Effort** : moyen.

---

## B. Nouvelles idées prioritaires

### B1. « Factures attendues » (Bills) — le meilleur ajout
- **Quoi** : une dépense récurrente **attendue avec une fourchette de montant**, rapprochée des
  vraies transactions → « payé ce mois ? dans la fourchette ? en retard ? ». Version riche des
  abonnements + du « cashflow réel vs prévu ».
- **Modèle de référence (Firefly `Bill`)** :
  `bill = { name, amount_min, amount_max, repeat_freq, active, skip, end_date }`
  → matché contre les transactions réelles.
- **Le coup de génie** : la **fourchette min/max** modélise les charges variables (élec 80–120 €)
  que les récurrents à montant fixe de suzanne ne savent pas représenter.
- **Valeur** : haute — fusionne plusieurs items (abonnements, cashflow réel vs prévu).
- **Effort** : moyen-élevé (modèle + algo de rapprochement + vue dédiée).
- **Notes** : s'appuie sur l'existant (récurrents, `recurringMonthlyEquivalent`, cadences).

### B2. Valorisation automatique des investissements / crypto
- **Quoi** : détenir des **quantités** d'un actif et laisser l'app **récupérer les cours** pour
  valoriser dans le temps — au lieu de saisir des snapshots manuels.
- **Modèle de référence (Ghostfolio)** :
  `order = { symbol, quantity, unitPrice, fee, date, type: BUY|SELL }` + `MarketData` (prix par date).
- **Pourquoi c'est fort** : règle le point de douleur crypto (plus de relevés antidatés ; l'app
  connaît le cours du BTC à n'importe quelle date passée). Apporte aussi la perf (TWR), l'allocation
  d'actifs, les dividendes.
- **Chemin plus court qu'il n'y paraît** : `backend/src/lib/fx.ts` fait DÉJÀ des requêtes Yahoo
  chart avec un paramètre `date`. Passer de `EURUSD=X` à `BTC-EUR` / un ticker = le même mécanisme.
- **Valeur** : maximale.
- **Effort** : élevé (nouveau modèle holdings + provider de cours + UI). Le plus gros chantier.

### B3. Taux de change historiques stockés
- **Quoi** : stocker un taux FX **par date** plutôt que d'appliquer le taux du jour à toutes les dates.
- **Modèle de référence (Firefly `CurrencyExchangeRate`)**.
- **Pourquoi** : le patrimoine multi-devises **historique** (qu'on vient d'optimiser) est légèrement
  faux — un compte USD en 2023 devrait utiliser le taux de 2023, pas celui d'aujourd'hui. Aujourd'hui
  `buildFx` n'utilise que les taux courants.
- **Chemin court** : `fetchExchangeRate(from, to, date)` accepte déjà une date ; il reste à câbler
  wealth-history dessus + un cache/table de taux par jour.
- **Valeur** : moyenne-haute, et **pile dans la lignée** du travail wealth-history récent.
- **Effort** : faible-moyen. **Meilleur ratio effort/valeur des trois.**

---

## C. Bonus (plus petits, Firefly)

### C1. Pièces jointes sur les transactions
- Attacher un reçu/justificatif à une transaction (`Attachment`). Effort faible-moyen (stockage de fichiers).

### C2. Liens entre transactions
- Rattacher un **remboursement à son achat d'origine** (`LinkType` / `TransactionJournalLink`). Niche mais élégant.

### C3. Rollover / report de budget
- Le budget non dépensé passe au mois suivant (`AutoBudget`). Demande courante côté budgets.

### C4. Historique des versements sur objectif
- Timeline des contributions à un objectif d'épargne (`PiggyBankEvent`). suzanne a les objectifs ;
  il manque l'historique des versements.

---

## D. À ignorer (volontairement)

- **Sync local-first** (Actual) : suzanne est self-hosted mono-instance, inutile.
- **Compta en partie double** + **moteur de règles triggers/actions complet** (Firefly) : trop lourd ;
  le `pattern → catégorie` + le bouton « Appliquer » couvrent ~90 % du besoin.
- **Auth / multi-user / webhooks** : hors scope (déploiement VPN).

---

## E. Là où suzanne gagne déjà (à ne pas perdre)

- **Assistant IA** : aucune de ces 4 apps n'en a un correct (Maybe en avait un, projet mort).
- **Plafonds de livrets réglementés** FR (Livret A / LDDS / LEP).
- **Prévisionnel de trésorerie** (forward cashflow).
- **Monorepo TypeScript typé bout-en-bout** (`shared/`) — DRY front/back.

---

## F. Comparatif des 4 apps

| App | Stack | Périmètre | Maturité | Le plus pertinent pour suzanne |
|-----|-------|-----------|----------|-------------------------------|
| **Firefly III** | PHP/Laravel | PFM complet (le plus large) | ★★★★★ | référence **fonctionnelle** (bills, budgets, règles, récurrents, rapports) |
| **Ghostfolio** | TS/NestJS+Angular | Patrimoine / investissement | ★★★★☆ | référence **technique** (même stack) + valorisation marché |
| **Actual** | TS, local-first | Budget enveloppe (YNAB-like) | ★★★★☆ | UX budget |
| **Kresus** | TS, FR | Agrégation bancaire + catégo | ★★★☆☆ | contexte **français**, modèle d'alertes |

**Verdict** : **Firefly III** est la plus aboutie *en tant que PFM généraliste* (le plus proche de
l'ambition de suzanne) — breadth + maturité + communauté. **Ghostfolio** est la plus *polie pour son
périmètre* et la meilleure **référence d'architecture** (ton stack). Actual gagne sur l'UX budget pure ;
Kresus est le pendant français le plus proche culturellement.

---

## G. Où se situe suzanne (revue 2026-05-31)

| App | Périmètre | Maturité |
|-----|-----------|----------|
| Firefly III | PFM complet | ★★★★★ |
| Ghostfolio | Patrimoine | ★★★★☆ |
| Actual | Budget | ★★★★☆ |
| **suzanne** | **PFM généraliste** | **★★★½** |
| Kresus | Agrégation FR | ★★★☆ |

Juste sous le trio de tête, **nettement au-dessus de Kresus** (scope + finition, sauf l'agrégation
bancaire). En une formule : *« le petit frère de Firefly III, plus jeune, plus propre, nativement IA »*.

- **Ce qui la retient** : maturité (années d'edge cases), profondeur de niche (valorisation marché,
  bills), écosystème (communauté, traductions, importeurs), et le choix no-auth / mono-utilisateur.
- **Ce qui la fait frapper au-dessus de son poids** : l'**assistant IA** (aucun des 4 n'en a un correct),
  la **qualité d'archi** (monorepo TS typé, testé, optimisé), les finitions FR + le **prévisionnel**.

---

## H. Chemin vers le #1 (feuille de route maturité)

> Ce qui sépare suzanne (★★★½) du sommet est moins une question de features que de **passage d'outil
> perso à produit mûr**. 🔴 = indispensable pour être *en lice* pour le #1.
>
> **Hors-scope assumé : ❌ agrégation bancaire temps réel** (GoCardless/Plaid/woob) — les autorisations
> sont payantes. On **compense par un import fichier enrichi** (H1.3). C'est un manque partagé : Firefly
> aussi s'appuie surtout sur des importeurs.
>
> **Réutilisable depuis [PentestPath]** : l'**auth/multi-user** et l'**i18n** y sont déjà éprouvés →
> à porter plutôt qu'à réinventer.

### H1. Bloquants structurels (le mur)
- 🔴 **i18n** — UI multilingue (EN + FR mini), `react-i18next`, formats nombres/dates/devises localisés
  (aujourd'hui tout en français en dur). *Réutiliser PentestPath.*
- 🔴 **Auth + multi-utilisateur réel** — login, sessions/JWT, isolation par auth (aujourd'hui n'importe
  qui choisit n'importe quel user), reset mot de passe, 2FA. Débloque « exposable publiquement ».
  *Réutiliser PentestPath.*
- **Import enrichi (sans agrégation)** — OFX/QIF/MT940, **mappings CSV sauvegardés** par banque,
  **détection de doublons à l'import**, ré-import idempotent.

### H2. Profondeur (égaler les spécialistes)
- **Valorisation marché invest/crypto** (cf. B2) — holdings (quantité × cours auto), TWR, allocation
  d'actifs, dividendes, frais, comparaison indice, calculateur FIRE. → rattrape Ghostfolio.
- **Factures attendues + réconciliation** (cf. B1) — bills à fourchette + rapprochement, réconciliation
  de compte sur un solde de relevé. → rattrape Firefly.
- **Moteur de règles** triggers + actions multiples (pas juste `pattern→catégorie`).
- **Transactions splittées** (une transaction répartie sur plusieurs catégories).

### H3. Robustesse / ops
- **Journal d'audit** (qui a changé quoi, quand).
- **Soft-delete + corbeille** (restaurer une transaction).
- **Sauvegardes automatiques + restauration** (au-delà de l'export JSON actuel).
- **Pièces jointes** (reçus) + **liens entre transactions** (remboursement ↔ achat).
- **Tests e2e / intégration** larges (l'unitaire est bon, le bout-en-bout manque).
- **Sécurité** : helmet (headers), CSRF, rate-limiting généralisé, audit de dépendances.
- **Accessibilité (a11y)** : audit clavier / lecteur d'écran.

### H4. Écosystème / produit
- **Documentation** : guide utilisateur, doc self-host, **doc API**.
- **API publique + webhooks + clés d'API** (intégrations tierces).
- **Releases versionnées + CI/CD + changelog**, **instance de démo**.
- **Onboarding** : assistant premier lancement + données de démo.
- **Communauté / traductions**.

### H5. Parité confort
- **Opérations en masse** sur transactions (généraliser le bulk déjà fait pour la catégorisation IA).
- **Vues / filtres sauvegardés** (cf. Kresus « views »).
- **Rollover de budget** (non-dépensé → mois suivant) + enveloppe.
- **Rapports configurables** (plage, comptes, catégories, group-by) + export PDF.
- **Taux FX historiques** (cf. B3), notes sur entités, vue calendrier / rappels.

### Séquencement conseillé
1. **i18n + auth/multi-user** (porte depuis PentestPath) → débloque « produit public ».
2. **B1 (factures attendues) + B2 (valorisation marché)** → la profondeur qui manque vs Firefly/Ghostfolio.
3. **Robustesse** (journal d'audit, sauvegardes, soft-delete) + **sécurité**.
4. **Écosystème** (docs, API, releases).

**Réalisme** : l'agrégation bancaire étant le seul vrai mur (payant, donc écarté), **tout le reste est
atteignable**. Cible crédible : le **#1 du PFM self-host solo, propre et nativement IA** — et avec H1+H2,
un sérieux prétendant au #1 généraliste, l'agrégation temps réel en moins (manque assumé et partagé).

[PentestPath]: app perso de référence (auth + i18n déjà en place, à réutiliser).
