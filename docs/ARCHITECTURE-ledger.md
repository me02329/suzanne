# Modèle comptable : opérations à lignes

## Principe

Une **opération** (`transactions`) = date, libellé, statut pointé, tags, pièces
jointes. Ses montants vivent dans N **lignes** (`transaction_lines`) :

| champ        | sens |
|--------------|------|
| `account_id` | compte touché (null = opération « hors compte », à affecter) |
| `amount`     | montant **signé**, dans la devise du compte : `< 0` sort du compte, `> 0` y entre |
| `category_id`| catégorie (null = non catégorisé) |
| `refund`     | ligne de remboursement (fixe le côté « dépenses » quand elle n'a pas de catégorie) |
| `refund_of_id` | dépense remboursée par **cette** ligne (un remboursement peut couvrir plusieurs dépenses) |
| `note`       | note de ventilation |

Le **genre** de l'opération (`kind`) dit comment la lire :

- `standard` : dépense / revenu. Toutes les lignes sur un même compte (ou toutes hors compte).
- `transfer` : virement entre comptes, sans catégorie. Ligne source négative, ligne destination positive, chacune dans sa devise (plus de `to_amount` / `exchange_rate` à maintenir : le taux se déduit des deux lignes).
- `trade`    : mouvement d'espèces lié à un ordre de bourse (achat = sortie, vente = entrée). Exclu des revenus et dépenses.
- `adjustment` : ajustement de solde explicite. Exclu des revenus et dépenses.

## Exemples

| Situation | Lignes |
|---|---|
| Courses 50 € | `Courant −50 Courses` |
| Salaire | `Courant +2500 Salaire` |
| Achat ventilé 200 € | `Courant −150 Courses`, `Courant −50 Loisirs` |
| Virement vers le livret | `Courant −500`, `Livret +500` |
| Retrait avec frais | `Courant −300`, `Espèces +295` |
| Remboursement de 40 € sur l'achat ventilé + 60 € de prime | `Courant +30 Courses`, `Courant +10 Loisirs`, `Courant +60 Salaire` |
| Achat d'ETF | `PEA −1000` (`trade`) + l'ordre de bourse (quantité, cours, frais) |

## Ordres de bourse

Un compte avec `orders_affect_cash` (par défaut pour les nouveaux PEA / comptes-titres /
crypto / retraite) reçoit, pour chaque ordre, une opération `trade` à une ligne :
achat = `−(quantité × cours + frais)`, vente = `+(quantité × cours − frais)`. Elle est
dérivée de l'ordre (`lib/holdingCash.ts`) : recréée quand l'ordre change, supprimée avec
lui, jamais exportée (régénérée à l'import). Solde du compte = espèces + valeur des titres.
Les comptes existants gardent l'ancien comportement tant que l'option n'est pas activée ;
la basculer (ré)génère ou retire les mouvements de tous ses ordres.

## Lecture des montants

- **Solde d'un compte** = ancre (solde initial ou relevé) + somme de ses lignes (reconstruction à rebours avant la première ancre, voir `dashboard.ts`).
- **Côté** d'une ligne d'une opération `standard` :
  - catégorie de type `expense` → côté dépenses, valeur `−amount` (une ligne positive = remboursement, elle réduit la dépense de la catégorie) ;
  - catégorie de type `income` → côté revenus, valeur `+amount` ;
  - sans catégorie → selon le signe (`< 0` dépense, `> 0` revenu), sauf `refund = true` → côté dépenses.
- Les opérations `transfer`, `trade`, `adjustment` n'ont pas de côté : elles ne sont ni des revenus ni des dépenses.

Toutes les agrégations (dashboard, statistiques, budgets, alertes, IA) passent par
`lib/ledger.ts` : une seule définition de « dépensé » et « reçu ».

## Compatibilité API

Les réponses gardent les champs historiques (`type`, `amount`, `account_id`,
`to_account_id`, `to_amount`, `category_id`, `splits`), **dérivés des lignes**,
en plus de `kind` et `lines`. Les écritures acceptent toujours la forme historique
(converties en lignes par `lib/ledger.ts`) ou directement `lines`.

## Migration

`20261113000000_ledger_lines` convertit les données existantes (virements,
ventilations, remboursements simples / partiels / multiples) puis supprime les
anciennes colonnes et les tables `transaction_splits` / `refund_allocations`.
Vérifiée par le test golden (`backend/src/test/golden.integration.test.ts`) :
même jeu de données, même résultat avant et après, que les données soient
saisies via l'API ou migrées depuis l'ancien schéma.
