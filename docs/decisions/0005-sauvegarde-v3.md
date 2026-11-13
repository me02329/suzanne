# ADR 0005 — Sauvegarde v3 : complète, atomique, idempotente

- Date : 13 novembre 2026
- Statut : accepté

## Contexte

Restaurer une sauvegarde dupliquait toutes les transactions (×2 à chaque restauration), un
import invalide laissait des données à moitié écrites, et la « sauvegarde complète » oubliait
positions, alertes, pièces jointes, rapprochements de factures.

## Décision

Format v3 (lignes, références par nom + uid) ; lecture des v1/v2 conservée. Import dans une
transaction SQL unique (erreur → 400, rien d'écrit), dédoublonnage multi-ensemble, toutes les
entités exportées (dont budget global, provisions). CSV « tableur » séparé (`;`, BOM, noms
lisibles, protection contre l'injection de formule).

## Conséquences

Restaurer est sans risque sur un profil existant. Le test golden et les tests d'export
couvrent le format.
