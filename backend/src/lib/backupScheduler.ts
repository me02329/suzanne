import { prismaBase } from '../prisma.js';
import { createBackup } from '../routes/system.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Sauvegarde automatique quotidienne par utilisateur, avec rotation (gérée dans
// createBackup). On évite d'en créer une si une auto existe déjà depuis < 20h
// (un redémarrage ne doit pas multiplier les snapshots).
export function startBackupScheduler(): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const users = await prismaBase.user.findMany({ select: { id: true } });
      const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
      let created = 0;
      for (const user of users) {
        const recent = await prismaBase.backup.findFirst({ where: { user_id: user.id, auto: true, created_at: { gte: since } }, select: { id: true } });
        if (recent) continue;
        await createBackup(user.id, `Sauvegarde auto du ${new Date().toLocaleDateString('fr-FR')}`, true);
        created += 1;
      }
      if (created > 0) console.log(`[suzanne] created ${created} automatic backup(s)`);
    } catch (error) {
      console.error('[suzanne] backup scheduler failed', error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), ONE_DAY_MS);
  timer.unref?.();
}
