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

L'APK est signé avec la clé de débogage de la machine qui l'a construit : pour
mettre à jour l'app sans la désinstaller, reconstruis-la sur la même machine.
