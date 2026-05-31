-- Mois cible (1-12) pour les récurrents annuels : permet de choisir "tous les
-- ans en mars" au lieu de dépendre du mois de création. NULL pour les autres
-- fréquences et les récurrents annuels existants (comportement inchangé).
ALTER TABLE "recurring_transactions" ADD COLUMN "month_of_year" INTEGER;
