import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

export type RedisCacheOptions = { prefix: string; client: RedisClient };
