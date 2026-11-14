import { createApp } from './app.js';
import { config } from './config.js';
import { startRecurringScheduler } from './lib/recurringScheduler.js';
import { startBackupScheduler } from './lib/backupScheduler.js';
import { startBankSyncScheduler } from './lib/bankSync.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`[suzanne] listening on :${config.port} (env=${config.nodeEnv})`);
  startRecurringScheduler();
  startBackupScheduler();
  startBankSyncScheduler();
});
