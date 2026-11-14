# ADR 0007 — Localisation par clés stables et catalogues CSV `keys,fr,en`

- Date : 13 novembre 2026 (outillage : 14 novembre 2026)
- Statut : accepté — appels t() convertis (14 novembre 2026), textes écrits en dur à migrer

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

- Fait le 14 novembre 2026 : les 492 appels `t('Phrase')` convertis (373 clés, anglais
  complété), libellés de navigation (`lib/nav.ts`) et options de préférences passés en clés
  (données passées à `t()` par variable : une clé écrite en toutes lettres dans le code
  compte comme utilisée), `i18n_data.json` supprimé.
- Reste : les textes encore écrits en dur dans le JSX (~880), écran par écran ; les pluriels
  écrits en ternaire (`n > 1 ? … : …`) à passer en `_one` / `_other`. Une fois
  `i18n:check --strict` au vert, `--strict` passe en CI.
