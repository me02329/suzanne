# ADR 0006 — Identité visuelle « carnet de comptes » et navigation en 7 sections

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

L'interface était un clone visuel d'une plateforme de trading (« Binance-inspired »), avec
21 entrées de menu, des formulaires au-dessus du contenu et une expérience mobile pauvre.

## Décision

- Identité papier/encre, un seul accent « surligneur », Fraunces / Instrument Sans /
  JetBrains Mono ; règles dans `docs/DESIGN.md` (contenu d'abord, une action principale par
  écran, ≤ 2 actions de ligne + menu ⋯, mobile prioritaire).
- 7 sections (Accueil, Opérations, Patrimoine, Planifier, Analyse, Assistant, Réglages) avec
  onglets ; chaque page garde son URL. Barre d'onglets mobile avec ajout rapide.

## Conséquences

Styles par page dans `styles/pages/` ; `global.css` en cours d'allègement. Contrôle de
débordement mobile automatisé (`tools/screenshots.mjs`).

## Révision — novembre 2026 : une question par section

Les sections ont été réorganisées autour d'une question chacune, pour que chaque
écran ait une place évidente :

| Section | Question | Onglets |
|---|---|---|
| Accueil | « Ça va ? » | Aperçu (avec la feuille de route), Alertes |
| Opérations | « Que s'est-il passé, et comment je le range ? » | Journal, À vérifier, Catégories, Règles, Tags |
| Comptes | « Où est mon argent ? » | Comptes, Placements, Prêts |
| Analyse | « Qu'est-ce que ça dit ? » (plusieurs comptes) | Statistiques, Patrimoine, Diversification, Santé |
| Planifier | « Qu'est-ce qui arrive, où je vais ? » | Budgets, Récurrents, Factures, Prévisions, Objectifs, Simulateur |
| Assistant | — | Assistant |
| Réglages | Configuration | Données (synchro bancaire, import, export, sauvegardes), Profils, Préférences |

Une fiche de compte reste dans Comptes même quand elle montre des analyses
propres à ce compte (performance, heatmap d'un PEA) : Analyse agrège plusieurs
comptes. Les URL ne changent pas (`/bank` mène à Données).
