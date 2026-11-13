# ADR 0004 — Identités stables (UUID) et empreintes d'import

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

Les identifiants entiers ne valent que sur une base. Une restauration reconnaissait les
éléments par leur nom ou leur contenu : une opération renommée depuis la sauvegarde était
recréée ; un relevé réimporté après recatégorisation était dupliqué.

## Options étudiées

1. Identifiant calculé à partir du contenu (nom, date…) : change dès qu'on corrige le
   contenu, collisions possibles. Rejeté pour l'identité.
2. **UUID aléatoire attribué une fois** pour l'identité ; **empreinte de contenu** seulement
   pour les lignes de relevé bancaire, dont le contenu brut ne change jamais.

## Décision

Option 2. `uid` (UUID généré par Postgres) sur comptes, institutions, catégories, tags,
opérations, récurrents, objectifs, factures, positions, provisions, conservé dans les
sauvegardes. `import_fingerprint` sur les opérations importées : FITID OFX, sinon hash de la
ligne brute + n° d'occurrence (deux achats identiques le même jour restent deux). Ordre de
reconnaissance à l'import : uid → empreinte → clé de contenu.

## Conséquences

Une copie de sauvegarde vers un autre profil reçoit de nouvelles identités. Une opération
mise à la corbeille depuis la sauvegarde y reste.
