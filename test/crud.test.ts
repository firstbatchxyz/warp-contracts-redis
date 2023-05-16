import type { Redis } from "ioredis";
import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

jest.setTimeout(100 * 1000);

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
        isAtomic: false,
        url: constants.REDIS_URL,
      }
    );
  });

  it("should get & set keys", async () => {
    for (let i = 1; i <= LAST_HEIGHT; i++) {
      await db.put({ key, sortKey: getSortKey(i) }, makeValue(i));
    }

    for (let i = 1; i <= LAST_HEIGHT; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      if (result) {
        expect(result.sortKey).toBe(getSortKey(i));
        expect(result.cachedValue).toBe(makeValue(i));
      } else {
        fail("expected a result");
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
      fail("expected a result");
    }
  });

  it("should delete keys", async () => {
    await db.delete(key);

    for (let i = 1; i <= LAST_HEIGHT; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      expect(result).toBe(null);
    }

    expect(await db.getLast(key)).toBe(null);
    expect(await db.keys(getSortKey(LAST_HEIGHT))).toStrictEqual([]);
  });

  afterAll(async () => {
    // clean everything
    await db.storage<Redis>().flushdb();

    // need to wait a bit otherwise you get `DisconnectsClientError` error
    await new Promise((res) => {
      setTimeout(res, constants.JEST_AFTERALL_TIMEOUT);
    });
    await db.close();
  });
});
