# Suzanne pour Android

Application Android légère : elle affiche l'app web de **ton** serveur Suzanne en
plein écran, sans barre de navigateur. Au premier lancement, elle demande
l'adresse du serveur (celle que tu tapes dans le navigateur), vérifie que c'est
bien Suzanne et la retient. Toutes les données restent sur le serveur.

- Liens externes (banque, documentation) : ouverts dans le navigateur.
- Exports et sauvegardes : enregistrés dans **Téléchargements**.
- Imports (CSV, OFX, pièces jointes) : sélecteur de fichiers Android.
- Serveur injoignable : écran « Réessayer / Changer de serveur ».
- Changer de serveur : appui long sur l'icône › « Changer de serveur ».
- http accepté (serveur sur un réseau privé), https aussi.

## Construire l'APK

Prérequis : Android SDK (platform 35) et un JDK 17.

```powershell
cd android
$env:JAVA_HOME = "C:\chemin\vers\jdk-17"
.\gradlew.bat assembleDebug
```

L'APK est dans `app/build/outputs/apk/debug/app-debug.apk`. Le chemin du SDK
se règle dans `local.properties` (`sdk.dir=…`, non versionné) ou via
`ANDROID_HOME`.

## Installer sur le téléphone

Copie l'APK sur le téléphone et ouvre-le (Android demande d'autoriser
l'installation depuis cette source), ou, téléphone branché en débogage USB :

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

L'APK debug est signé avec la clé de débogage de la machine qui l'a construit :
pour les vraies mises à jour, passe par les releases GitHub ci-dessous.

## Release GitHub (APK à installer depuis le téléphone)

Le workflow `.github/workflows/android-release.yml` construit un APK **signé
avec la clé release** et l'attache à une release GitHub à chaque tag
`android-v*` :

```bash
git tag android-v1.1.0
git push origin android-v1.1.0
```

Sur le téléphone : page **Releases** du dépôt → télécharger
`Suzanne-1.1.0.apk` → l'ouvrir. Une nouvelle version s'installe par-dessus
l'ancienne (même clé, `versionCode` croissant).

### Clé de signature (une fois)

La clé release (`suzanne-release.jks`) **ne va jamais dans git**. Si elle est
perdue, aucune mise à jour ne pourra s'installer par-dessus l'app existante :
garde-la avec ses mots de passe dans une sauvegarde. Le workflow la lit dans
les secrets du dépôt :

| Secret | Contenu |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | le fichier `.jks` encodé en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | mot de passe du magasin |
| `ANDROID_KEY_ALIAS` | alias de la clé (`suzanne`) |
| `ANDROID_KEY_PASSWORD` | mot de passe de la clé |

```bash
base64 -w0 suzanne-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # puis colle le mot de passe
gh secret set ANDROID_KEY_ALIAS --body suzanne
gh secret set ANDROID_KEY_PASSWORD
```

En local, les mêmes valeurs passent par les variables `SUZANNE_KEYSTORE`,
`SUZANNE_KEYSTORE_PASSWORD`, `SUZANNE_KEY_ALIAS`, `SUZANNE_KEY_PASSWORD`
(`.\gradlew.bat assembleRelease`).
