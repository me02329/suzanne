# ADR 0012 — Profils « serveur » ou « téléphone », et passage de l'un à l'autre

- Date : 23 novembre 2026
- Statut : accepté (en cours de réalisation, par étapes)

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
  source n'est supprimée qu'**après** vérification (nombre d'éléments, soldes des comptes) ;
- *Copier* : la source reste, les deux évoluent séparément ;
- *Repartir de zéro* : profil vide à destination, source intacte.

À destination, le profil est retrouvé par son `uid` ; s'il existe déjà, **fusion sans
doublons** (mécanismes d'import existants : uid, empreintes, clés de contenu). Sinon il
est créé **sans** les données par défaut (compte et catégories d'un nouveau profil, qui
entreraient en collision avec celles importées). Un nom déjà pris par un autre profil :
on reprend le profil homonyme s'il est vide, sinon on suffixe le nom.

**Organisation dans l'app Android.** Chaque profil garde l'interface de son côté : un
profil serveur s'affiche depuis le serveur (à jour sans réinstaller l'app), un profil
téléphone depuis l'app (`https://suzanne.local`). L'app native tient la liste des profils
des deux côtés et orchestre le passage (navigation, transfert, reprise si l'app est tuée
en cours). Écarté : charger toujours l'interface de l'APK et appeler le serveur depuis une
autre origine (CORS à ouvrir, certificat auto-signé, jeton par origine, interface figée à
la version de l'APK).

## Conséquences

- Migration `users.uid` (remplie pour les profils existants), couverte par le test golden.
- Côté serveur : import « dans le profil désigné par l'uid » (création si besoin) et
  résumé de vérification. Un serveur non mis à jour ne propose pas le transfert.
- Synchro bancaire : un profil passé sur le téléphone ne se synchronise plus (prévenu dans
  l'assistant de transfert). Les réglages de l'assistant IA sont propres à chaque côté.
- Le site dans un navigateur ne change pas : la notion de profil « téléphone » n'existe
  que dans l'app Android.
