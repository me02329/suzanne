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
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));
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
