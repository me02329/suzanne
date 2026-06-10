import { prisma } from '../prisma.js';
import { generateDueRecurringTransactions } from '../routes/recurring.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function startRecurringScheduler(): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      let generated = 0;
      const today = new Date();
      for (const user of users) {
        generated += await generateDueRecurringTransactions(user.id, today);
      }
      if (generated > 0) {
        console.log(`[suzanne-lite] generated ${generated} recurring transaction(s)`);
      }
    } catch (error) {
      console.error('[suzanne-lite] recurring scheduler failed', error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), ONE_DAY_MS);
  timer.unref?.();
}
