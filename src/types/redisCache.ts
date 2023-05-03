/**
 * Redis client options.
 * - `url`
 * - `isAtomic` temporarily disables atomic operations
 * - `isManaged` temporarily disables atomic operations
 */
export type RedisOptions = {
  url: string;
  maxEntriesPerContract?: number;
  minEntriesPerContract?: number;
  isAtomic?: boolean;
  isManaged?: boolean;
};
