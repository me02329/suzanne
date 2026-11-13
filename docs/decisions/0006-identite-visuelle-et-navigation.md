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
