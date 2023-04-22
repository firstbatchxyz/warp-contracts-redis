import { createClient } from "@redis/client";
import { RedisCache, RedisClient } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

jest.setTimeout(100 * 1000);

describe("redis cache atomic transactions", () => {
  let db: RedisCache<number>;
  const MIN_ENTRIES = 5;
  const MAX_ENTRIES = 10;

  beforeAll(async () => {
    const redisClient: RedisClient = createClient({
      url: constants.REDIS_URL,
    });
    db = new RedisCache<number>({
      prefix: constants.DBNAME,
      minEntriesPerContract: MIN_ENTRIES,
      maxEntriesPerContract: MAX_ENTRIES,
      allowAtomics: true,
      client: redisClient,
    });
    await db.open();
  });

  it("should begin & commit a transaction", async () => {
    const key = "atomictest.commit";
    await db.begin();

    // put some keys
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      await db.put({ key, sortKey: getSortKey(i) }, makeValue(i));
    }

    // should get null as they are not yet committed
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      expect(result).toBe(null);
    }

    // commit to the transaction
    await db.commit();

    // should get the keys afterwards
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      if (result) {
        expect(result.sortKey).toBe(getSortKey(i));
        expect(result.cachedValue).toBe(makeValue(i));
      } else {
        fail("expected a result");
      }
    }
  });

  it("should begin & rollback a transaction", async () => {
    const key = "atomictest.rollback";
    await db.begin();

    // put some keys
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      await db.put({ key, sortKey: getSortKey(i) }, makeValue(i));
    }

    // should get null as they are not yet committed
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      expect(result).toBe(null);
    }

    // commit to the transaction
    await db.rollback();

    // should be null again
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      expect(result).toBe(null);
    }
  });

  it("should NOT commit without beginning", async () => {
    await expect(db.commit()).rejects.toThrow("No transaction");
  });

  it("should NOT rollback without beginning", async () => {
    await expect(db.rollback()).rejects.toThrow("No transaction");
  });

  it("should NOT begin again after beginning", async () => {
    await db.begin();
    await expect(db.begin()).rejects.toThrow("Already begun");
    await db.rollback();
  });

  afterAll(async () => {
    // clean everything
    await db.storage<RedisClient>().FLUSHDB();

    // need to wait a bit otherwise you get `DisconnectsClientError` error
    await new Promise((res) => {
      setTimeout(res, constants.JEST_AFTERALL_TIMEOUT);
    });
    await db.close();
  });
});
