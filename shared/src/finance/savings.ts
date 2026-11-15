// Taux d'épargne mensuel et détection du « se payer en premier » (calcul pur).

/** Taux d'épargne moyen des ménages français (INSEE, ordre de grandeur). */
export const FRENCH_AVERAGE_SAVINGS_RATE = 0.14;

export function monthlySavingsRates(months: Array<{ month: string; income: number; expenses: number }>): Array<{ month: string; rate: number | null }> {
  return months.map((m) => ({ month: m.month, rate: m.income > 0 ? (m.income - m.expenses) / m.income : null }));
}

export interface SavingTransfer { date: string; amount: number; to: string }
export interface IncomeEvent { date: string; amount: number }

/**
 * Pour chacun des `months` (AAAA-MM), le premier virement vers l'épargne (ou
 * un placement) fait dans les 7 premiers jours du mois ou dans les 5 jours qui
 * suivent le plus gros revenu du mois — signe d'un « se payer en premier ».
 */
export function payYourselfFirst(months: string[], transfers: SavingTransfer[], incomes: IncomeEvent[]) {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400_000;
  const detail = months.map((month) => {
    const salary = incomes.filter((i) => i.date.startsWith(month)).sort((a, b) => b.amount - a.amount)[0];
    const early = transfers
      .filter((t) => {
        const d = day(t.date);
        const inFirstWeek = t.date.startsWith(month) && Number(t.date.slice(8, 10)) <= 7;
        const afterSalary = salary != null && d >= day(salary.date) && d - day(salary.date) <= 5;
        return inFirstWeek || afterSalary;
      })
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return { month, transfer: early ?? null };
  });
  const hits = detail.filter((d) => d.transfer);
  const amounts = hits.map((d) => d.transfer!.amount).sort((a, b) => a - b);
  return {
    detail,
    count: hits.length,
    /** Montant médian des versements repérés. */
    typicalAmount: amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)]! : null,
    destination: hits.at(-1)?.transfer?.to ?? null,
  };
}
