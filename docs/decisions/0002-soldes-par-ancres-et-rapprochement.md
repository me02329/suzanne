# ADR 0002 — Soldes par ancres, reconstruction à rebours et rapprochement

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

Le solde initial et les relevés de solde (snapshots) servent de points connus. L'utilisateur
veut pouvoir saisir « j'ai tant aujourd'hui » puis importer plus tard l'historique antérieur,
sans que cela fausse le solde actuel. Avant, le compte n'existait pas avant sa date de solde
initial dans l'historique du patrimoine.

## Décision

- **Ancres** : solde initial (ouverture du jour) et relevés (fin du jour). Solde à une date =
  dernière ancre ≤ date + lignes postérieures. Un relevé l'emporte sur le solde initial.
- **Avant la première ancre** : reconstruction à rebours (ancre − mouvements intermédiaires) ;
  le compte apparaît dès son premier mouvement.
- **Vérités distinctes** : le relevé fait foi pour le solde, les opérations pour les flux
  (stats, budgets). Les écarts entre deux ancres sont exposés par
  `GET /accounts/:id/reconciliation` ; ils se comblent par une opération `adjustment`
  explicite (hors revenus/dépenses), jamais en silence.
- Comptes avec ordres de bourse : le relevé porte sur les **espèces seules**.

## Conséquences

Importer du passé ne change jamais un solde saisi. Plus il y a de relevés, plus les erreurs
de données sont détectables (méthode utilisée pour diagnostiquer l'export du VPS).
