# Guide : quel outil pour quelle situation

Ce guide part des situations de la vie courante et dit, pour chacune, comment la
noter dans Suzanne.

_Affiché dans l'app (Réglages › Guide) ; source : `docs/GUIDE.md`, un seul texte._

## Les briques, en une phrase chacune

| Brique | Sert à | Crée des opérations ? |
|---|---|---|
| **Opération** | Ce qui s'est passé : une dépense, une rentrée, un virement entre tes comptes. | — |
| **Virement** | Déplacer de l'argent entre deux de *tes* comptes (livret, prêt, espèces, PEA…). Ni dépense ni revenu. | — |
| **[Récurrent](/recurring)** | Ce qui revient à date fixe (loyer, abonnement, salaire, mensualité, épargne programmée). | Oui, sauf sur un compte synchronisé : il y attend la banque. |
| **[Facture attendue](/bills)** | Une échéance au montant variable (électricité, impôts) que tu veux voir arriver. | Non : elle reconnaît l'opération quand elle arrive. |
| **[Budget](/budgets)** | Une limite de dépense par catégorie et par mois. | Non. |
| **[Alerte](/alerts)** | Être prévenu : solde trop bas, grosse opération, relevé oublié, objectif en retard. | Non. |
| **[Règle](/rules)** | Catégoriser (ou taguer) automatiquement d'après le libellé. | Non : elle complète les opérations importées. |
| **[Tag](/tags)** | Un 2e classement transversal (voyage, travaux, travail). | Non. |
| **[Objectif](/goals)** | Mettre de côté pour un projet, sur un compte d'épargne. | Oui, quand tu verses. |
| **[Prêt](/loans)** | Un compte par prêt : ce que tu dois, ou ce qu'on te doit. | Oui, à la saisie guidée. |

> **Règle d'or.** Une opération est soit une **dépense**, soit une **rentrée**,
> soit un **virement entre tes comptes**. Tout ce qui ne fait que déplacer ton
> argent (vers un livret, un prêt, ton PEA, ta poche) est un virement : il ne
> gonfle ni tes dépenses ni tes revenus.

## Avec la synchronisation bancaire

Sur un compte synchronisé, **la banque fait foi** : les opérations arrivent
seules, avec la vraie date et le vrai montant. Suzanne évite les doublons :

- une opération déjà présente (saisie à la main, import, récurrent) au même
  montant, à quelques jours près, est **reconnue** et complétée, pas recréée ;
- un **récurrent** sur ce compte n'invente plus l'opération d'avance : il
  **attend la banque**, puis reconnaît l'opération arrivée et la complète (sa
  catégorie ; ou, pour une mensualité de prêt, la transforme en virement vers le
  prêt). Si rien n'arrive dans les 5 jours, l'occurrence est créée quand même ;
- un virement entre deux comptes synchronisés arrive en deux morceaux : ils sont
  **reliés** automatiquement quand le libellé le dit (« VIR… »), sinon proposés
  dans [À vérifier](/anomalies) › Virements à relier.

**À faire une fois :** des [règles](/rules) pour les libellés fréquents
(« PRLV EDF » → Énergie), des [factures attendues](/bills) pour ce qui varie,
des [récurrents](/recurring) pour ce qui est fixe.

**À faire de temps en temps :** passer dans [À vérifier](/anomalies) (sans
catégorie, doublons probables, virements à relier).

## Situations courantes

### Salaire, loyer, abonnements

- **Montant fixe, date fixe** → [Récurrent](/recurring) (revenu ou dépense).
  Il alimente le [Prévisionnel](/forecast) et, sur un compte non synchronisé,
  crée l'opération à la date.
- **Montant qui varie** (électricité, eau, impôts) → [Facture
  attendue](/bills) avec une fourchette (min – max) et un mot du libellé : elle
  se coche seule quand l'opération arrive, et le tableau de bord signale un
  retard.

### Mensualité de prêt (immobilier, auto, conso)

1. Crée le prêt dans [Prêts](/loans) (ou un compte de type « Emprunt » avec le
   capital restant dû en solde initial négatif).
2. Crée un [récurrent](/recurring) de type **Virement**, depuis ton compte
   courant **vers le compte du prêt**, au montant de la mensualité.
3. Si ton compte courant est synchronisé, le prélèvement de la banque sera
   reconnu et deviendra ce virement : le reste dû baisse, ce n'est pas une
   dépense.

Une mensualité déjà arrivée comme une dépense ? Menu **⋯** de l'opération ›
**Rattacher à un prêt** (ou, depuis le prêt : **Rattacher une opération**). Tu
peux indiquer la part **intérêts et assurance** (tableau d'amortissement) : elle
reste une vraie dépense, le reste rembourse le capital. Le solde de ton compte
ne change pas.

### Prêt entre proches

[Prêts](/loans) › Nouveau prêt :

- **On m'a prêté de l'argent** → le compte du prêt descend sous zéro, l'argent
  arrive sur ton compte (virement).
- **Quelqu'un a payé un achat pour moi** → la dépense est bien la tienne (avec
  sa catégorie), la dette se crée sans virement.
