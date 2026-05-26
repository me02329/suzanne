// Arrondi monétaire au centime pour limiter la dérive des nombres flottants.
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
