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

  constructor(cacheOptions: RedisCacheOptions) {
    this.prefix = cacheOptions.prefix;

    this.client = cacheOptions.client;
    this.maxEntriesPerContract = cacheOptions.maxEntriesPerContract;
    this.minEntriesPerContract = cacheOptions.minEntriesPerContract;
  }

  /**
   * Get all cache keys, without the prefix.
   * @returns an array of cacheKeys in the form `key|sortKey`
   */
  private async getAllCacheKeys(): Promise<string[]> {
    return this.client.ZRANGE(`${this.prefix}.keys`, "-", "+", {
      BY: "LEX",
    });
  }

  /**
   * Get all keys, without the prefix or the sortKey suffixes.
   * It is not guaranteed that each returned key has an entry with
   * the latest `sortKey`!
   * @returns an array of keys
   */
  private async getAllKeys(): Promise<string[]> {
    const cacheKeys = await this.getAllCacheKeys();
    // map `key|sortKey` to `key` only
    const keys = cacheKeys.map((v) => v.split("|")[0]);
    // unique keys only
    return keys.filter((v, i, a) => a.indexOf(v) === i);
  }

  /**
   * Given a key, returns the latest sortKey.
   * @param key a key
   * @param maxSortKey optional upper bound, defaults to `lastPossibleSortKey`
   * @returns the latest `sortKey` of this `key`
   */
  private async getLatestSortKey(key: string, maxSortKey?: string): Promise<string | null> {
    const result = await this.client.ZRANGE(
      `${this.prefix}.keys`,
      `[${key}|${maxSortKey || lastPossibleSortKey}`,
      "-",
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

      return resultSplit[1];
    }
    return null;
  }

  /**
   * Deletes only a specific `sortKey` for some `key`.
   * @param cacheKey a key and sortKey
   */
  async del(cacheKey: CacheKey): Promise<void> {
    await this.client.DEL(`${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`);
  }

  /** @todo can use MULTI */
  async begin(): Promise<void> {
    throw new Error("begin not implemented");
  }

  /** @todo can use DISCARD */
  rollback(): void {
    throw new Error("rollback not implemented");
  }

  /** @todo can use EXEC */
  commit(): void {
    throw new Error("commit not implemented");
  }

  /**
   * Returns all cached keys. A SortKeyCacheRange can be given, where specific keys can be filtered.
   * Note that the range option applies to `keys` themselves, not the `sortKey` part of it.
   * @param sortKey optional upper bound
   * @param options
   */
  async keys(sortKey?: string, options?: SortKeyCacheRangeOptions): Promise<string[]> {
    // prepare range arguments
    let isReversed: true | undefined = undefined;
    let lowerBound = "-"; // equals `-inf` in lex ordering
    let upperBound = "+"; // equals `+inf` in lex ordering
    let limit: number | undefined = undefined;
    if (options) {
      // apparently you cant give `false` to `REV` option
      if (options.reverse) {
        isReversed = options.reverse ? true : undefined;
      }
      if (options.lt) {
        upperBound = `[${options.gte}|${sortKey || lastPossibleSortKey}`;
      }
      if (options.gte) {
        lowerBound = `(${options.lt}|${genesisSortKey}`;
      }
      // limit option does not apply to this query, but to the final list instead
      if (options.limit) {
        limit = options.limit;
      }
    }

    // swap bounds if the query is reversed
    if (isReversed) {
      const tmp = lowerBound;
      lowerBound = upperBound;
      upperBound = tmp;
    }

    // get the range of keys
    const cacheKeys = await this.client.ZRANGE(`${this.prefix}.keys`, lowerBound, upperBound, {
      REV: isReversed,
      BY: "LEX",
    });

    // get the latest `sortKey` for each `key`
    // which would be the first time it appears here in this sorted array
    const latestKeys = cacheKeys.reduce<{
      result: string[];
      prevKey: string;
    }>(
      (acc, curCacheKey) => {
        const key = curCacheKey.split("|")[0];
        if (acc.prevKey !== key) {
          acc.result.push(key);
          acc.prevKey = key;
        }
        return acc;
      },
      {
        result: [],
        prevKey: "",
      }
    ).result;

    return latestKeys.slice(0, limit);
  }

  /**
   * Returns a key value map for a specified `sortKey` range.
   * @see keys function that retrieves the latest keys and their sortKeys
   * @param sortKey reference SortKey
   * @param options and object with reference keys `lt` and `gte` for comparison, as well as `limit` and `reverse` options.
   */
  async kvMap(sortKey: string, options?: SortKeyCacheRangeOptions): Promise<Map<string, V>> {
    const keys = await this.keys(sortKey, options);

    const map: Map<string, V> = new Map();
    const values = await this.client.MGET(keys);
    for (let i = 0; i < keys.length; ++i) {
      // not checking for `null` here because interface
      // expects V only; this is understanble, as we are getting
      // existing keys instead of querying a user key.
      map.set(keys[i], JSON.parse(values[i]) as V);
    }

    return map;
  }

  /**
   * Returns the value at the given key with respect to the `sortKey`.
   * @param cacheKey a key and sortKey
   * @returns value, `null` if it does not exist in cache
   */
  async get(cacheKey: CacheKey): Promise<SortKeyCacheResult<V> | null> {
    const res = await this.client.GET(`${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`);
    if (res == null) {
      return null;
    }

    return {
      sortKey: cacheKey.sortKey,
      cachedValue: JSON.parse(res) as V,
    };
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
    const latestSortKey = await this.getLatestSortKey(key, sortKey);
    if (latestSortKey == null) {
      return null;
    }

    // get the actual value at that key
    const value = await this.client.GET(`${this.prefix}.${key}|${latestSortKey}`);
    return {
      sortKey: latestSortKey,
      cachedValue: value && JSON.parse(value),
    };
  }

  /**
   * Puts a new value in cache under given `CacheKey`.
   * The respective key is updated with new value, and the string `key|sortKey`
   * is added to a sorted list also stored in cache.
   * @param cacheKey an object with `key` and `sortKey`
   * @param value new value
   */
  async put(cacheKey: CacheKey, value: V): Promise<void> {
    const { key, sortKey } = cacheKey;
    await this.client.SET(`${this.prefix}.${key}|${sortKey}`, JSON.stringify(value));

    // it is very important to set the score 0, otherwise lex ordering may break
    await this.client.ZADD(`${this.prefix}.keys`, [{ score: 0, value: `${key}|${sortKey}` }]);

    const count = await this.client.ZLEXCOUNT(`${this.prefix}.keys`, `[${key}|${genesisSortKey}`, `[${key}|${sortKey}`);

    // if count is greater than maxEntriesPerContract, remove oldest entries amounting to (count - minEntriesPerContract)
    if (this.maxEntriesPerContract && this.minEntriesPerContract && count > this.maxEntriesPerContract) {
      const keysToRemove = await this.client.ZRANGE(
        `${this.prefix}.keys`,
        `[${key}|${genesisSortKey}`,
        `[${key}|${sortKey}`,
        {
          BY: "LEX",
          LIMIT: {
            count: count - this.minEntriesPerContract,
            offset: 0,
          },
        }
      );
      await this.client.ZREM(`${this.prefix}.keys`, keysToRemove);
      await this.client.DEL(keysToRemove.map((cacheKey) => `${this.prefix}.${cacheKey}`));
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
    const keysToRemove = await this.client.ZRANGE(
      `${this.prefix}.keys`,
      `[${key}|${genesisSortKey}`, // lower bound
      `[${key}|${lastPossibleSortKey}`, // upper bound
      { BY: "LEX" } // lexicographic order
    );
    await this.client.ZREM(`${this.prefix}.keys`, keysToRemove);
    await this.client.DEL(keysToRemove.map((cacheKey) => `${this.prefix}.${cacheKey}`));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async prune(entriesStored = 1): Promise<PruneStats | null> {
    const keys = await this.getAllKeys();
    for (const key of keys) {
      const keysToRemove = await this.client.ZRANGE(
        `${this.prefix}.keys`,
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
      await this.client.DEL(keysToRemove.map((k) => `${this.prefix}.${k}`));
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

  /**
   * Get the last `sortKey`
   * @returns last `sortKey`, `null` if there is none
   */
  async getLastSortKey(): Promise<string | null> {
    const cacheKeys = await this.getAllCacheKeys();
    if (cacheKeys.length !== 0) {
      // map `key|sortKey` to `sortKey` only
      const sortKeys = cacheKeys.map((v) => v.split("|")[1]);
      // get the last one after sorting by `sortKey`s alone
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

  async dump() {
    throw new Error("dump not implemented");
  }

  storage<S>() {
    return this.client as S;
  }
}
