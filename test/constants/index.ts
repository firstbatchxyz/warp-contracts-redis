import { CacheOptions } from "warp-contracts";
import { RedisOptions } from "../../src";

export default {
  JEST_AFTERALL_TIMEOUT: 1000,
  CACHE_OPTS: {
    inMemory: true,
    dbLocation: "warpcc-redis-test",
    subLevelSeparator: "|",
  } satisfies CacheOptions,
  REDIS_OPTS: {
    url: "redis://default:redispw@localhost:6379",
    minEntriesPerContract: 10,
    maxEntriesPerContract: 100,
  } satisfies RedisOptions,
} as const;
