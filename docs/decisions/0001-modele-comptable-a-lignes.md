# ADR 0001 — Modèle comptable à lignes

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

Une transaction portait un type (`expense`/`income`/`transfer`), un compte source, un compte
destination, un `to_amount`, un `exchange_rate`, une catégorie, plus deux tables annexes
(ventilations, allocations de remboursement). Chaque cas était une exception : la logique
« dépensé par catégorie » était écrite trois fois et avait divergé, un PATCH oubliait de
recalculer `to_amount`, les remboursements en corbeille restaient comptés, un achat d'ETF ne
débitait pas les espèces.

## Options étudiées

1. Corriger chaque bug en gardant le modèle : moins risqué à court terme, mais chaque
   nouveau cas (bourse, ajustement) ajoute une exception.
2. **Écritures à lignes** (Beancount/Ledger) : une opération = en-tête + N lignes signées
   `(compte, montant, catégorie)`.

## Décision

Option 2. Genre d'opération `kind` (`standard`, `transfer`, `trade`, `adjustment`).
Côté d'une ligne `standard` : type de sa catégorie, sinon signe (un remboursement est une
ligne positive dans la catégorie de la dépense, `refund_of_id` par ligne). Une seule
définition de « dépensé / reçu » : `txFlows` (`backend/src/lib/ledger.ts`). L'API garde la
forme historique, dérivée des lignes, pour ne pas casser le front. Détail :
`docs/ARCHITECTURE-ledger.md`.

## Conséquences

- Migration `20261113000000_ledger_lines` vérifiée par le test golden (mêmes chiffres saisis
  via l'API ou migrés depuis l'ancien schéma) ; écarts assumés listés dans le test.
- Supprimer une catégorie décatégorise ses lignes au lieu de les détruire ; un compte qui porte
  des lignes ne se supprime plus (archivage).
