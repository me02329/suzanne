import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`[suzanne-lite] listening on :${config.port} (env=${config.nodeEnv})`);
});
