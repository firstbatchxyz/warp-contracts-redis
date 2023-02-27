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
import { RedisCacheOptions } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RedisCache<V = any> implements SortKeyCache<V> {
  private readonly logger = LoggerFactory.INST.create("RedisCache");
  prefix: string;
  client: ReturnType<typeof createClient>;
  maxEntriesPerContract: number;
  minEntriesPerContract: number;

  constructor(cacheOptions: RedisCacheOptions) {
    this.prefix = cacheOptions.prefix;
    this.client = cacheOptions.client;
    this.maxEntriesPerContract = cacheOptions.maxEntriesPerContract;
    this.minEntriesPerContract = cacheOptions.minEntriesPerContract;
  }

  /**
   * Returns the value at the given key with respect to the sortKey.
   * @param cacheKey a key and sortKey
   * @returns value, `null` if it does not exist
   */
  async get(cacheKey: CacheKey): Promise<SortKeyCacheResult<V> | null> {
    // retrieve & parse result
    let result: V | null = null;
    const res = await this.client.get(`${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`);
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
   *
   * @param key key of the value
   * @param sortKey sortKey to be compared against
   * @returns value and it's sortKey, or null if it does not exist
   */
  async getLessOrEqual(key: string, sortKey: string): Promise<SortKeyCacheResult<V> | null> {
    const result = await this.client.ZRANGE(`${this.prefix}.keys`, `[${key}|${sortKey}`, "-", {
      REV: true,
      BY: "LEX",
      LIMIT: {
        count: 1,
        offset: 0,
      },
    });

    if (result.length) {
      if (!result[0].startsWith(key)) {
        return null;
      }

      // get
      const value = await this.client.get(`${this.prefix}.${result[0]}`);
      return {
        sortKey: result[0].split("|")[1],
        cachedValue: value && JSON.parse(value),
      };
    } else {
      return null;
    }
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
    await this.client.set(`${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`, JSON.stringify(value));
    await this.client.ZADD(`${this.prefix}.keys`, [{ score: 0, value: `${cacheKey.key}|${cacheKey.sortKey}` }]);

    // get total count
    // TODO
  }

  /**
   * Executes a list of operations in batch.
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
   * @param key key
   */
  async delete(key: string): Promise<void> {
    const keys = await this.client.ZRANGE(
      `${this.prefix}.keys`, // key
      `[${key}|${genesisSortKey}`, // min
      `[${key}|${lastPossibleSortKey}`, // max
      { BY: "LEX" } // lexicographic order
    );
    await this.client.ZREM(`${this.prefix}.keys`, keys);
    await this.client.del(keys.map((k) => `${this.prefix}.${k}`));
  }

  /**
   * Returns all cached keys
   * @returns an array of SortKey's
   */
  async keys(): Promise<string[]> {
    const result = await this.client.ZRANGE(`${this.prefix}.keys`, `-`, "+", {
      BY: "LEX",
    });
    return result.map((v) => v.split("|")[1]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async prune(entriesStored = 1): Promise<PruneStats | null> {
    // get keys
    throw new Error("prune not implemented yet");
    return {
      entriesBefore: 0,
      entriesAfter: 0,
      sizeBefore: 0,
      sizeAfter: 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async dump(): Promise<any> {
    throw new Error("dump not implemented yet");
  }

  async getLastSortKey(): Promise<string | null> {
    throw new Error("getLastSortKey not implemented yet");
  }

  // TODO: has issues when used concurrently
  async close(): Promise<void> {
    // try {
    //   if (this.client.isOpen) {
    //     await this.client.disconnect();
    //   }
    // } catch (err) {
    //   this.logger.error("Could not close Redis.", err);
    // }
  }

  // TODO: has issues when used concurrently
  async open(): Promise<void> {
    // try {
    //   if (!this.client.isOpen) {
    //     await this.client.connect();
    //   }
    // } catch (err) {
    //   this.logger.error("Could not open Redis.", err);
    // }
  }

  storage<S>() {
    return this.client as S;
  }
}
