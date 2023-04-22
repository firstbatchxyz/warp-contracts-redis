import { createClient } from "@redis/client";

export type RedisClient = ReturnType<typeof createClient>;

export type RedisCacheOptions = {
  prefix: string;
  client: RedisClient;
  maxEntriesPerContract?: number;
  minEntriesPerContract?: number;
  allowAtomics?: boolean;
};
