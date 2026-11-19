# Synchronisation bancaire (Enable Banking)

Suzanne peut récupérer chaque jour les opérations et le solde de tes comptes bancaires, **avec les libellés complets** (les exports CSV/OFX de Boursorama coupent à 40 caractères), via [Enable Banking](https://enablebanking.com) : agrégateur DSP2 agréé (Finlande), gratuit en mode « restreint » pour un usage personnel. Issue #2.

## Sécurité

- **Lecture seule** : l'application n'a que le service « Account Information ». Elle ne peut ni faire de virement ni modifier quoi que ce soit (l'initiation de paiement est un autre service, non demandé, qui exigerait ta validation forte à chaque paiement).
- **Tes identifiants bancaires ne passent jamais par Suzanne** : tu te connectes sur le site ou l'appli de ta banque, qui délivre un consentement.
- Le consentement est **limité dans le temps** (180 jours chez Boursorama) et **révocable** : bouton « Déconnecter » dans Suzanne, ou depuis ta banque.
- La **clé privée** de l'application reste sur le serveur, dans un fichier hors base, hors sauvegardes et hors git. Suzanne ne stocke que l'identifiant de session, inutilisable sans la clé.
- Les données transitent par Enable Banking (prestataire agréé, supervisé par l'autorité financière finlandaise). Mode restreint : seuls les comptes que tu as liés toi-même sont accessibles.

## Activation (une fois)

L'écran **Réglages → Données** affiche ces étapes tant que le serveur n'est pas configuré.

1. Créer un compte sur le [Control Panel Enable Banking](https://enablebanking.com/cp/).
2. **Ajouter une application « Production »**, clé générée dans le navigateur. Le fichier `<id-application>.pem` téléchargé est la **clé privée**. Description, e-mail, URL de confidentialité et de CGU sont obligatoires (le lien du dépôt suffit pour un usage perso).
3. **URL de retour** : `https://<ton-instance>/bank/callback`, identique au caractère près et joignable depuis ton navigateur (en HTTPS ; sur le VPN, il suffit d'y être connecté au moment de l'autorisation). Une application peut déclarer plusieurs URL de retour (instance + dev).
4. **Lier ses propres comptes** dans le Control Panel : l'application passe « Active » (mode restreint).
5. **Serveur** (Docker, `compose.yml`) :
   ```bash
   mkdir -p secrets && cp <id-application>.pem secrets/enablebanking.pem
   # Lisible par l'utilisateur du conteneur (app), pas par les autres :
   sudo chown "$(docker compose run --rm --no-deps --entrypoint id suzanne -u)" secrets/enablebanking.pem
   chmod 400 secrets/enablebanking.pem
   ```
   et dans le `.env` du serveur :
   ```dotenv
   ENABLE_BANKING_APP_ID=<id-application>
   ENABLE_BANKING_REDIRECT_URL=https://<ton-instance>/bank/callback
   ```
   En dev (hors Docker), `ENABLE_BANKING_KEY_PATH` donne le chemin du `.pem`.
6. `docker compose up -d` : l'écran propose alors « Connecter une banque ».

## Utilisation

1. **Connecter une banque** : choisir le pays et la banque → redirection vers la banque → validation → retour sur Suzanne (`/bank/callback`). Une connexion par banque : refaire l'opération pour Fortuneo, Revolut… (chacune avec son propre consentement). Si l'URL de retour configurée n'est pas celle de la page ouverte (dev), coller l'adresse de retour dans « Configuration du serveur ».
2. **Associer** chaque compte bancaire à un compte Suzanne (ou « Ne pas synchroniser ») et choisir la date de début.
3. **Synchroniser** (bouton, puis automatiquement aux heures choisies, voir ci-dessous).

### Synchronisation automatique

- Par défaut **à 7 h et 19 h, heure de Paris**. Chaque profil choisit dans Réglages → Données : désactivée, ou 1 à 3 fois par jour, à l'heure voulue (fuseau du navigateur). Défaut du serveur : `BANK_SYNC_HOURS` (`7,19`) et `BANK_SYNC_TZ` (`Europe/Paris`) ; une valeur invalide est ignorée avec un avertissement au démarrage.
- **3 fois par jour au plus** : la DSP2 limite les lectures faites sans l'utilisateur à 4 par jour et par compte ; la marge laisse le bouton « Synchroniser » utilisable.
- Le serveur vérifie toutes les 15 minutes. **Une seule tentative par créneau**, réussie ou non : une banque en erreur n'est pas rappelée en boucle (le quota n'est pas épuisé), elle est retentée au créneau suivant. Une synchro manuelle dans les 2 h qui précèdent repousse le créneau. Un créneau manqué (serveur arrêté) est rattrapé une fois au redémarrage.
- **Une synchro à la fois par banque** : un clic sur « Synchroniser » pendant la synchro automatique (ou un double clic) répond « déjà en cours » au lieu d'importer deux fois.
- Erreurs : quota dépassé (429) → message clair, nouvel essai au créneau suivant ; accès expiré ou révoqué → connexion « expirée », plus de synchro automatique jusqu'au renouvellement ; un compte en échec n'empêche pas les autres comptes de la même banque d'être synchronisés. L'état et la dernière erreur sont visibles sur la carte de la banque et dans les alertes.

Ce que fait une synchro, pour chaque compte associé :

- Récupère les opérations **comptabilisées** depuis la dernière synchro (avec 10 jours de recouvrement) ou depuis la date de début ; les opérations **en attente** sont ignorées jusqu'à leur comptabilisation (leur identifiant change entre-temps chez certaines banques).
- **Reconnaît les opérations déjà présentes** (import CSV/OFX, saisie) : même compte, même montant, même date (puis ±3 jours). Elles ne sont pas dupliquées ; elles reçoivent l'identifiant bancaire et, si leur libellé était le début tronqué du libellé complet, le libellé complet (un libellé modifié à la main est conservé).
- Importe le reste par le pipeline d'import habituel : règles de catégorie et de tag, virements entre tes comptes reliés, projections de récurrents remplacées.
- Libellé = 1re ligne bancaire + motif, sans les références techniques (Réf, RUM, n° de mandat) ; le texte bancaire complet est gardé en **note de ligne**.
- Enregistre le **solde comptabilisé** (`CLBD`) comme relevé daté : le rapprochement compare aux opérations.

Le consentement expire (180 jours) : la carte de la banque passe en « bientôt » 7 jours avant, puis « expiré » ; « Renouveler l'accès » relance l'autorisation.

## Architecture

- `backend/src/lib/enableBanking.ts` : client API sans dépendance (JWT RS256 via `node:crypto`, banques, autorisation, session, soldes, opérations paginées).
- `backend/src/lib/bankSync.ts` : `state` signé (HMAC, lié au profil, 1 h), connexions, reprise de l'existant, import via `dedupeAndInsert`, relevé de solde, planificateur.
- `backend/src/routes/bank.ts` : `/users/:user_id/bank` (état), `/bank/check`, `/bank/aspsps`, `/bank/auth`, `/bank/callback`, `PATCH /bank/links/:id`, `/bank/connections/:id/sync`, `DELETE /bank/connections/:id`.
- Tables `bank_connections` et `bank_links` (migration `20261117000000_bank_connections`), hors sauvegardes.
- Front : `frontend/src/pages/Bank.tsx` (Réglages → Données, `/bank`, `/bank/callback`).
- Outil de diagnostic : `npm run bank:poc -- check | banks FR bourso | auth | session | accounts | balances | transactions` (`tools/enable-banking.mts`, configuration dans `.env.enablebanking`, réponses brutes dans `.data/`).
- Tests : `backend/src/lib/enableBanking.test.ts`, `backend/src/test/bank.integration.test.ts`.

## Constats sur Boursorama (novembre 2026)

- Couvert (« Boursorama Banque », consentement 180 jours), ainsi que Fortuneo (bêta), Revolut, BNP Paribas (bêta), Hello Bank.
- Champs remplis : `entry_reference` (unique, stable), montant, sens, statut, dates, `remittance_information` (libellé complet + motif SEPA). Pas de nom de contrepartie séparé, pas de code commerçant ni de catégorie.
- Soldes : `CLBD` (comptabilisé) et `XPCD` (temps réel, avec les opérations en attente).
- À surveiller : les paiements carte en attente ont un identifiant provisoire (`avis-…`) ; vérifier qu'ils ne reviennent pas en double une fois comptabilisés (ils ne sont pas importés tant qu'ils sont en attente).
