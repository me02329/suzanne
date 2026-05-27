# Guide d'utilisation — suzanne-lite

Ce guide explique comment utiliser suzanne-lite au quotidien pour suivre comptes, dépenses, revenus et budgets. Il s'adresse à l'utilisateur final ; pour l'installation, le déploiement et l'API, voir le [README](../README.md).

## Sommaire

1. [Accès à l'application](#1-accès-à-lapplication)
2. [Les concepts clés](#2-les-concepts-clés)
3. [Première configuration](#3-première-configuration)
4. [Le rythme mensuel](#4-le-rythme-mensuel)
5. [Saisir et corriger les transactions](#5-saisir-et-corriger-les-transactions)
6. [Lire le tableau de bord](#6-lire-le-tableau-de-bord)
7. [Utiliser les statistiques](#7-utiliser-les-statistiques)
8. [Budgets, récurrents et objectifs](#8-budgets-récurrents-et-objectifs)
9. [Import, règles et exports](#9-import-règles-et-exports)
10. [Multi-utilisateurs et recherche](#10-multi-utilisateurs-et-recherche)
11. [Bonnes pratiques](#11-bonnes-pratiques)
12. [Questions fréquentes](#12-questions-fréquentes)

---

## 1. Accès à l'application

suzanne-lite est accessible à l'URL de ton instance, par exemple :

```txt
http://localhost:5173
```

En production, utilise l'adresse configurée derrière ton VPN ou ton reverse-proxy.

Il n'y a **pas de page de connexion**. Si tu atteins l'application, tu peux consulter et modifier les données. L'instance doit donc rester privée.

## 2. Les concepts clés

| Terme | Ce que c'est | Où le gérer |
|---|---|---|
| **Compte** | Support où passent les flux : compte courant, livret, espèces, crédit, emprunt, etc. | *Comptes* |
| **Transaction** | Mouvement daté : dépense, revenu ou transfert entre comptes. | *Transactions* |
| **Catégorie** | Poste de classement d'une dépense ou d'un revenu. | *Catégories* |
| **Budget** | Limite mensuelle associée à une catégorie. | *Budgets* |
| **Snapshot** | Solde réel d'un compte à une date donnée. | *Comptes* |
| **Récurrent** | Transaction régulière à générer automatiquement. | *Récurrents* |
| **Règle** | Mot-clé utilisé pour catégoriser automatiquement un import CSV. | *Règles* |

Les dépenses diminuent le solde, les revenus l'augmentent, et les transferts déplacent de l'argent d'un compte vers un autre.

## 3. Première configuration

1. **Utilisateurs** — crée ou sélectionne ton profil.
2. **Comptes** — ajoute tes comptes principaux : compte courant, épargne, espèces, crédits ou emprunts. Renseigne la devise, le solde initial et sa date.
3. **Catégories** — vérifie les catégories de départ, puis ajoute celles qui te manquent.
4. **Transactions** — commence par le mois courant ou importe ton historique via CSV.
5. **Budgets** — définis les limites mensuelles des catégories importantes.
6. **Snapshots** — saisis les soldes réels si tu veux fiabiliser le suivi patrimonial.

Le seed crée un utilisateur, un compte courant et un jeu de catégories de base. Tu peux tout adapter ensuite.

## 4. Le rythme mensuel

Un cycle simple fonctionne bien :

1. En début de mois, vérifier les **récurrents** et générer les opérations prévues.
2. Ajouter ou importer les **transactions** au fil de l'eau.
3. Corriger rapidement les comptes et catégories dans la table.
4. Consulter le **tableau de bord** pour voir revenus, dépenses et net du mois.
5. Ajuster les **budgets** si une catégorie dépasse son rythme normal.
6. En fin de mois, saisir les **snapshots** de comptes pour rapprocher l'application du réel.

## 5. Saisir et corriger les transactions

Dans **Transactions**, le panneau de gauche sert à créer une transaction :

- **Dépense** — compte, catégorie, montant, date et description.
- **Revenu** — même logique, avec des catégories de type revenu.
- **Transfert** — compte source, compte destination, montant source et conversion éventuelle côté backend si les devises diffèrent.

La table du mois permet ensuite de travailler vite :

- clique directement sur la colonne **Compte** pour changer le compte ;
- clique directement sur la colonne **Catégorie** pour reclasser la transaction ;
- utilise le bouton crayon pour modifier tous les champs ;
- utilise le bouton copier pour dupliquer une opération proche ;
- coche plusieurs transactions pour ouvrir **Modifier la sélection** et appliquer un compte ou une catégorie en lot ;
- lie une transaction à un récurrent pour garder une trace de son origine.

La recherche filtre par date, description, compte, catégorie ou montant. Les filtres permettent de limiter par type de transaction et groupe de comptes.

## 6. Lire le tableau de bord

Le tableau de bord est centré sur le mois sélectionné dans la barre supérieure.

Tu y retrouves :

- les totaux **revenus**, **dépenses** et **net** ;
- le solde estimé et le patrimoine net selon les comptes ;
- les comptes groupés par type : liquidités, livrets, investissements, crypto, passifs, autres ;
- la ventilation des dépenses par catégorie ;
- les flux mensuels et annuels.

La devise d'affichage se choisit dans la barre supérieure. Les montants sont convertis pour les vues de reporting quand les comptes utilisent plusieurs devises.

## 7. Utiliser les statistiques

L'onglet **Statistiques** analyse les dépenses sur une plage longue : 3 mois, 6 mois, 12 mois, 2 ans ou tout l'historique.

Il affiche :

- la répartition par catégorie ;
- les principaux marchands, basés sur la description ;
- l'évolution mensuelle des dépenses, incluant les transactions non catégorisées ;
- les montants catégorisés et non catégorisés.

L'option **Exclure non-catégorisé** s'applique aux analyses par catégorie et marchand. Le graphique d'évolution mensuelle reste volontairement basé sur toutes les dépenses pour refléter le niveau réel de sortie d'argent.

## 8. Budgets, récurrents et objectifs

### Budgets

Associe une limite mensuelle à une catégorie. Le suivi se base sur les transactions du mois sélectionné. Les budgets sont utiles pour les postes variables : courses, restaurants, loisirs, shopping.

### Récurrents

Crée les charges et revenus réguliers : loyer, abonnements, salaire, assurances. Le bouton de génération crée les transactions attendues selon la fréquence configurée. Une transaction réelle peut ensuite être liée à son récurrent.

### Objectifs

Utilise les objectifs pour suivre une réserve ou un projet : vacances, matelas de sécurité, achat prévu. Chaque objectif a un montant cible, un montant courant, une couleur et éventuellement une échéance.

## 9. Import, règles et exports

### Import CSV

Dans **Import/Export**, colle ou charge un CSV, choisis le format de date et associe les colonnes : date, montant, description et type si disponible. Tu peux aussi choisir un compte par défaut.

Après import, les règles de catégorisation sont appliquées aux descriptions reconnues.

### Règles

Une règle associe un mot-clé à une catégorie. Exemple : `carrefour` → Courses, `netflix` → Abonnements. Elles servent surtout à accélérer les imports.

### Exports

Deux exports sont disponibles :

- **transactions CSV** — historique exploitable dans un tableur ;
- **sauvegarde JSON** — export complet des données utilisateur.

## 10. Multi-utilisateurs et recherche

Le sélecteur d'utilisateur en haut de l'application change le profil courant. Chaque utilisateur a ses propres comptes, catégories, transactions, budgets et objectifs.

La recherche globale permet de retrouver rapidement :

- une transaction ;
- un compte ;
- une catégorie ;
- un objectif.

Cliquer sur un résultat t'amène dans l'onglet concerné.

## 11. Bonnes pratiques

- **Catégorise régulièrement.** Les statistiques et budgets deviennent utiles seulement si les transactions sont classées.
- **Utilise des descriptions stables.** Des libellés cohérents améliorent les règles et le top marchands.
- **Garde les transferts comme transferts.** Ne les saisis pas comme dépense + revenu, sinon les graphiques de flux seront faussés.
- **Saisis les snapshots à date fixe.** Une fin de mois régulière rend le suivi de solde plus lisible.
- **Sauvegarde en JSON avant les grosses opérations.** C'est le moyen le plus simple de conserver une copie complète.
- **Ne supprime pas trop vite les catégories.** Recategorise d'abord les transactions qui les utilisent.

## 12. Questions fréquentes

**Pourquoi une transaction n'apparaît-elle pas dans le mois courant ?**
Vérifie la date de la transaction et le mois sélectionné dans la barre supérieure.

**Pourquoi le graphique mensuel des statistiques ne correspond-il pas au total catégorisé ?**
Le graphique mensuel inclut toutes les dépenses, même sans catégorie. Le total catégorisé dépend de l'option d'exclusion des non-catégorisées.

**Comment corriger rapidement plusieurs transactions importées ?**
Coche les lignes concernées dans *Transactions*, clique sur **Modifier la sélection**, puis applique un compte ou une catégorie commune.

**Les transferts doivent-ils avoir une catégorie ?**
Non. Un transfert représente un mouvement entre tes propres comptes. Il est affiché à part et n'entre pas dans les dépenses catégorisées.

**Puis-je exposer l'application publiquement ?**
Non, pas telle quelle. suzanne-lite n'a pas d'authentification intégrée. Elle doit rester derrière un VPN, un reverse-proxy authentifié ou une interface privée.
