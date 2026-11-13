# ADR 0007 — Localisation par clés stables et catalogues CSV `keys,fr,en`

- Date : 13 novembre 2026
- Statut : accepté — à implémenter

## Contexte

Les traductions utilisaient la phrase française comme clé (`t('Enregistrer')`) dans un JSON
unique : reformuler le français perd la traduction en silence. La refonte a ajouté de
nombreux textes non traduits.

## Décision

Même approche que le jeu « At the End of the World » (son ADR 0036) : clés stables
(`budgets.hero.remaining`), catalogues par domaine au format CSV `keys,fr,en`, français
langue source et de repli, conversion CSV → i18next au build, test qui vérifie que toute clé
utilisée existe dans un et un seul catalogue et qu'aucune case n'est vide.

## Conséquences

Migration mécanique des écrans ; traduction anglaise complétée au passage.
