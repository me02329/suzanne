import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  ai: {
    provider: process.env.AI_PROVIDER ?? 'openai',
    apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'gpt-4.1-mini',
    baseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
  },
};
