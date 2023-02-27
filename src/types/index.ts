import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

export type RedisCacheOptions = {
  prefix: string;
  client: RedisClient;
  maxEntriesPerContract?: number;
  minEntriesPerContract?: number;
};
