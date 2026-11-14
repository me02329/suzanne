# Synchronisation bancaire Enable Banking — preuve de concept

Statut : **POC** (branche `dev`, issue #2). Rien n'est encore écrit dans la base : le POC sert à vérifier la couverture des banques et la qualité des données (libellés complets, soldes, identifiants) avant de brancher la synchronisation sur l'import.

## Ce que contient le POC

- `backend/src/lib/enableBanking.ts` : client de l'API (JWT RS256 signé avec `node:crypto`, banques, autorisation, session, soldes, opérations paginées) et conversion d'une opération bancaire vers le format d'import de Suzanne (`toBankRow`).
- `tools/enable-banking.mts` : outil en ligne de commande pour tester avec ses vrais comptes.
- Tests unitaires : `backend/src/lib/enableBanking.test.ts`.

## 1. Créer l'application (une fois)

1. Créer un compte sur le [Control Panel Enable Banking](https://enablebanking.com/cp/).
2. **Applications → Ajouter une application**, environnement **Production** (le mode « restreint », gratuit pour un particulier, ne donne accès qu'aux comptes que tu lies toi-même ; l'environnement Sandbox ne propose que des banques fictives).
3. Clé : laisser le Control Panel générer la paire de clés dans le navigateur. Le fichier téléchargé `<id-de-l-application>.pem` est la **clé privée** : à garder hors du dépôt (ex. `~/.config/suzanne/enablebanking.pem`). Son nom donne l'id de l'application.
4. URL de retour (*redirect URL*) : pour le POC, une adresse qui n'a pas besoin d'exister, par ex. `https://localhost/enablebanking/callback`. Après validation à la banque, le navigateur y est renvoyé avec `?code=…` dans la barre d'adresse : c'est ce code que l'outil utilise. Elle doit être **identique** à celle de la configuration ci-dessous.
5. Remplir les champs demandés (description, e-mail, URL de confidentialité et de CGU : des pages simples suffisent pour un usage personnel).
6. **Lier ses propres comptes** depuis le Control Panel pour activer l'application en mode restreint (statut « Restricted / Active »).

## 2. Configurer l'outil

Créer `.env.enablebanking` à la racine du dépôt (ignoré par git, comme tous les `.env.*`) :

```dotenv
ENABLE_BANKING_APP_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
ENABLE_BANKING_KEY_PATH=C:/Users/<toi>/.config/suzanne/enablebanking.pem
ENABLE_BANKING_REDIRECT_URL=https://localhost/enablebanking/callback
```

## 3. Tester

```bash
npm run bank:poc -- check                         # l'application et la clé sont reconnues
npm run bank:poc -- banks FR bourso               # BoursoBank est-elle couverte ? (idem fortuneo, revolut…)
npm run bank:poc -- auth "BoursoBank" FR          # affiche l'URL d'autorisation de la banque
npm run bank:poc -- session "https://localhost/enablebanking/callback?code=…&state=…"
npm run bank:poc -- accounts                      # comptes autorisés, numérotés
npm run bank:poc -- balances 1
npm run bank:poc -- transactions 1 --from 2026-10-01 [--raw]
```

`transactions` affiche le libellé reconstruit (contrepartie + motif SEPA complet) et indique combien dépassent les 40 caractères des exports CSV. `--raw` enregistre la réponse brute dans `.data/` pour voir tous les champs renvoyés par la banque. La session et ces fichiers contiennent des **données bancaires réelles** : `.data/` est ignoré par git, ne rien en copier ailleurs.

## Ce qu'on cherche à valider

- [ ] Couverture : BoursoBank, Fortuneo, Revolut, BNP (`banks`).
- [ ] Durée de consentement réelle par banque (affichée par `banks`).
- [ ] Motif complet des virements (`remittance_information`) et nom de la contrepartie.
- [ ] Identifiant stable par opération (`entry_reference` / `transaction_id`) : sert d'empreinte d'import, pour ne jamais créer de doublon d'une synchro à l'autre.
- [ ] Opérations en attente (`PDNG`) : présentes ? deviennent-elles `BOOK` avec le même identifiant ?
- [ ] Types de solde renvoyés (`CLBD`, `ITAV`…) pour créer les relevés de solde (rapprochement, ADR 0002).
- [ ] Profondeur d'historique disponible (`--from` lointain).

## Étape suivante (après validation)

Brancher sur la base comme décrit dans l'issue #2 : tables `bank_connections` / `bank_links`, routes `/users/:user_id/bank/…` (autorisation avec `state` signé, callback, association compte distant ↔ compte Suzanne), synchronisation via le pipeline d'import existant (`dedupeAndInsert`, empreinte `eb:<id banque>`, date de début pour ne pas réimporter l'historique déjà importé en CSV), relevé de solde à chaque synchro, planificateur quotidien, écran dans Réglages, alerte avant expiration du consentement, ADR.

## Confidentialité

Les données transitent par Enable Banking (prestataire DSP2 agréé, Finlande). La clé privée ne doit jamais être commitée ni sauvegardée avec les données de Suzanne.
