# ADR 0009 — Synchronisation bancaire DSP2 via Enable Banking

- Date : 14 novembre 2026
- Statut : accepté (branche `dev`), à valider en usage réel

## Contexte

Les exports CSV / OFX / QIF de Boursorama coupent le libellé à 40 caractères : le motif saisi
sur un virement est perdu, et chaque import est manuel. La DSP2 donne accès aux comptes en
lecture, mais seulement via un prestataire agréé AISP. Les agrégateurs (Powens, Bridge, Tink)
sont sur devis ; l'offre gratuite de GoCardless ferme. Enable Banking propose un mode
« restreint » gratuit, limité aux comptes liés par le propriétaire de l'application : le cas
d'une instance auto-hébergée. Un essai sur un vrai compte (POC, novembre 2026) donne des
libellés jusqu'à 141 caractères, un identifiant unique par opération et les soldes.

## Décision

- Enable Banking, application **par instance** (chaque auto-hébergeur crée la sienne), service
  « Account Information » uniquement : **lecture seule**.
- Client sans dépendance (JWT RS256 signé avec `node:crypto`). Clé privée dans un fichier monté
  en lecture seule, **jamais** en base, dans les sauvegardes ni dans git. Fonction désactivée
  tant que la configuration est absente ; l'écran affiche alors le guide d'activation.
- Une **connexion** par banque (consentement, expiration), un **lien** par compte distant,
  associé ou non à un compte Suzanne. Tables hors sauvegardes (une session ne se restaure pas
  ailleurs).
- Autorisation par redirection, `state` signé (HMAC) lié au profil, valable 1 h. Retour sur une
  page du front (`/bank/callback`) qui transmet `code` et `state` à l'API (protégée par le jeton
  de l'instance comme le reste). Saisie manuelle de l'adresse de retour en secours.
- Import par le **pipeline existant** (`dedupeAndInsert`) : empreinte `eb:<compte>:<id bancaire>`,
  règles, virements internes, récurrents. Les opérations déjà importées autrement sont
  **reconnues** (date + montant, appariement un à un) plutôt que dupliquées, et prennent
  l'empreinte bancaire et le libellé complet s'il prolonge l'ancien.
- Opérations en attente ignorées (identifiant provisoire chez Boursorama). Solde comptabilisé
  enregistré comme relevé (ADR 0002).
- Synchro manuelle et automatique (toutes les ~24 h, vérification toutes les 6 h).

## Conséquences

- Les données transitent par un tiers (Enable Banking) : à dire dans la doc et l'écran.
- L'URL de retour doit être joignable en HTTPS depuis le navigateur de l'utilisateur.
- Consentement à renouveler (180 jours) : badge « bientôt » 7 jours avant, puis « expiré ».
- Reconnaissance par date + montant : deux opérations identiques le même jour sur le même compte
  sont appariées dans l'ordre ; sans conséquence sur les soldes.
- À faire : alerte (module Alertes) avant expiration ; suivi des opérations en attente
  `avis-…` → comptabilisées.
