import { Router } from 'express';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { getPriceHistory } from '../lib/priceHistory.js';
import { quoteSymbol, searchSymbols } from '../lib/symbolSearch.js';

export const pricesRouter = Router();

const SYMBOL_RX = /^[A-Za-z0-9.^=_-]{1,32}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/prices/:symbol/history?from=YYYY-MM-DD&to=YYYY-MM-DD → [{ date, price }]
// Cours de clôture (devise de cotation), servis depuis market_data après un
// unique appel Yahoo pour la plage.
pricesRouter.get('/prices/:symbol/history', asyncHandler(async (req, res) => {
  const symbol = String(req.params.symbol ?? '');
  if (!SYMBOL_RX.test(symbol)) throw new HttpError(400, 'Symbole invalide');
  const today = new Date().toISOString().slice(0, 10);
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? today);
  if (!DAY_RX.test(from) || !DAY_RX.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw new HttpError(400, 'Dates attendues au format AAAA-MM-JJ');
  }
  if (from > to) throw new HttpError(400, 'from doit précéder to');
  if (Date.parse(to) - Date.parse(from) > 40 * 366 * 86_400_000) throw new HttpError(400, 'Période trop longue');
  try {
    res.json(await getPriceHistory(symbol, from, to > today ? today : to));
  } catch {
    throw new HttpError(502, 'Cours indisponibles pour le moment');
  }
}));

// GET /api/prices/search?q=world → titres proposés par Yahoo (autocomplétion).
pricesRouter.get('/prices/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  if (!q) { res.json([]); return; }
  try {
    res.json(await searchSymbols(q));
  } catch {
    throw new HttpError(502, 'Recherche de titres indisponible pour le moment');
  }
}));

// GET /api/prices/:symbol/quote → nom, devise de cotation et dernier cours.
pricesRouter.get('/prices/:symbol/quote', asyncHandler(async (req, res) => {
  const symbol = String(req.params.symbol ?? '');
  if (!SYMBOL_RX.test(symbol)) throw new HttpError(400, 'Symbole invalide');
  try {
    res.json(await quoteSymbol(symbol));
  } catch {
    throw new HttpError(502, 'Cours indisponible pour ce symbole');
  }
}));
