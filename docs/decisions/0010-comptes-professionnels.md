# ADR 0010 — Comptes professionnels hors des finances personnelles

- Date : 14 novembre 2026
- Statut : accepté (branche `dev`)

## Contexte

Un utilisateur dirigeant d'une SASU suit le compte bancaire de sa société (synchronisé comme
les autres) pour comprendre les virements entre ses comptes et ceux de la société. Mais la
société est une personne morale (comptabilité, IS et TVA propres) : ses achats et ses recettes
ne sont ni des dépenses ni des revenus personnels.

## Décision

- Drapeau `accounts.professional` (« Compte professionnel (société) »), indépendant du type.
- `txFlows` reçoit un filtre de comptes exclus : les lignes d'un compte professionnel ne
  produisent aucun flux. Dashboard, statistiques, budgets, tags, assistant et alertes globales
  l'utilisent ; le journal affiche ces opérations avec un badge PRO, hors de ses totaux.
- Patrimoine : groupe « Société » (trésorerie de la société, comptée à part).
- Virements : perso → société (apport, avance en compte courant d'associé) = virement neutre,
  relié automatiquement ; société → perso n'est **pas** relié automatiquement, car c'est le
  plus souvent un salaire ou des dividendes (revenu personnel imposable). Un remboursement
  d'avance se repasse à la main en virement.
- Les anomalies (doublons, opérations sans compte) restent calculées sur le compte pro.

## Conséquences

- Aucun chiffre existant ne change sans compte professionnel (test golden inchangé).
- La valeur des parts de la société n'est pas estimée : seule sa trésorerie apparaît.
