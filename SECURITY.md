# Politique de sécurité

## Modèle de sécurité

Suzanne est prévue pour une instance personnelle ou familiale, derrière un VPN, un réseau privé ou un reverse-proxy authentifié. L'application n'a pas d'authentification multi-utilisateurs complète.

Ne l'expose pas directement sur Internet sans couche d'authentification externe.

## Signaler une vulnérabilité

Pour une vulnérabilité sensible, utilise les GitHub Security Advisories du dépôt si elles sont disponibles. À défaut, ouvre une issue avec un minimum d'information exploitable sans publier de secret, de données personnelles ou d'exemple de base réelle.

Inclure si possible :

- la version ou le commit testé ;
- les étapes de reproduction ;
- l'impact attendu ;
- la configuration de déploiement concernée.

## Secrets et données

Ne joins jamais de fichier `.env`, d'export JSON/CSV réel, de dump PostgreSQL, de clé API ou de capture contenant des données financières personnelles.
