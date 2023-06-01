import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";
import { SortKeyCacheResult } from "warp-contracts";

describe("get & set logic", () => {
  let db: RedisCache<number>;
  const LAST_HEIGHT = 5;
  const key = "crudtest";

  beforeAll(async () => {
    db = new RedisCache<number>(constants.CACHE_OPTS, constants.REDIS_OPTS);
  });

  it("should set keys", async () => {
    for (let i = 1; i <= LAST_HEIGHT; i++) {
      await db.put({ key, sortKey: getSortKey(i) }, makeValue(i));
    }
  });

  it("should get keys", async () => {
    for (let i = 1; i <= LAST_HEIGHT; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      if (result) {
        expect(result.sortKey).toBe(getSortKey(i));
        expect(result.cachedValue).toBe(makeValue(i));
      } else {
        expect(result).not.toBe(null);
      }
    }
  });

  it("should get the last sortKey", async () => {
    const lastSortKey = await db.getLastSortKey();
    expect(lastSortKey).toBe(getSortKey(LAST_HEIGHT));
  });

  it("should get the latest value at a key", async () => {
    const result = await db.getLast(key);
    if (result) {
      expect(result.sortKey).toBe(getSortKey(LAST_HEIGHT));
      expect(result.cachedValue).toBe(makeValue(LAST_HEIGHT));
    } else {
      expect(result).not.toBe(null);
    }
  });

  it("should get less or equal correctly", async () => {
    let result: SortKeyCacheResult<number> | null = null;

    // last height
    result = await db.getLessOrEqual(key, getSortKey(LAST_HEIGHT));
    if (result) {
      expect(result.sortKey).toBe(getSortKey(LAST_HEIGHT));
      expect(result.cachedValue).toBe(makeValue(LAST_HEIGHT));
    } else {
      expect(result).not.toBe(null);
    }

    // 1st sort key
    result = await db.getLessOrEqual(key, getSortKey(1));
    if (result) {
      expect(result.sortKey).toBe(getSortKey(1));
      expect(result.cachedValue).toBe(makeValue(1));
    } else {
      expect(result).not.toBe(null);
    }

    const nonExistentKey = "fdshkjgfhvkjhfkjshd";
    result = await db.getLessOrEqual(nonExistentKey, getSortKey(LAST_HEIGHT));
    expect(result).toBe(null);
  });

  afterAll(async () => {
    // clean everything
    await db.storage().flushdb();

    // need to wait a bit otherwise you get `DisconnectsClientError` error
    await new Promise((res) => {
      setTimeout(res, constants.JEST_AFTERALL_TIMEOUT);
    });
    await db.close();
  });
});