- **J'ai prêté de l'argent** → « Prêt accordé » : ce qu'on te doit.

Remboursement : **Enregistrer un remboursement** sur le prêt, ou **Rattacher
une opération** si le virement est déjà arrivé par la banque. Soldé, le prêt
peut être archivé.

### Virement entre mes comptes (livret, autre banque, PEA)

- Saisie à la main : type **Virement**, compte de départ et d'arrivée.
- Arrivé en deux opérations (une sortie, une entrée) : sélectionne les deux dans
  le [Journal](/transactions) › **Lier en virement**, ou utilise la proposition
  dans [À vérifier](/anomalies).
- Épargne programmée → [récurrent](/recurring) de type Virement vers le livret.

### Un achat remboursé (retour, mutuelle, ami qui rembourse)

Sur la rentrée : menu **⋯** › **Lier à des dépenses** (ou, sur la dépense :
**Rembourser…**). La dépense est réduite d'autant dans sa catégorie ; une
rentrée peut rembourser plusieurs dépenses. Pour lier vite : sélectionne la
dépense et la rentrée dans le Journal › **Lier le remboursement**.

### J'avance une dépense pour d'autres (restaurant, cadeau commun)

Saisis la dépense entière, puis lie chaque remboursement reçu à cette dépense
(ci-dessus) : ta part réelle reste dans tes dépenses. Si on ne te rembourse pas
vite, un [tag](/tags) « à rembourser » aide à suivre.

### Un ticket avec plusieurs catégories (courses + maison)

Menu **⋯** › **Ventiler** : une opération, plusieurs lignes (catégorie,
montant, note). Le total reste celui du ticket.

### Retrait d'espèces

Un compte **Espèces** et un virement du compte courant vers lui. Les achats en
liquide se saisissent ensuite sur le compte Espèces. Sans compte Espèces, le
retrait seul serait compté comme une dépense « inconnue ».

### Placements (PEA, compte-titres, crypto, assurance-vie)

Le versement depuis le compte courant est un **virement** vers le compte de
placement. Les achats et ventes de titres se saisissent comme des **ordres**
dans [Placements](/investments) (quantité, cours, frais) : la valeur suit les
cours. Le rendement de ton épargne (Patrimoine) neutralise les versements.

### Compte professionnel / société

Coche « professionnel » sur le compte. Ses mouvements restent hors de tes
dépenses personnelles ; ce que la société te verse (salaire, dividendes) reste
un revenu personnel.

## Les liens entre opérations

| Tu veux relier… | Comment | Effet |
|---|---|---|
| une **sortie** et une **entrée** sur deux de tes comptes | Journal : sélectionner les deux › Lier en virement (ou À vérifier) | un seul virement, ni dépense ni revenu |
| une **rentrée** et la **dépense** qu'elle rembourse | menu ⋯ › Lier à des dépenses / Rembourser… | la dépense diminue dans sa catégorie |
| une **mensualité** et un **prêt** | menu ⋯ › Rattacher à un prêt | le reste dû baisse ; intérêts à part |
| une **opération** et un **récurrent** | menu ⋯ › Lier à une récurrence | l'échéance est considérée comme passée |
| deux opérations **identiques** | À vérifier › Doublons probables | supprimer la copie, ou « pas un doublon » |

## Alertes : lesquelles poser

- **Solde de compte** sous un seuil → éviter le découvert (compte courant).
- **Montant de transaction** au-dessus d'un seuil → repérer une grosse dépense
  inattendue.
- **Relevé manquant** → penser à saisir un relevé (comptes non synchronisés).
- **Objectif en retard** → l'épargne d'un projet prend du retard.

Les alertes ne créent rien et ne bloquent rien : elles s'affichent dans
l'[aperçu](/dashboard) et la page [Alertes](/alerts).

## Quand quelque chose ne colle pas

- **Le solde ne correspond pas à la banque** → saisis un **relevé** (solde à une
  date) sur le compte : le rapprochement montre l'écart et les opérations
  non pointées. Sur un compte synchronisé, le relevé est automatique.
- **Une dépense compte deux fois** → [À vérifier](/anomalies) › Doublons
  probables.
- **Une mensualité de prêt gonfle mes dépenses** → Rattacher à un prêt (ci-dessus).
- **Un virement interne gonfle mes dépenses et mes revenus** → Lier en virement.
- **Beaucoup d'opérations sans catégorie** → À vérifier › accepter les
  propositions, puis créer une [règle](/rules) pour la prochaine fois.
- **Un compte fermé** → archive-le : il disparaît des listes, l'historique
  reste.

## Sur le téléphone (app Android)

Chaque profil vit **sur le serveur** ou **sur le téléphone** (Réglages ›
Profils). Sur le téléphone : aucune connexion nécessaire, mais pas de
synchronisation bancaire. On peut faire passer un profil d'un côté à l'autre
(Déplacer, Copier, Repartir de zéro) ; une sauvegarde est rangée dans
Téléchargements avant tout déplacement.
