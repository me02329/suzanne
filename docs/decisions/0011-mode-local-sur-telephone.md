# ADR 0011 — Mode « local » : un profil dont les données vivent sur le téléphone

- Date : 20 novembre 2026
- Statut : **accepté — variante A′** (voir « Résultats du prototype » en fin de document)

## Contexte

L'application Android (`android/`) affiche l'app web d'un serveur Suzanne. On veut pouvoir
choisir, par profil, entre :

- **Serveur** (actuel) : les données sont sur le serveur auto-hébergé, l'app n'est qu'une
  fenêtre dessus ;
- **Local** : les données sont sur le téléphone, sans serveur, « comme une app normale ».

Tout le métier vit aujourd'hui côté serveur : Express + Prisma 7 + Postgres, 31 fichiers de
routes, 32 modèles, environ 5 500 lignes dans `backend/src/lib` (registre à lignes, soldes par
ancres, moteur de budgets, sauvegarde v3, synchro bancaire, assistant IA). Le frontend ne fait
qu'afficher et appeler l'API. CLAUDE.md impose de ne jamais re-dériver dépense / revenu hors de
`ledger.ts` : dupliquer le métier côté client irait à l'encontre de cette règle.

## Options étudiées

### A. Serveur embarqué dans l'app : même backend, base sur le téléphone

Le backend Node tourne dans l'APK (nodejs-mobile) et parle à une base locale : PGlite
(Postgres compilé en WebAssembly) via un adaptateur Prisma. La WebView ouvre
`http://127.0.0.1:<port>` au lieu du serveur distant.

- **+** Le même code métier, les mêmes migrations, le même test golden : aucun risque de
  divergence des chiffres.
- **+** Passage d'un mode à l'autre par la **sauvegarde v3** existante (export complet,
  import atomique et idempotent) : « envoyer ce profil sur mon serveur » / « le récupérer en
  local ».
- **−** APK plus lourd (≈ 40 à 70 Mo au lieu de 50 Ko) ; démarrage plus lent la première fois.
- **−** Deux briques à valider sur Android : nodejs-mobile (maintenu mais peu répandu) et
  l'adaptateur Prisma ↔ PGlite.
- **−** Tâches planifiées (synchro bancaire automatique, alertes) : elles ne tournent que
  l'app ouverte, sauf à ajouter un WorkManager Android.
- **−** Synchro bancaire en local : la clé privée Enable Banking devrait être sur le téléphone
  (chiffrée par le Keystore Android). C'est faisable, mais plus exposé que sur un serveur.

### B. Réécrire la couche de données dans le client

Une base SQLite dans la WebView (wa-sqlite / OPFS) et toutes les routes réécrites en
TypeScript côté client.

- **−** Le métier serait écrit deux fois et finirait par diverger : les soldes, flux et
  budgets donneraient des chiffres différents selon le mode. Contraire au principe « une seule
  source pour dépensé / reçu ».
- **−** C'est le plus gros chantier, de plusieurs semaines.

### C. Local-first avec synchronisation téléphone ⇄ serveur

Une base sur le téléphone, répliquée avec le serveur (journal d'opérations, CRDT ou
réplication Postgres).

- **+** Le meilleur des deux mondes : utilisable hors ligne, partagé avec le foyer.
- **−** Le plus complexe : résolution de conflits sur des écritures comptables (opérations,
  ancres de solde, rapprochement), identités déjà prêtes (UUID, ADR 0004) mais protocole à
  écrire. Ce n'est pas un premier pas raisonnable.

### D. Rester en mode serveur, avec une lecture hors ligne

Garder le serveur comme seule source et mettre en cache la dernière vue (service worker),
en lecture seule quand le serveur est injoignable.

- **+** Peu coûteux, aucun risque sur les données.
- **−** Ne répond pas au besoin « sans serveur du tout ».

## Recommandation

**Option A**, en deux temps :

1. **Prototype (2 à 4 jours)** pour valider le plus risqué avant de s'engager : backend actuel
   dans nodejs-mobile, Prisma + PGlite, migrations appliquées au premier lancement, test golden
   exécuté contre PGlite, taille de l'APK et temps de démarrage mesurés sur un vrai téléphone.
   Si une brique ne tient pas, on s'arrête là (et l'option D reste possible).
