-- Type de compte « Prêt accordé » : argent prêté à un tiers (créance, actif).
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'receivable';
