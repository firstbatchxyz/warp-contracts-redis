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
import type { SortKeyCacheRangeOptions } from "warp-contracts/lib/types/cache/SortKeyCacheRangeOptions";
import { Redis } from "ioredis";
import type { ChainableCommander } from "ioredis";
import stringify from "safe-stable-stringify";

import { luaScripts } from "./luaScripts";
import type { RedisOptions } from "./types/redisCache";

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
  /**
   * If `true`, then it means `this.client` has been created outside, and this will further
   * disable `open` and `close` functions. As such, `this.isOpen` will also not be touched.
   */
  isManaged: boolean;
  /** Underlying Redis client (from `ioredis`) */
  client: Redis;
  /**
   * A transaction object, returned by `MULTI`.
   * @see {@link asAtomic}
   */
  transaction: ChainableCommander | null = null;

  constructor(cacheOptions: CacheOptions, redisOptions: RedisOptions) {
    // create client
    if (redisOptions.client) {
      // client is managed from outside
      this.client = redisOptions.client;
      this.isManaged = true;
    } else if (redisOptions.url) {
      // client is managed from inside
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
        // configure no-persistance
        if (cacheOptions.inMemory) {
          this.logger.info("Configuring the redis for no-persistance mode.");
          RedisCache.setConfigForInMemory(this.client).then(() => this.logger.info("Configurations done."));
        }
      }
    });

    // cache options
    this.prefix = cacheOptions.dbLocation;
    this.sls = cacheOptions.subLevelSeparator || "|";

    // redis specific options
    this.maxEntriesPerContract = redisOptions.maxEntriesPerContract || 10;
    this.minEntriesPerContract = redisOptions.minEntriesPerContract || 10;
    if (this.minEntriesPerContract > this.maxEntriesPerContract) {
      throw new Error("minEntries > maxEntries");
    }

    // define lua scripts
    RedisCache.defineLuaScripts(this.client);
  }

  /**
   * Updates the Redis client configs with respect to `inMemory: true` cache option.
   * This is done by the following:
   *
   * - `SET appendonly no`
   * - `SET save ""`
   *
   *  See here: https://stackoverflow.com/a/34736871/21699616
   *
   * @param client redis client that is connected
   */
  static async setConfigForInMemory(client: Redis) {
    await Promise.all([
      // https://redis.io/docs/management/persistence/#append-only-file
      client.config("SET", "appendonly", "no"),
      // https://redis.io/docs/management/persistence/#snapshotting
      client.config("SET", "save", ""),
    ]);
  }

  /**
   *
   * @param client redis client that is connected
   */
  static defineLuaScripts(client: Redis) {
    Object.entries(luaScripts).forEach(([name, definition]) => client.defineCommand(name, definition));
  }

  //////////////////// TRANSACTION LOGIC ////////////////////
  /**
   * Begin a transaction, where all operations will be atomic
   * upon calling `commit`.
   * @see {@link commit} and {@link rollback}
   */
  async begin(): Promise<void> {
    this.logger.debug("BEGIN called.");
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
    this.logger.debug("ROLLBACK called.");
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
    this.logger.debug("COMMIT called.");
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
   * @param opStack a `BatchDBOp` object with `key` and operation `type`
   */
  async batch(opStack: BatchDBOp<V>[]) {
    this.logger.debug("BATCH called.");
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
   * @param options a set of options for the query
   */
  async keys(sortKey: string, options?: SortKeyCacheRangeOptions): Promise<string[]> {
    this.logger.debug("KEYS called.", { sortKey, options });

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
    this.logger.debug("KVMAP called.", { sortKey, options });
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
    this.logger.debug(`GET called.`, cacheKey);

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
    this.logger.debug(`GET LAST called.`, { key });
    return this.getLessOrEqual(key, lastPossibleSortKey);
  }

  /**
   * Returns the first value less than the given sortKey.
   * @param key key of the value
   * @param sortKey sortKey to be compared against
   * @returns value and it's sortKey, or null if it does not exist
   */
  async getLessOrEqual(key: string, sortKey: string): Promise<SortKeyCacheResult<V> | null> {
    this.logger.debug(`GET LESS OR EQUAL called.`, {
      key,
      sortKey,
    });
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
    this.logger.debug(`GET LAST SORT KEY called.`);
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
    this.logger.debug("PUT called.", cacheKey);
    await this.asAtomic().atomic_put(
      cacheKey.key,
      cacheKey.sortKey,
      stringify(value),
      this.minEntriesPerContract,
      this.maxEntriesPerContract,
      this.prefix,
      this.sls
    );
  }

  //////////////////// DEL FUNCTIONS ////////////////////
  /**
   * Deletes keys are not below a given `sortKey` for some `key`.
   * Values below that `sortKey` should still be accessible.
   * @param cacheKey a key and sortKey
   */
  async del(cacheKey: CacheKey): Promise<void> {
    this.logger.debug("DEL called.", cacheKey);
    await this.asAtomic().atomic_del(cacheKey.key, cacheKey.sortKey, this.prefix, this.sls);
  }

  /**
   * Removes all data at the given key.
   *
   * This means finding all `sortKey`s associated with this data and removing all of them.
   * Internally calls `del` with the `genesisSortKey` as the argument.
   * @see {@link del}
   * @param key key
   */
  async delete(key: string): Promise<void> {
    this.logger.debug("DELETE called.", { key });
    await this.del({ key, sortKey: genesisSortKey });
  }

  /**
   * Prunes the cache so that only `entriesStored` latest sortKey's are left for each cached key
   * @param entriesStored how many latest entries should be left for each cached key
   * @returns `null`
   */
  async prune(entriesStored = 1): Promise<PruneStats | null> {
    if (!entriesStored || entriesStored <= 0) {
      entriesStored = 1;
    }

    this.logger.debug("PRUNE called.", { entriesStored });
    await this.asAtomic().atomic_prune(entriesStored, this.prefix, this.sls);
    return null;
  }

  //////////////////// CLIENT FUNCTIONS ////////////////////
  /**
   * Calls `connect` function of Redis client.
   */
  async open(): Promise<void> {
    this.logger.debug("OPEN called.");
    if (this.isManaged) return; // client wants to close themselves
    try {
      if (
        !(this.client.status === "connecting" || this.client.status === "connect" || this.client.status === "ready")
      ) {
        await this.client.connect();
        this.logger.info("Connected.");
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
    this.logger.debug("CLOSE called.");
    if (this.isManaged) return; // client wants to close themselves
    try {
      if (this.client.status === "ready") {
        // abort a transaction if its not committed so far
        if (this.transaction != null) {
          await this.rollback();
        }
        await this.client.quit();
        this.logger.info("Disconnected.");
      }
    } catch (err) {
      this.logger.error("Could not quit client.", err);
    }
  }

  /**
   * Dumps the cache to server's active directory as `dump.rdb`.
   * Note that this is a blocking operation, and you should not
   * do this in production.
   */
  async dump() {
    this.logger.warn("Saving to disk...");
    const response = await this.client.save();
    // https://redis.io/commands/save/
    if (response !== "OK") {
      this.logger.error("Dump failed with:", response);
    }
  }

  storage<S = Redis>() {
    return this.client as S;
  }
}

/**
 * Client values must be wrapped with this class in KV.
 */
// class ClientValueWrapper<V> {
//   constructor(readonly value: V, readonly tomb: boolean = false) {}
// }
