import type { PricePoint } from '@suzanne/shared';
import { http } from './api';

export const pricesApi = {
  /** Cours de clôture d'un symbole (devise de cotation), servis par le cache market_data. */
  history: (symbol: string, from: string, to: string) =>
    http<PricePoint[]>(`/prices/${encodeURIComponent(symbol)}/history?from=${from}&to=${to}`),
};
