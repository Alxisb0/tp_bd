// Connexion Redis partagee : cache (cache.js) et suivi des rapports (rapports.js).
import Redis from 'ioredis';

export const URL_REDIS = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(URL_REDIS, { maxRetriesPerRequest: 1 });
redis.on('error', (e) => console.error('[redis]', e.message));
