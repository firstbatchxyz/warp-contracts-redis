import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

describe("deletion logic", () => {
  let db: RedisCache<number>;
  const key = "crudtest";
  const insertAt = 1;
  const deleteAt = 5;

  beforeAll(async () => {
    db = new RedisCache<number>(constants.CACHE_OPTS, constants.REDIS_OPTS);

    // for this test's purposes
    expect(insertAt).toBeLessThan(deleteAt);
  });

  it("should set & get a key", async () => {
    const sortKey = getSortKey(insertAt);
    const value = makeValue(insertAt);
    await db.put({ key, sortKey }, value);

    const result = await db.get({ key, sortKey });
    if (result) {
      expect(result.sortKey).toBe(sortKey);
      expect(result.cachedValue).toBe(value);
    } else {
      expect(result).not.toBe(null);
    }
  });

  it("should delete a key at some height", async () => {
    const sortKey = getSortKey(deleteAt);
    await db.del({ key, sortKey });

    const result = await db.get({ key, sortKey });
    if (result) {
      expect(result.sortKey).toBe(sortKey);
      expect(result.cachedValue).toBe(null);
    } else {
      expect(result).not.toBe(null);
    }
  });

  it("should access the deleted key at a lower height", async () => {
    const sortKey = getSortKey(insertAt);
    const value = makeValue(insertAt);
    const result = await db.get({ key, sortKey });
    if (result) {
      expect(result.sortKey).toBe(sortKey);
      expect(result.cachedValue).toBe(value);
    } else {
      expect(result).not.toBe(null);
    }
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
