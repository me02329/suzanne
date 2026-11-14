# ADR 0007 — Localisation par clés stables et catalogues CSV `keys,fr,en`

- Date : 13 novembre 2026 (outillage : 14 novembre 2026)
- Statut : accepté — outillage en place, migration des écrans à faire

## Contexte

Les traductions utilisaient la phrase française comme clé (`t('Enregistrer')`) dans un JSON
unique : reformuler le français perd la traduction en silence. La refonte a ajouté de
nombreux textes non traduits.

## Décision

Même approche que le jeu « At the End of the World » (son ADR 0036) : clés stables
(`budgets.hero.remaining`), catalogues par domaine au format CSV `keys,fr,en`, français
langue source et de repli, conversion CSV → i18next au build, test qui vérifie que toute clé
utilisée existe dans un et un seul catalogue et qu'aucune case n'est vide.

## Mise en œuvre

- **Catalogues** : `frontend/src/i18n/catalogs/<domaine>.csv`, en-tête `keys,fr,en`, une ligne
  par texte. CSV RFC 4180 : un texte contenant une virgule, un guillemet ou un retour à la
  ligne est entre guillemets (`""` pour un guillemet). Domaines : `ui` (coquille, composants
  génériques), `commun` (texte partagé par plusieurs domaines), `accueil`, `operations`,
  `comptes`, `patrimoine`, `budgets`, `analyses`, `reglages`.
- **Clés** : segments en minuscules séparés par des points, au moins deux
  (`/^[a-z0-9_]+(\.[a-z0-9_]+)+$/`), premier segment = domaine. Une clé n'existe que dans un
  catalogue. Interpolation i18next (`{{amount}}`) ; pluriels par suffixes `_one` / `_other`.
- **Chargement** : `frontend/src/i18n/catalog.ts` (module pur : parseur CSV, contrôles,
  construction des ressources) ; `index.ts` lit les catalogues avec `import.meta.glob(…, ?raw)`,
  donc au build, sans JSON intermédiaire.
- **Transition** : l'ancien `i18n_data.json` (clé = phrase française) reste chargé tant que des
  écrans l'utilisent. `npm run i18n:migrate` convertit d'un coup tous les appels `t('Phrase')`
  en clés stables (domaine d'après le fichier, nom d'après la traduction anglaise), écrit les
  catalogues et vide le JSON. Il simule par défaut et refuse `--write` si le frontend a des
  modifications non commitées. `--missing` liste les phrases sans anglais ;
  `--translations=en.json` les complète avant de nommer les clés.
- **Contrôle** : `npm run i18n:check` (en CI). Bloquant : catalogue mal formé, clé en double,
  case vide, clé présente à la fois dans un catalogue et dans l'ancien JSON. Rapporté
  (bloquant avec `--strict`) : clé utilisée absente, texte visible écrit en dur dans le JSX
  (repéré avec l'analyseur TypeScript ; `i18n-ignore` sur la ligne pour une exception
  voulue, ex. le nom de l'application). Rapporté seulement : clés inutilisées, appels à clé
  calculée (`t(item.label)`). Le test `catalog.test.ts` vérifie aussi les catalogues du dépôt.

## Conséquences

- Migration mécanique des écrans en trois temps : conversion automatique des appels existants,
  libellés de navigation (`lib/nav.ts`, clés calculées) à la main, puis textes encore écrits
  en dur, écran par écran ; traduction anglaise complétée au passage.
- Une fois `i18n:check --strict` au vert, `--strict` passe en CI et `i18n_data.json` est
  supprimé.
