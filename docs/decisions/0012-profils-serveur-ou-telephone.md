# ADR 0012 — Profils « serveur » ou « téléphone », et passage de l'un à l'autre

- Date : 23 novembre 2026
- Statut : accepté — révisé le 23 novembre 2026 (interface toujours embarquée, pont HTTP natif)

## Contexte

Depuis l'ADR 0011, l'app Android sait faire tourner Suzanne sur le téléphone (mode local)
ou afficher un serveur. Mais tout ou rien : l'app est soit sur le serveur, soit sur le
téléphone. On veut que **chaque profil** ait son mode, et pouvoir faire passer un profil
d'un mode à l'autre en choisissant le sort de ses données.

Deux manques bloquaient :

- les profils (`users`) n'avaient pas d'identité stable — seulement un nom et un numéro
  propre à chaque base. Impossible de reconnaître « le même profil » des deux côtés ;
- l'import décidait « c'est le profil d'origine » en comparant ce **numéro**
  (`payload.user.id === user_id`) : entre deux bases, le profil n°1 du téléphone et le
  n°1 du serveur peuvent être deux profils différents, et des numéros d'éléments non
  remappés auraient été pris pour des lignes existantes du mauvais profil.

## Décision

**Identité.** `users.uid` (UUID stable, comme les autres entités — ADR 0004), exporté dans
la sauvegarde v3 (`user: { id, uid, name }`). « Même profil » = même `uid` ; l'ancien
critère par numéro ne vaut plus que pour une sauvegarde sans `uid` (fichiers antérieurs).

**Transfert = sauvegarde v3.** Passer un profil d'un mode à l'autre, c'est exporter côté
source, importer côté destination, **vérifier**, puis selon le choix :

- *Déplacer* (proposé par défaut) : l'export est d'abord gardé dans Téléchargements ; la
  source n'est supprimée qu'**après** vérification ;
- *Copier* : la source reste, les deux évoluent séparément ;
- *Repartir de zéro* : profil vide à destination, source intacte.

À destination, le profil est retrouvé par son `uid` ; s'il existe déjà, **fusion sans
doublons** (mécanismes d'import existants : uid, empreintes, clés de contenu). Sinon il
est créé **sans** les données par défaut (compte et catégories d'un nouveau profil, qui
entreraient en collision avec celles importées). Un nom déjà pris par un autre profil :
on reprend le profil homonyme s'il est vide, sinon on suffixe le nom.

Vérification : les `uid` de la source (comptes, catégories, opérations, tags,
établissements, récurrents, objectifs) doivent tous se retrouver à destination, et les
autres éléments y être au moins aussi nombreux (`GET /users/:id/transfer-check` des deux
côtés). *Repartir de zéro* crée un profil neuf (nouvel `uid`) : un transfert ultérieur ne
le fusionnera pas avec l'original. Avant d'exporter quoi que ce soit vers un serveur, l'app
vérifie qu'il connaît `/profiles/import` ; sinon : « mets à jour ton serveur ».

**Organisation dans l'app Android — l'interface est toujours celle de l'APK.** L'app
affiche toujours son interface embarquée (`https://suzanne.local`, servie depuis l'APK).
Le profil actif `{côté, profil}` est retenu sur l'appareil ; tous les `fetch('/api/…')` de
l'interface vont au côté actif, et changer de côté recharge l'app :

- côté *téléphone* : serveur Suzanne embarqué + PGlite (ADR 0011), démarrés seulement si un
  profil du téléphone sert (côté actif, page Profils, transfert) ;
- côté *serveur* : **pont HTTP natif** (`SuzanneHttp`, `NativeHttp.java`). La page confie la
  requête à l'app, qui l'exécute et rend statut, en-têtes et corps (par morceaux en base64,
  via des fichiers temporaires ; annulation possible). Le pont n'accepte que les appels de
  `suzanne.local` vers l'origine du serveur configuré (pas de mandataire ouvert), sans
  suivre de redirection.

Pourquoi un pont plutôt que `fetch` direct : vérifié sur WebView, un certificat auto-signé
n'arrive jamais à `onReceivedSslError` pour un `fetch` (échec sans recours), et un serveur
`http` est bloqué depuis une page `https` (contenu mixte). Le pont réutilise la confiance
accordée à l'écran de connexion (« Faire confiance à ce serveur ») et évite CORS. Mesuré
sur émulateur : 100 à 200 ms par appel, ~0,5 Mo/s en envoi.

Écarté : afficher l'interface du serveur pour les profils serveur (première version de cet
ADR). Deux interfaces de versions différentes dans une même app, des préférences d'appareil
(barre du bas, thème) perdues à chaque changement de côté, et le passage d'un profil aurait
dû être orchestré par l'app native.

## Conséquences

- Migration `users.uid` (remplie pour les profils existants), couverte par le test golden.
- Côté serveur : import « dans le profil désigné par l'uid » (`POST /profiles/import`) et
  résumé de vérification. Un serveur non mis à jour refuse le transfert avant tout export.
- L'interface de l'app suit les versions de l'APK, plus celles du serveur : une nouveauté
  d'interface arrive par une mise à jour de l'app ; une nouveauté d'API demande aussi de
  mettre le serveur à jour.
- Le jeton d'accès (`APP_TOKEN`) est rangé sous l'adresse du serveur ; les préférences
  d'appareil vivent sur `suzanne.local` (à ressaisir une fois en passant à cette version).
- Synchro bancaire : un profil passé sur le téléphone ne se synchronise plus (prévenu dans
  l'assistant de transfert). Les réglages de l'assistant IA sont propres à chaque côté.
- Le site dans un navigateur ne change pas : un seul côté, le serveur.
