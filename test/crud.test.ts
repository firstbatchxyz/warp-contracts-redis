import type { Redis } from "ioredis";
import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

describe("redis cache CRUD operations", () => {
  let db: RedisCache<number>;
  const LAST_HEIGHT = 5;
  const key = "crudtest";

  beforeAll(async () => {
    db = new RedisCache<number>(
      {
        inMemory: false,
        dbLocation: constants.DBNAME,
        subLevelSeparator: "|",
      },
      {
        minEntriesPerContract: 10,
        maxEntriesPerContract: 100,
        isAtomic: true,
        url: constants.REDIS_URL,
      }
    );
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

  it("should delete keys properly", async () => {
    const delHeight = 2;

    await db.del({ key, sortKey: getSortKey(delHeight) });

    // lower sortKey's should be accessible alright
    for (let i = 1; i < delHeight; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      if (result) {
        expect(result.sortKey).toBe(getSortKey(i));
        expect(result.cachedValue).toBe(makeValue(i));
      } else {
        expect(result).not.toBe(null);
      }
    }

    // greater-equal sortKey's should be gone
    for (let i = delHeight; i <= LAST_HEIGHT; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      expect(result).toBe(null);
    }

    // getLast should return the latest sortKey before the deleted one
    {
      const result = await db.getLast(key);
      if (result) {
        expect(result.sortKey).toBe(getSortKey(delHeight - 1));
        expect(result.cachedValue).toBe(makeValue(delHeight - 1));
      } else {
        expect(result).not.toBe(null);
      }
    }
  });

  afterAll(async () => {
    // clean everything
    // await db.storage<Redis>().flushdb();

    // need to wait a bit otherwise you get `DisconnectsClientError` error
    await new Promise((res) => {
      setTimeout(res, constants.JEST_AFTERALL_TIMEOUT);
    });
    await db.close();
  });
});
