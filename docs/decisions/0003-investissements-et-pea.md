# ADR 0003 — Investissements : ordres avec effet sur les espèces, PEA intégré (fusion de njord)

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

Le PEA était suivi dans une application séparée (njord). Suzanne avait des positions et des
ordres, mais un achat ne débitait pas les espèces : espèces et titres étaient comptés deux
fois. Les ordres étaient arrondis à 2 décimales (fractions d'ETF, crypto faussées).

## Décision

- Option par compte `orders_affect_cash` (par défaut pour les nouveaux PEA / comptes-titres /
  crypto / retraite) : chaque ordre génère une opération `trade` à une ligne (achat
  `−(q × cours + frais)`, vente `+(q × cours − frais)`), dérivée de l'ordre (recréée, supprimée
  avec lui, régénérée à l'import, jamais exportée). Désactivée pour les comptes existants afin
  de ne pas modifier rétroactivement leurs soldes.
- Garde « jamais plus vendu que détenu » sur tout le carnet (y compris quand on supprime un
  achat antérieur). Précision : 8 décimales de quantité, 6 de cours.
- PRU au coût moyen pondéré par ligne ; revente totale → ligne à zéro, plus-value réalisée
  conservée, rachat = PRU neuf. Fiscalité PEA calculée sur l'enveloppe (valeur − versements
  nets), compteur des 5 ans depuis `fiscal_start_date`.
- Calculs njord portés dans `shared/src/finance/` (XIRR, plafond, fiscalité datée, TWR) avec
  leurs tests ; migration des données par `backend/scripts/import-njord.ts` (rapport
  `--dry-run`, puis restauration JSON idempotente).

## Conséquences

njord peut être arrêté une fois la migration rapprochée. Taux de prélèvements sociaux 2026
(18,6 %) à confirmer.
