import {
  CacheKey,
  genesisSortKey,
  LoggerFactory,
  SortKeyCache,
  SortKeyCacheResult,
  PruneStats,
  BatchDBOp,
  lastPossibleSortKey,
  CacheOptions,
} from "warp-contracts";
import { Redis, ChainableCommander } from "ioredis";
import type { RedisOptions } from "types/redisCache";
import type { SortKeyCacheRangeOptions } from "warp-contracts/lib/types/cache/SortKeyCacheRangeOptions";
import stringify from "safe-stable-stringify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RedisCache<V = any> implements SortKeyCache<V> {
  /** Warp Logger */
  private readonly logger = LoggerFactory.INST.create("RedisCache");
  /** Sub-level separator, usually `|` */
  private readonly sls: string;
  /** Prefix of all keys written by this cache */
  private readonly prefix: string;
  /**
   * Maximum number of `key|sortKey` pairs for each key to be kept. If count goes beyond this
   * number, older `key|sortKey`'s will be deleted.
   */
  maxEntriesPerContract: number;
  /**
   * Minimum number of `key|sortKey` pairs for each key to be kept upon pruning.
   */
  minEntriesPerContract: number;
  /** if `true`, then it means `this.client` has been created outside, and this will further
   * disable `open` and `close` functions. As such, `this.isOpen` will also not be touched.
   */
  isManaged: boolean;
  /** this is a temporary fix until atomicity is implemented in full, will remove in future */
  isAtomic: boolean;
  client: Redis;
  transaction: ChainableCommander;

  constructor(cacheOptions: CacheOptions, redisOptions: RedisOptions) {
    // create client
    if (redisOptions.client) {
      // client is managed from outside
      this.client = redisOptions.client;
      this.isManaged = true;
    } else if (redisOptions.url) {
      // client is managed by Warp
      this.client = new Redis(redisOptions.url, {
        lazyConnect: true, // disables auto-connect on client instantiation
      });
      this.isManaged = false;
    } else {
      throw new Error("You must provide either connection info or a client.");
    }

    // open client and set config
    this.open().then(() => {
      if (this.isManaged) {
        // cant change config settings if client is not managed by Warp
        this.logger.warn("Client is managed by user, not changing config.");
      } else {
        if (cacheOptions.inMemory) {
          // see: How to disable Redis RDB and AOF? https://stackoverflow.com/a/34736871/21699616
          // https://redis.io/docs/management/persistence/#append-only-file
          this.client.config("SET", "appendonly", "no");
          // https://redis.io/docs/management/persistence/#snapshotting
          this.client.config("SET", "save", "");
        }
      }
    });

    // cache options
    this.prefix = cacheOptions.dbLocation;
    this.sls = cacheOptions.subLevelSeparator || "|";

    // redis specific options
    this.maxEntriesPerContract = redisOptions.maxEntriesPerContract || 10;
    this.minEntriesPerContract = redisOptions.minEntriesPerContract || 10;
    this.isAtomic = redisOptions.isAtomic || false;
    if (redisOptions.minEntriesPerContract > redisOptions.maxEntriesPerContract) {
      throw new Error("minEntries > maxEntries");
    }
  }

  //////////////////// TRANSACTION LOGIC ////////////////////
  /**
   * Begin a transaction, where all operations will be atomic
   * upon calling `commit`.
   * @see {@link commit} and {@link rollback}
   */
  async begin(): Promise<void> {
    if (!this.isAtomic) return; // TODO remove
    if (this.transaction != null) {
      throw new Error("Already begun");
    }
    this.transaction = this.client.multi();
  }

  /**
   * Abort a transaction, preferably after `begin` is called.
   * @see {@link begin}
   */
  async rollback(): Promise<void> {
    if (!this.isAtomic) return; // TODO remove
    if (this.transaction === null) {
      throw new Error("No transaction");
    }
    this.transaction.discard();
    this.transaction = null;
  }

  /**
   * Commit to a transaction, preferably after `begin` is called.
   * @see {@link begin}
   */
  async commit(): Promise<void> {
    if (!this.isAtomic) return; // TODO remove

    if (this.transaction === null) {
      throw new Error("No transaction");
    }
    await this.transaction.exec();
    this.transaction = null;
  }

  /**
   * If a transaction is going on, this function will return the transaction object; otherwise
   * the underlying client is returned (which makes this call equivalent of `this.client`).
   * @returns client or transaction
   */
  private asAtomic(): Redis | ChainableCommander {
    return this.transaction || this.client;
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
  //////////////////// KEYS & KVMAP ////////////////////
  /**
   * Returns all cached keys. A SortKeyCacheRange can be given, where specific keys can be filtered.
   * Note that the range option applies to `keys` themselves, not the `sortKey` part of it.
   * @param sortKey
   * @param options
   */
  async keys(sortKey: string, options?: SortKeyCacheRangeOptions): Promise<string[]> {
    // prepare range arguments
    let limit: number | undefined = undefined;
    let isReverse = false;
    let lowerBound = "-"; // equals `-inf` in lex ordering
    let upperBound = "+"; // equals `+inf` in lex ordering
    if (options) {
      // limit option does not apply to this query, but to the final list instead
      if (options.limit) {
        limit = options.limit;
      }
      if (options.reverse) {
        isReverse = options.reverse;
      }
      if (options.lt) {
        upperBound = `[${options.gte}${this.sls}${sortKey}`;
      }
      if (options.gte) {
        lowerBound = `(${options.lt}${this.sls}${genesisSortKey}`;
      }
    }

    // get the range of keys
    const cacheKeys = isReverse
      ? await this.client.zrevrangebylex(`${this.prefix}.keys`, upperBound, lowerBound)
      : await this.client.zrangebylex(`${this.prefix}.keys`, lowerBound, upperBound);

    // get the latest `sortKey` for each `key`
    // which would be the first time it appears here in this sorted array
    // TODO: we could use a Lua script for this entire thing
    const latestKeys = cacheKeys.reduce<{
      result: string[];
      prevKey: string;
    }>(
      (acc, curCacheKey) => {
        const key = curCacheKey.split(this.sls)[0];
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
   * @param sortKey sortKey
   * @param options and object with reference keys `lt` and `gte` for comparison, as well as `limit` and `reverse` options.
   */
  async kvMap(sortKey: string, options?: SortKeyCacheRangeOptions): Promise<Map<string, V>> {
    const keys = await this.keys(sortKey, options);

    const map: Map<string, V> = new Map();
    const values = await this.client.mget(keys);
    for (let i = 0; i < keys.length; ++i) {
      // not checking for `null` here because interface
      // expects V only; this is understanble, as we are getting
      // existing keys instead of querying a user key.
      map.set(keys[i], JSON.parse(values[i]) as V);
    }

    return map;
  }

  //////////////////// GETTER FUNCTIONS ////////////////////
  /**
   * Get all cache keys, without the prefix.
   * @returns an array of cacheKeys in the form `key|sortKey`
   */
  private async getAllCacheKeys(): Promise<string[]> {
    return this.client.zrangebylex(`${this.prefix}.keys`, "-", "+");
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
    const keys = cacheKeys.map((v) => v.split(this.sls)[0]);
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
    const result = await this.client.zrevrangebylex(
      `${this.prefix}.keys`,
      `[${key}${this.sls}${maxSortKey || lastPossibleSortKey}`,
      "-",
      "LIMIT",
      0,
      1
    );

    if (result.length) {
      // we expect result[0] to be in form of a cacheKey
      const resultSplit = result[0].split(this.sls);
      if (resultSplit.length !== 2) {
        throw new Error("Result is not CacheKey");
      } else if (resultSplit[0] !== key) {
        // although there are keys in db, none belong to this key
        return null;
      }

      return resultSplit[1];
    }
    return null;
  }

  /**
   * Returns the value at the given key with respect to the `sortKey`.
   * @param cacheKey a key and sortKey
   * @returns value, `null` if it does not exist in cache
   */
  async get(cacheKey: CacheKey): Promise<SortKeyCacheResult<V> | null> {
    const res = await this.client.get(`${this.prefix}.${cacheKey.key}${this.sls}${cacheKey.sortKey}`);
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
   * Internally calls `getLessOrEqual(key, lastSortKey)`.
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
    const value = await this.client.get(`${this.prefix}.${key}${this.sls}${latestSortKey}`);
    return value
      ? {
          sortKey: latestSortKey,
          cachedValue: JSON.parse(value),
        }
      : null;
  }

  /**
   * Get the last `sortKey`
   * @returns last `sortKey`, `null` if there is none
   */
  async getLastSortKey(): Promise<string | null> {
    const cacheKeys = await this.getAllCacheKeys();
    if (cacheKeys.length !== 0) {
      // map `key|sortKey` to `sortKey` only
      const sortKeys = cacheKeys.map((v) => v.split(this.sls)[1]);
      // get the last one after sorting by `sortKey`s alone
      return sortKeys.sort().at(-1);
    } else {
      return null;
    }
  }

  //////////////////// SET FUNCTIONS ////////////////////
  /**
   * Puts a new value in cache under given `CacheKey`.
   * The respective key is updated with new value, and the string `key|sortKey`
   * is added to a sorted list also stored in cache.
   * @param cacheKey an object with `key` and `sortKey`
   * @param value new value
   */
  async put(cacheKey: CacheKey, value: V): Promise<void> {
    const { key, sortKey } = cacheKey;
    await this.asAtomic().set(`${this.prefix}.${key}${this.sls}${sortKey}`, stringify(value));

    // it is very important to set the score 0 (first argument after key), otherwise lex ordering may break
    await this.asAtomic().zadd(`${this.prefix}.keys`, 0, `${key}${this.sls}${sortKey}`);

    // TODO: this count may be wrong for atomic txs, will check!
    const count = await this.client.zlexcount(
      `${this.prefix}.keys`,
      `[${key}${this.sls}${genesisSortKey}`,
      `[${key}${this.sls}${sortKey}`
    );
    if (this.maxEntriesPerContract && this.minEntriesPerContract && count > this.maxEntriesPerContract) {
      // if count is greater than maxEntriesPerContract, leave
      const numKeysToRemove = count - this.minEntriesPerContract - 1;
      // TODO: this check might be redundant
      if (numKeysToRemove > 1) {
        const keysToRemove = await this.client.zrangebylex(
          `${this.prefix}.keys`,
          `[${key}${this.sls}${genesisSortKey}`,
          `[${key}${this.sls}${sortKey}`,
          "LIMIT",
          0,
          count - this.minEntriesPerContract - 1
        );
        await this.asAtomic().zrem(`${this.prefix}.keys`, keysToRemove);
        await this.asAtomic().del(keysToRemove.map((cacheKey) => `${this.prefix}.${cacheKey}`));
      }
    }
  }

  //////////////////// DEL FUNCTIONS ////////////////////
  /**
   * Deletes only a specific `sortKey` for some `key`.
   * @param cacheKey a key and sortKey
   */
  async del(cacheKey: CacheKey): Promise<void> {
    await this.asAtomic().del(`${this.prefix}.${cacheKey.key}${this.sls}${cacheKey.sortKey}`);
  }

  /**
   * Removes all data at the given key.
   * This means finding all `sortKey`s associated with this data,
   * and removing all of them.
   * @param key key
   */
  async delete(key: string): Promise<void> {
    const cacheKeysToRemove = await this.client.zrangebylex(
      `${this.prefix}.keys`,
      `[${key}${this.sls}${genesisSortKey}`,
      `[${key}${this.sls}${lastPossibleSortKey}`
    );
    await this.asAtomic().zrem(`${this.prefix}.keys`, cacheKeysToRemove);
    await this.asAtomic().del(cacheKeysToRemove.map((cacheKey) => `${this.prefix}.${cacheKey}`));
  }

  /**
   * Prunes the cache so that only `n` latest sortKey's are left for each cached key
   * @param entriesStored how many latest entries should be left for each cached key
   * @returns PruneStats; only the entry info is correct, not the sizes!
   */
  async prune(entriesStored = 1): Promise<PruneStats | null> {
    // make sure `entriesStored` is positive
    // this many entries will be left for each key
    if (!entriesStored || entriesStored <= 0) {
      entriesStored = 1;
    }
    let entriesBefore = 0;
    let entriesAfter = 0;

    // prune each key
    const keys = await this.getAllKeys();
    for (const key of keys) {
      const cacheKeys = await this.client.zrevrangebylex(
        `${this.prefix}.keys`,
        `[${key}${this.sls}${lastPossibleSortKey}`,
        `[${key}${this.sls}${genesisSortKey}`
      );
      if (cacheKeys.length <= entriesStored) {
        // nothing will change w.r.t. this key
        entriesBefore += cacheKeys.length;
        entriesAfter += cacheKeys.length;
      } else {
        const keysToRemove = cacheKeys.slice(entriesStored);
        await this.asAtomic().zrem(`${this.prefix}.keys`, keysToRemove);
        await this.asAtomic().del(keysToRemove.map((cacheKey) => `${this.prefix}.${cacheKey}`));
        entriesBefore += cacheKeys.length;
        entriesAfter += entriesStored;
      }
    }

    return {
      entriesBefore,
      entriesAfter,
      sizeBefore: entriesBefore, // TODO: add size info
      sizeAfter: entriesAfter, // TODO: add size info
    };
  }

  //////////////////// CLIENT FUNCTIONS ////////////////////
  /**
   * Calls `connect` function of Redis client.
   */
  async open(): Promise<void> {
    if (this.isManaged) return; // client wants to close themselves
    try {
      if (
        !(this.client.status === "connecting" || this.client.status === "connect" || this.client.status === "ready")
      ) {
        await this.client.connect();
        this.logger.info("Connected to Redis.");
      }
    } catch (err) {
      this.logger.error("Could not open Redis.", err);
    }
  }

  /**
   * Calls `quit` function of Redis client, which is more
   * graceful than `disconnect`.
   */
  async close(): Promise<void> {
    if (this.isManaged) return; // client wants to close themselves
    try {
      if (this.client.status === "ready") {
        // abort a transaction if its not committed so far
        if (this.transaction != null) {
          await this.rollback();
        }
        await this.client.quit();
        this.logger.info("Disconnected from Redis.");
      }
    } catch (err) {
      this.logger.error("Could not close Redis.", err);
    }
  }

  /**
   * Dumps the cache to server's active directory as `dump.rdb`.
   * Note that this is a blocking operation, and you should not
   * do this in production.
   */
  async dump() {
    this.logger.warn("Dumping cache!");
    const response = await this.client.save();
    // https://redis.io/commands/save/
    if (response !== "OK") {
      this.logger.error("Dump failed with:", response);
    }
  }

  storage<S>() {
    return this.client as S;
  }
}

/**
 * Client values must be wrapped with this class in KV.
 * @todo this should probably be exported from warp in the future
 * @todo no values are wrapped yet, check after testing
 */
class ClientValueWrapper<V> {
  constructor(readonly value: V, readonly tomb: boolean = false) {}
}
