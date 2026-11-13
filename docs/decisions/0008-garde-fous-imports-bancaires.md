# ADR 0008 — Garde-fous des imports bancaires

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

L'analyse de l'export de production a montré deux causes de données impossibles (patrimoine
de ~200 000 € pour un salaire de 2 650 €) : un CSV Boursorama importé avec la colonne
`accountbalance` (solde du jour) comme montant — chaque achat devenait un revenu — et des
récurrents qui généraient le salaire et les abonnements en plus du relevé réel.

## Décision

- L'import CSV refuse une colonne nommée solde/balance, ou dont les valeurs ont la signature
  d'un solde (positives et identiques pour toutes les opérations d'une même journée).
- Une ligne de relevé qui correspond à une projection de récurrent (même sens, ±20 %,
  ±6 jours, libellé et montant du modèle) la remplace et hérite du lien au récurrent.
- Empreintes d'import (ADR 0004) : réimporter un relevé ne duplique rien.

## Conséquences

Le nettoyage de l'export de production (lignes corrompues, projections) est documenté dans
le rapport livré à l'utilisateur ; le relevé doit être réimporté à partir du 1er juin 2026.
