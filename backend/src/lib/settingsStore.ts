import { prisma } from '../prisma.js';
import { config } from '../config.js';

export interface AiRuntimeConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  provider: string;
  source: 'database' | 'environment' | 'mixed' | 'none';
}

const AI_KEYS = {
  apiKey: 'ai.apiKey',
  model: 'ai.model',
  baseUrl: 'ai.baseUrl',
  provider: 'ai.provider',
} as const;

async function readSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(AI_KEYS) } },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getAiConfig(): Promise<AiRuntimeConfig> {
  const dbValues = await readSettings();
  const dbKey = dbValues[AI_KEYS.apiKey] ?? '';
  const envKey = config.ai.apiKey;
  const apiKey = dbKey || envKey;
  const sources: Array<'database' | 'environment'> = [];
  if (dbKey) sources.push('database');
  if (envKey && !dbKey) sources.push('environment');
  return {
    apiKey,
    model: dbValues[AI_KEYS.model] || config.ai.model,
    baseUrl: dbValues[AI_KEYS.baseUrl] || config.ai.baseUrl,
    provider: dbValues[AI_KEYS.provider] || config.ai.provider,
    source: sources.length === 0 ? 'none' : sources.length === 1 ? sources[0]! : 'mixed',
  };
}

export interface AiSettingsUpdate {
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  provider?: string | null;
}

export async function updateAiSettings(update: AiSettingsUpdate): Promise<void> {
  const entries: Array<[string, string | null]> = [
    [AI_KEYS.apiKey, update.apiKey ?? null],
    [AI_KEYS.model, update.model ?? null],
    [AI_KEYS.baseUrl, update.baseUrl ?? null],
    [AI_KEYS.provider, update.provider ?? null],
  ];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (value === null || value === '') {
      await prisma.setting.deleteMany({ where: { key } });
    } else {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  }
}
