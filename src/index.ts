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

  constructor(cacheOptions: RedisCacheOptions) {
    this.prefix = cacheOptions.prefix;
    this.client = cacheOptions.client;
  }

  async get(cacheKey: CacheKey): Promise<SortKeyCacheResult<V> | null> {
    let result = null;
    const res = await this.client.get(
      `${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`
    );
    if (res !== null) result = JSON.parse(res);
    if (result) {
      return {
        sortKey: cacheKey.sortKey,
        cachedValue: result,
      };
    } else {
      return null;
    }
  }

  async getLast(key: string): Promise<SortKeyCacheResult<V> | null> {
    return this.getLessOrEqual(key, lastPossibleSortKey);
  }

  async getLessOrEqual(key: string, sortKey: string) {
    const result = await this.client.ZRANGE(
      `${this.prefix}.keys`,
      `[${key}|${sortKey}`,
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
      if (!result[0].startsWith(key)) {
        return null;
      }
      const value = await this.client.get(`${this.prefix}.${result[0]}`);
      return {
        sortKey: result[0].split("|")[1],
        cachedValue: value && JSON.parse(value),
      };
    } else {
      return null;
    }
  }

  async put(cacheKey: CacheKey, value: V): Promise<void> {
    await this.client.set(
      `${this.prefix}.${cacheKey.key}|${cacheKey.sortKey}`,
      JSON.stringify(value)
    );
    await this.client.ZADD(`${this.prefix}.keys`, [
      { score: 0, value: `${cacheKey.key}|${cacheKey.sortKey}` },
    ]);
    return;
  }

  async batch(opStack: BatchDBOp<V>[]) {
    for (const op of opStack) {
      if (op.type === "put") {
        await this.put(op.key, op.value);
      } else if (op.type === "del") {
        await this.delete(op.key);
      }
    }
  }

  async delete(key: string): Promise<void> {
    const keys = await this.client.ZRANGE(
      `${this.prefix}.keys`,
      `[${key}|${genesisSortKey}`,
      `[${key}|${lastPossibleSortKey}`,
      { BY: "LEX" }
    );
    await this.client.ZREM(`${this.prefix}.keys`, keys);
    await this.client.del(keys.map((k) => `${this.prefix}.${k}`));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async dump(): Promise<any> {
    throw new Error("dump not implemented yet");
  }

  async getLastSortKey(): Promise<string | null> {
    throw new Error("getLastSortKey not implemented yet");
  }

  async keys(): Promise<string[]> {
    const result = await this.client.ZRANGE(`${this.prefix}.keys`, `-`, "+", {
      BY: "LEX",
    });
    return result.map((v) => v.split("|")[1]);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async prune(entriesStored = 1): Promise<PruneStats> {
    throw new Error("prune not implemented yet");
    return {
      entriesBefore: 0,
      entriesAfter: 0,
      sizeBefore: 0,
      sizeAfter: 0,
    };
  }
}