2. **Intégration** si le prototype passe :
   - l'écran de premier lancement propose « Mon serveur » ou « Sur ce téléphone » ;
   - transfert d'un mode à l'autre par sauvegarde v3 ;
   - sauvegarde locale automatique (fichier exportable) puisqu'un téléphone se perd ;
   - synchro bancaire locale en option, clé dans le Keystore Android.

On écarte B (double métier) et on garde C comme évolution éventuelle, une fois A en place :
les identités stables et la sauvegarde idempotente en sont déjà les fondations.

## Conséquences si A est retenu

- Le backend doit rester agnostique de Postgres « serveur » : pas d'extension Postgres
  absente de PGlite, pas de dépendance au système de fichiers hors d'un dossier de données
  configurable.
- La CI ajoute un passage du test golden sur PGlite.
- `android/` gagne un module natif (nodejs-mobile) : le build de l'APK devient plus long et
  plus lourd ; le mode serveur seul reste possible (variante de build).
- Le profil local n'est pas partagé avec le foyer (pas de multi-appareil sans serveur).

## Résultats du prototype (20 novembre 2026) — variante A′ retenue

**L'option A telle que décrite est bloquée** : nodejs-mobile, seul moyen d'exécuter Node sur
Android, est figé sur Node 18 (dernière version 18.20.4, octobre 2024 —
[releases](https://github.com/nodejs-mobile/nodejs-mobile/releases)) alors que Prisma 7 exige
Node 20.19 ou plus ([exigences système](https://www.prisma.io/docs/orm/v7/reference/system-requirements)).

**Variante A′ : le même backend, exécuté dans la WebView.** Prisma 7 n'a plus de moteur natif :
son client « edge » embarque le moteur de requêtes en WebAssembly ; PGlite est Postgres compilé
en WebAssembly, persistant dans IndexedDB ; l'adaptateur `pglite-prisma-adapter` (≥ Prisma 7.1)
les relie. Mesures du prototype (branche `spike/mode-local-pglite`) :

- Backend sur PGlite (Node) : **test golden identique**, 69/70 tests d'intégration (le 70ᵉ
  est un effet de vitesse sur deux synchros bancaires simultanées, fonction exclue en local).
  Seul écart de comportement : une violation d'unicité remonte en `23505` (SQLSTATE) au lieu de
  `P2002` — à accepter dans le gestionnaire d'erreurs.
- Prisma edge + PGlite **dans Chromium et dans la WebView Android** : écriture, lecture,
  transactions interactives, persistance après redémarrage de l'app.
- Premier lancement : 39 migrations = 5,6 s sur PC, 174 s sur émulateur sans accélération →
  **base pré-migrée livrée en instantané** (`dumpDataDir`, 6,6 Mo compressé) : 1,7 s sur PC,
  ~10 s sur l'émulateur ; relance ~0,8 s sur PC.

**Architecture retenue :**

- Build « local » distinct du frontend (Vite) avec alias : `express` → petit routeur compatible
  (Router get/post/put/patch/delete/use, paramètres d'URL, `json/status/send/setHeader`,
  `write/end` pour le flux de l'assistant), `@prisma/client` → client edge, module prisma du
  navigateur (PGlite), `Buffer` / `node:crypto` → équivalents navigateur. **Le code des routes
  et du métier n'est pas modifié** ; l'extension « corbeille » (soft-delete) est partagée entre
  les deux modules prisma.
- Branchement par interception de `fetch` sur `/api/…` (couvre `http`, téléchargements,
  recherche, flux de l'assistant) avec de vraies `Response` (JSON sérialisé comme sur le réseau).
- Le gestionnaire local tourne aussi sous Node : le test golden passe par lui (même chemin que
  le téléphone, hors navigateur).
- Android : fichiers du mode local livrés dans l'APK, servis depuis une origine https interne
  fixe (contexte sécurisé, IndexedDB lié à l'origine — elle ne doit jamais changer).
- Mises à jour : noms des migrations appliquées conservés sur l'appareil ; au lancement, les
  manquantes sont appliquées après un export automatique.
- **Coupé en local** : synchro bancaire (clé privée, appels au fournisseur) ; assistant IA
  selon que le fournisseur autorise les appels depuis un navigateur (CORS).
- À vérifier pendant le développement : requêtes concurrentes sur l'unique connexion PGlite
  (sinon sérialiser), empreintes d'import identiques à `node:crypto`, golden sous d'autres
  fuseaux horaires, durabilité après arrêt forcé, instantané servi en `.tar.gz` brut.
