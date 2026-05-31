# Guide d'utilisation — suzanne-lite

Ce guide explique comment utiliser suzanne-lite au quotidien pour suivre comptes, dépenses, revenus et budgets. Il s'adresse à l'utilisateur final ; pour l'installation, le déploiement et l'API, voir le [README](../README.md).

## Sommaire

1. [Accès à l'application](#1-accès-à-lapplication)
2. [Les concepts clés](#2-les-concepts-clés)
3. [Première configuration](#3-première-configuration)
4. [Le rythme mensuel](#4-le-rythme-mensuel)
5. [Saisir et corriger les transactions](#5-saisir-et-corriger-les-transactions)
6. [Lire le tableau de bord](#6-lire-le-tableau-de-bord)
7. [Prévisionnel et santé financière](#7-prévisionnel-et-santé-financière)
8. [Utiliser les statistiques](#8-utiliser-les-statistiques)
9. [Budgets, récurrents et objectifs](#9-budgets-récurrents-et-objectifs)
10. [Import, règles et exports](#10-import-règles-et-exports)
11. [Multi-utilisateurs, recherche et assistant](#11-multi-utilisateurs-recherche-et-assistant)
12. [Bonnes pratiques](#12-bonnes-pratiques)
13. [Questions fréquentes](#13-questions-fréquentes)

---

## 1. Accès à l'application

suzanne-lite est accessible à l'URL de ton instance, par exemple :

```txt
http://localhost:5174
```

En production, utilise l'adresse configurée derrière ton VPN ou ton reverse-proxy.

Il n'y a **pas de page de connexion**. Si tu atteins l'application, tu peux consulter et modifier les données. L'instance doit donc rester privée.

## 2. Les concepts clés

| Terme | Ce que c'est | Où le gérer |
|---|---|---|
| **Compte** | Support où passent les flux : compte courant, livret, espèces, crédit, emprunt, etc. | *Comptes* |
| **Transaction** | Mouvement daté : dépense, revenu ou transfert entre comptes. | *Transactions* |
| **Catégorie** | Poste de classement d'une dépense ou d'un revenu. | *Catégories* |
| **Tag** | Étiquette libre, multi-valeurs, utile pour croiser les transactions sans changer la catégorie. | *Tags* |
| **Budget** | Limite mensuelle associée à une catégorie. | *Budgets* |
| **Snapshot** | Solde réel d'un compte à une date donnée. | *Comptes* |
| **Récurrent** | Transaction régulière à générer automatiquement. | *Récurrents* |
| **Règle** | Mot-clé utilisé pour catégoriser automatiquement un import CSV. | *Règles* |

Les dépenses diminuent le solde, les revenus l'augmentent, et les transferts déplacent de l'argent d'un compte vers un autre.

## 3. Première configuration

1. **Utilisateurs** — crée ou sélectionne ton profil.
2. **Comptes** — ajoute tes comptes principaux : compte courant, épargne, espèces, crédits ou emprunts. Renseigne la devise, le solde initial et sa date.
3. **Catégories et tags** — vérifie les catégories de départ, puis ajoute les tags qui te serviront à filtrer autrement : perso/pro, vacances, enfant, remboursable, etc.
4. **Transactions** — commence par le mois courant ou importe ton historique via CSV.
5. **Budgets** — définis les limites mensuelles des catégories importantes.
6. **Récurrents** — saisis les revenus et charges fixes pour alimenter les abonnements, la santé financière et le prévisionnel.
7. **Snapshots** — saisis les soldes réels si tu veux fiabiliser le suivi patrimonial.

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
- **Tags** — plusieurs tags peuvent être associés à la même transaction.

La table du mois permet ensuite de travailler vite :

- clique directement sur la colonne **Compte** pour changer le compte ;
- clique directement sur la colonne **Catégorie** pour reclasser la transaction ;
- utilise le bouton crayon pour modifier tous les champs ;
- utilise le bouton copier pour dupliquer une opération proche ;
- coche plusieurs transactions pour ouvrir **Modifier la sélection** et appliquer un compte ou une catégorie en lot ;
- lie une transaction à un récurrent pour garder une trace de son origine.

La recherche filtre par date, description, compte, catégorie ou montant. Les filtres permettent de limiter par type de transaction, groupe de comptes et tag.

## 6. Lire le tableau de bord

Le tableau de bord est centré sur le mois sélectionné dans la barre supérieure.

Tu y retrouves :

- les totaux **revenus**, **dépenses** et **net** ;
- le solde estimé et le patrimoine net selon les comptes ;
- les comptes groupés par type : liquidités, livrets, investissements, crypto, passifs, autres ;
- les abonnements actifs et leur coût par cadence ;
- la ventilation des dépenses par catégorie ;
- les flux mensuels et annuels.

La devise d'affichage se choisit dans la barre supérieure. Les montants sont convertis pour les vues de reporting quand les comptes utilisent plusieurs devises.

Depuis la page **Comptes**, clique sur un compte pour ouvrir son détail : historique de solde, mouvements récents, snapshots et plafond restant pour les livrets réglementés en euros.

## 7. Prévisionnel et santé financière

### Prévisionnel

L'onglet **Prévisionnel** projette le solde liquide sur 30 jours, 60 jours, 90 jours, 6 mois ou 12 mois.

Il se base sur :

- le solde des comptes liquides ;
- les récurrents actifs qui impactent ces comptes ;
- les échéances d'objectifs présentes dans l'horizon.

Il sert surtout à repérer une baisse future : salaire attendu, loyer, abonnements, assurances, échéances annuelles.

### Santé financière

L'onglet **Santé financière** donne des ratios synthétiques :

- taux d'épargne courant et moyen ;
- fonds d'urgence exprimé en mois de dépenses ;
- part des récurrents dans les revenus ;
- charges fixes vs variables ;
- budgets dépassés ou tenus.

Ces indicateurs ne remplacent pas le détail transactionnel : ils donnent une lecture rapide de la tendance.

## 8. Utiliser les statistiques

L'onglet **Statistiques** analyse les dépenses sur une plage longue : 3 mois, 6 mois, 12 mois, 2 ans ou tout l'historique.

Il affiche :

- la répartition par catégorie ;
- les principaux marchands, basés sur la description ;
- l'évolution mensuelle des dépenses, incluant les transactions non catégorisées ;
- les montants catégorisés et non catégorisés.

L'option **Exclure non-catégorisé** s'applique aux analyses par catégorie et marchand. Le graphique d'évolution mensuelle reste volontairement basé sur toutes les dépenses pour refléter le niveau réel de sortie d'argent.

## 9. Budgets, récurrents et objectifs

### Budgets

Associe une limite mensuelle à une catégorie. Le suivi se base sur les transactions du mois sélectionné. Les budgets sont utiles pour les postes variables : courses, restaurants, loisirs, shopping.

### Récurrents

Crée les charges et revenus réguliers : loyer, abonnements, salaire, assurances. Le bouton de génération crée les transactions attendues selon la fréquence configurée. Une transaction réelle peut ensuite être liée à son récurrent.

La page regroupe aussi les abonnements par cadence : hebdomadaire, mensuelle, annuelle. Cela évite de lisser artificiellement une dépense annuelle dans un mois où elle ne passe pas réellement.

### Objectifs

Utilise les objectifs pour suivre une réserve ou un projet : vacances, matelas de sécurité, achat prévu. Chaque objectif a un montant cible, un montant courant, une couleur et éventuellement une échéance.

## 10. Import, règles et exports

### Import CSV

Dans **Import/Export**, clique sur **Importer des transactions**, colle ou charge un CSV, choisis le format de date et associe les colonnes : date, montant, description et type si disponible. Tu peux aussi choisir un compte par défaut.

Après import, les règles de catégorisation sont appliquées aux descriptions reconnues.

### Règles

Une règle associe un mot-clé à une catégorie. Exemple : `carrefour` → Courses, `netflix` → Abonnements. Elles servent surtout à accélérer les imports.

### Exports

Les raccourcis disponibles :

- **Backup complet** — export JSON réimportable de toutes les données ;
- **Année en cours** — export JSON limité aux données financières récentes ;
- **CSV transactions** — historique exploitable dans un tableur ;
- **Export sur mesure** — choix des entités et de la plage de dates.

La restauration JSON réutilise les entités existantes quand c'est possible. Les transactions sont recréées : restaure plutôt sur un profil vide si tu veux éviter les doublons.

## 11. Multi-utilisateurs, recherche et assistant

Le sélecteur d'utilisateur en haut de l'application change le profil courant. Chaque utilisateur a ses propres comptes, catégories, transactions, budgets et objectifs.

La recherche globale permet de retrouver rapidement :

- une transaction ;
- un compte ;
- une catégorie ;
- un objectif.

Cliquer sur un résultat t'amène dans l'onglet concerné.

L'**assistant IA** est optionnel. Il peut analyser les données, chercher des transactions et proposer certaines actions. Les écritures ne sont pas appliquées directement : l'interface demande toujours une confirmation.

La configuration IA se fait via les variables d'environnement ou depuis **Paramètres**. Si aucune clé n'est configurée, l'application reste utilisable sans assistant.

## 12. Bonnes pratiques

- **Catégorise régulièrement.** Les statistiques et budgets deviennent utiles seulement si les transactions sont classées.
- **Utilise des descriptions stables.** Des libellés cohérents améliorent les règles et le top marchands.
- **Garde les transferts comme transferts.** Ne les saisis pas comme dépense + revenu, sinon les graphiques de flux seront faussés.
- **Saisis les snapshots à date fixe.** Une fin de mois régulière rend le suivi de solde plus lisible.
- **Sauvegarde en JSON avant les grosses opérations.** C'est le moyen le plus simple de conserver une copie complète.
- **Utilise les tags pour les axes secondaires.** Une transaction garde une seule catégorie, mais peut avoir plusieurs tags.
- **Vérifie le prévisionnel après avoir modifié les récurrents.** C'est là que les charges fixes oubliées se voient le plus vite.
- **Ne supprime pas trop vite les catégories.** Recategorise d'abord les transactions qui les utilisent.

## 13. Questions fréquentes

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
