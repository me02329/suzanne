import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/errors.js';
import { appTokenAuth } from './middleware/auth.js';
import { auditLog } from './middleware/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  // gzip every response: the dashboard ships the full transaction set and
  // wealth-history many points — JSON compresses ~85%, cutting transfer time.
  app.use(compression());
  // Le front est servi par l'app elle-même (même origine) : pas de CORS
  // ouvert, sinon n'importe quel site visité pourrait appeler l'API locale.
  // CORS_ORIGIN (liste séparée par des virgules) pour un front servi ailleurs.
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  if (corsOrigins && corsOrigins.length > 0) app.use(cors({ origin: corsOrigins }));
  if (process.env.NODE_ENV === 'production' && !process.env.APP_TOKEN?.trim()) {
    console.warn("[suzanne] APP_TOKEN non défini : l'API est accessible sans authentification.");
  }
  // La restauration d'une sauvegarde JSON embarque les pièces jointes (base64) :
  // limite relevée pour cette seule route, 25 Mo partout ailleurs.
  const jsonDefault = express.json({ limit: '25mb' });
  const jsonBackup = express.json({ limit: '250mb' });
  app.use((req, res, next) => (req.path.endsWith('/import.json') ? jsonBackup : jsonDefault)(req, res, next));
  app.use(healthRouter);
  app.use('/api', appTokenAuth());
  app.use('/api', auditLog());
  app.use('/api', apiRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  const publicDir = path.resolve(__dirname, '../public');
  // Les fichiers /assets/* sont hashés par Vite : sûrs à mettre en cache long terme.
  app.use(
    '/assets',
    express.static(path.join(publicDir, 'assets'), { immutable: true, maxAge: '1y' }),
  );
  // index.html ne doit jamais être mis en cache, sinon il référence un bundle disparu
  // après un déploiement → écran blanc tant qu'on n'a pas fait un hard refresh.
  app.use(
    express.static(publicDir, {
      setHeaders: (res, file) => {
        if (file.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use(errorHandler);
  return app;
}
