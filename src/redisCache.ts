import {
  CacheKey,
  genesisSortKey,
  LoggerFactory,
  SortKeyCache,
  SortKeyCacheResult,
  PruneStats,
  BatchDBOp,
  lastPossibleSortKey,
} from "warp-contracts";
import { createClient } from "redis";
import { RedisCacheOptions } from "types/redisCache";
import { SortKeyCacheRangeOptions } from "warp-contracts/lib/types/cache/SortKeyCacheRangeOptions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RedisCache<V = any> implements SortKeyCache<V> {
  private readonly logger = LoggerFactory.INST.create("RedisCache");
  prefix: string;
  client: ReturnType<typeof createClient>;
  maxEntriesPerContract?: number;
  minEntriesPerContract?: number;

  /**
   * Redis key to be used for the sorted set of SortKeys. You should expect
   * to use this only when working with Z commands of Redis, such as ZADD or ZRANGE.
   * We use `{prefix}.keys` for this.
   */
  private readonly sortedSetKey: string;

  /**
   * Maps a given `key` to actual Redis key derived from the prefix.
   * We use `{prefix}.{key}`.
   */
  private readonly keyToDBKey: (key: string) => string;

  /**
   * Maps a given `cacheKey` to actual Redis key derived from the prefix.
   * We use `{prefix}.{key}|{sortKey}`.
   */
  private readonly cacheKeyToDBSetKey: (cacheKey: CacheKey) => string;

  /**
   * Get all cache keys, with the prefix.
   * @returns an array of cacheKeys in the form `prefix.key|sortKey`
   */
  private async getAllCacheKeys(): Promise<string[]> {
    return this.client.ZRANGE(this.sortedSetKey, "-", "+", {
      BY: "LEX",
    });
  }

  /**
   * Get all keys, without the prefix or the sortKey suffixes.
   * @returns an array of keys
   */
  private async getAllKeys(): Promise<string[]> {
    const cacheKeys = await this.getAllCacheKeys();
    // map `prefix.key|sortKey` to `key` only
    const keys = cacheKeys.map((v) => v.slice(this.prefix.length + 1).split("|")[0]);
    // unique keys only
    return keys.filter((v, i, a) => a.indexOf(v) === i);
  }

  constructor(cacheOptions: RedisCacheOptions) {
    this.prefix = cacheOptions.prefix;
    this.client = cacheOptions.client;
    this.maxEntriesPerContract = cacheOptions.maxEntriesPerContract;
    this.minEntriesPerContract = cacheOptions.minEntriesPerContract;

    // closured utility functions
    this.sortedSetKey = `${this.prefix}.keys`;
    this.keyToDBKey = (key) => `${this.prefix}.${key}`;
    // maybe use cacheKeyToKey?
    this.cacheKeyToDBSetKey = (cacheKey) => `${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`;
  }

  /**
   * Deletes only a specific sortKey for some key.
   * @param cacheKey a key and sortKey
   */
  async del(cacheKey: CacheKey): Promise<void> {
    await this.client.del(this.cacheKeyToDBSetKey(cacheKey));
  }

  /**
   * Not implemented yet.
   * @ignore
   */
  begin(): Promise<void> {
    throw new Error("begin not implemented");
  }

  /**
   * Not implemented yet.
   * @ignore
   */
  rollback(): void {
    throw new Error("rollback not implemented");
  }

  /**
   * Not implemented yet.
   * @ignore
   */
  commit(): void {
    throw new Error("commit not implemented");
  }

  /**
   * Returns a key value map for a specified `sortKey` range.
   * @param sortKey reference SortKey
   * @param options and object with reference keys `lt` and `gte` for comparison, as well as `limit` and `reverse` options.
   */
  async kvMap(sortKey: string, options?: SortKeyCacheRangeOptions): Promise<Map<string, V>> {
    const map: Map<string, V> = new Map();

    const keys = await this.getAllKeys();
    if (options === undefined || (options.lt === undefined && options.gte === undefined)) {
      // need to get the key|sortKey for each key
      const cacheKeys = keys.map((key) => this.cacheKeyToDBSetKey({ key, sortKey }));
      // get values
      const values = this.client.MGET(cacheKeys);
      // create the map
      for (let i = 0; i < cacheKeys.length; ++i) {
        // not checking for `null` here because interface
        // expects V only; this is understanble, as we are getting
        // existing keys instead of querying a user key.
        map.set(cacheKeys[i], JSON.parse(values[i]) as V);
      }
    } else {
      // need to get many sortKey's for each key with respect to a range
      for (const key of keys) {
        // get sortKeys within the range for this key
        const cacheKeys = await this.client.ZRANGE(
          this.sortedSetKey,
          `[${key}|${options.lt || sortKey}`,
          `[${key}|${options.gte || sortKey}`,
          {
            // apparently you cant give `false` to `REV`
            REV: options.reverse ? true : undefined,
            BY: "LEX",
            LIMIT: options.limit
              ? {
                  count: options.limit,
                  offset: 0,
                }
              : undefined,
          }
        );
        // get corresponding values
        const values = this.client.MGET(cacheKeys);
        // create the map
        for (let i = 0; i < cacheKeys.length; ++i) {
          // not checking for `null` here because interface
          // expects V only; this is understanble, as we are getting
          // existing keys instead of querying a user key.
          map.set(cacheKeys[i], JSON.parse(values[i]) as V);
        }
      }
    }

    return map;
  }

  /**
   * Returns the value at the given key with respect to the sortKey.
   * @param cacheKey a key and sortKey
   * @returns value, `null` if it does not exist
   */
  async get(cacheKey: CacheKey): Promise<SortKeyCacheResult<V> | null> {
    // retrieve & parse result
    let result: V | null = null;
    const res = await this.client.get(this.cacheKeyToDBSetKey(cacheKey));
    if (res !== null) {
      result = JSON.parse(res) as V;
    }
    // return a sortKeyCacheResult, or null
    if (result) {
      return {
        sortKey: cacheKey.sortKey,
        cachedValue: result,
      };
    } else {
      return null;
    }
  }

  /**
   * Returns the latest value at the given key.
   * Internally calls `getLessOrEqual(key, lastSortKey)`
   * @param key key of the value
   * @returns value and it's sortKey, or null if it does not exist
   */
  async getLast(key: string): Promise<SortKeyCacheResult<V> | null> {
    return this.getLessOrEqual(key, lastPossibleSortKey);
  }

  /**
   * Returns the first value less than the given sortKey.
   * @param key key of the value
   * @param sortKey sortKey to be compared against
   * @returns value and it's sortKey, or null if it does not exist
   */
  async getLessOrEqual(key: string, sortKey: string): Promise<SortKeyCacheResult<V> | null> {
    const result = await this.client.ZRANGE(
      this.sortedSetKey,
      `[${key}|${sortKey}`, // including this key|sortKey, get all below
      "-", // equals `-inf` in lex ordering
      {
        REV: true,
        BY: "LEX",
        LIMIT: {
          count: 1,
          offset: 0,
        },
      }
    );

    if (result.length) {
      // we expect result[0] to be in form of a cacheKey
      const resultSplit = result[0].split("|");
      if (resultSplit.length !== 2 && resultSplit[0] !== key) {
        throw new Error("Result is not CacheKey");
      }

      // get the actual value at that key
      const cacheKey: CacheKey = { key: resultSplit[0], sortKey: resultSplit[1] };
      const value = await this.client.get(this.cacheKeyToDBSetKey(cacheKey));
      return {
        sortKey: cacheKey.sortKey,
        cachedValue: value && JSON.parse(value),
      };
    }
    return null;
  }

  /**
   * Puts a new value in cache under given `CacheKey`.
   * The respective key is updated with new value, and the string `key|sortKey`
   * is added to a sorted list also stored in cache.
   * @param cacheKey an object with `key` and `sortKey`
   * @param value new value
   */
  async put(cacheKey: CacheKey, value: V): Promise<void> {
    // put value
    await this.client.set(this.cacheKeyToDBSetKey(cacheKey), JSON.stringify(value));
    await this.client.ZADD(this.sortedSetKey, [{ score: 0, value: `${cacheKey.key}|${cacheKey.sortKey}` }]);
    // get total count of keys
    const count = await this.client.ZLEXCOUNT(
      this.sortedSetKey,
      `[${cacheKey.key}|${genesisSortKey}`, // '[' at the first character specifies inclusive range
      `[${cacheKey.key}|${cacheKey.sortKey}`
    );

    // if count is greater than maxEntriesPerContract, remove oldest entries amounting to (count - minEntriesPerContract)
    if (this.maxEntriesPerContract && this.minEntriesPerContract && count > this.maxEntriesPerContract) {
      const keysToRemove = await this.client.ZRANGE(
        this.sortedSetKey,
        `[${cacheKey.key}|${genesisSortKey}`,
        `[${cacheKey.key}|${cacheKey.sortKey}`,
        {
          BY: "LEX",
          LIMIT: {
            count: count - this.minEntriesPerContract,
            offset: 0,
          },
        }
      );
      await this.client.ZREM(this.sortedSetKey, keysToRemove);
      await this.client.del(keysToRemove.map(this.keyToDBKey));
    }
  }

  /**
   * Executes a list of operations in batch.
   * @todo can use `Promise.all` here
   * @param opStack a `BatchDBOp` object with `key` and operation `type`
   */
  async batch(opStack: BatchDBOp<V>[]) {
    for (const op of opStack) {
      if (op.type === "put") {
        await this.put(op.key, op.value);
      } else if (op.type === "del") {
        await this.delete(op.key);
      }
    }
  }

  /**
   * Removes all data at the given key.
   * This means finding all `sortKey`s associated with this data,
   * and removing all of them.
   * @param key key
   */
  async delete(key: string): Promise<void> {
    const keys = await this.client.ZRANGE(
      this.sortedSetKey, // key
      `[${key}|${genesisSortKey}`, // min
      `[${key}|${lastPossibleSortKey}`, // max
      { BY: "LEX" } // lexicographic order
    );
    await this.client.ZREM(this.sortedSetKey, keys);
    await this.client.del(keys.map(this.keyToDBKey));
  }

  /**
   * Returns all cached keys
   * @see {@link kvMap}
   */
  async keys(sortKey?: string, options?: SortKeyCacheRangeOptions): Promise<string[]> {
    return Array.from(await this.kvMap(sortKey, options).then((map) => map.keys()));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async prune(entriesStored = 1): Promise<PruneStats | null> {
    const keys = await this.getAllKeys();
    for (const key of keys) {
      const keysToRemove = await this.client.ZRANGE(
        this.sortedSetKey,
        `[${key}|${genesisSortKey}`,
        `[${key}|${lastPossibleSortKey}`,
        {
          BY: "LEX",
          LIMIT: {
            count: entriesStored,
            offset: 0,
          },
        }
      );
      await this.client.ZREM(`${this.prefix}.keys`, keysToRemove);
      await this.client.del(keysToRemove.map((k) => `${this.prefix}.${k}`));
    }
    return null;
    // TODO: return numbers as below
    // return {
    //   entriesBefore: 0,
    //   entriesAfter: 0,
    //   sizeBefore: 0,
    //   sizeAfter: 0,
    // };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async dump(): Promise<any> {
    throw new Error("dump not implemented");
  }

  /**
   * Get the last `sortKey`
   * @returns last `sortKey`, `null` if there is none
   */
  async getLastSortKey(): Promise<string | null> {
    const cacheKeys = await this.getAllCacheKeys();
    if (cacheKeys.length) {
      // map `prefix.key|sortKey` to `sortKey` only
      const sortKeys = cacheKeys.map((v) => v.slice(this.prefix.length + 1).split("|")[1]);
      // get the last one after sorting
      return sortKeys.sort().at(-1);
    } else {
      return null;
    }
  }

  /**
   * Calls `connect` function of Redis client.
   */
  async open(): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
        this.logger.info("Connected to Redis.");
      }
    } catch (err) {
      this.logger.error("Could not open Redis.", err);
    }
  }

  /**
   * Calls `disconnect` function of Redis client.
   */
  async close(): Promise<void> {
    try {
      if (this.client.isOpen) {
        await this.client.disconnect();
        this.logger.info("Disconnected from Redis.");
      }
    } catch (err) {
      this.logger.error("Could not close Redis.", err);
    }
  }

  storage<S>() {
    return this.client as S;
  }
}
