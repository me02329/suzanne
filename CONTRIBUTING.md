# Contribuer

Merci de garder les contributions centrées sur le périmètre du projet : une application de finances personnelles auto-hébergée, simple à déployer et destinée à rester sur un réseau privé.

## Développement local

```bash
npm install
cp .env.example .env
docker compose -f compose.dev.yml up -d postgres
npm run migrate:dev -w @suzanne/backend
npm run db:seed
npm run dev:backend
npm run dev:frontend
```

## Validation avant PR

```bash
npm test
npm run build
```

Lance aussi `npm run test:integration` si tu touches aux routes backend, à Prisma, aux migrations, aux imports/exports ou au scoping utilisateur.

## Règles de contribution

- Ne commite jamais de données financières réelles, d'exports JSON/CSV, de captures contenant des données personnelles, ni de fichier `.env`.
- Valide toute entrée API avec Zod dans `backend/src/lib/validation.ts`.
- Préserve le scoping par `user_id` dans chaque route et helper backend.
- Ajoute des tests ciblés pour les helpers purs, les règles de validation, les migrations sensibles et les comportements financiers.
- Garde l'interface en français tant que l'i18n n'est pas en place.

## Sécurité

Le projet n'a pas d'authentification applicative complète. Toute contribution qui facilite une exposition publique doit inclure une analyse explicite du modèle de menace et de la configuration attendue.
