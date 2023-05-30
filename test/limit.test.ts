import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

describe.each<boolean>([true, false])("redis cache puts with limit (atomic: %s)", (isAtomic) => {
  let db: RedisCache<number>;
  const MIN_ENTRIES = 5;
  const MAX_ENTRIES = 10;
  const key = "limittest";

  beforeAll(async () => {
    expect(MIN_ENTRIES).toBeLessThan(MAX_ENTRIES);
    db = new RedisCache<number>(
      {
        inMemory: true,
        dbLocation: constants.DBNAME,
        subLevelSeparator: "|",
      },
      {
        minEntriesPerContract: MIN_ENTRIES,
        maxEntriesPerContract: MAX_ENTRIES,
        url: constants.REDIS_URL,
      }
    );
  });

  it("should put cache keys", async () => {
    if (isAtomic) {
      await db.begin();
    }

    // should put MAX_ENTRIES many keys
    for (let i = 1; i <= MAX_ENTRIES; i++) {
      await db.put({ key, sortKey: getSortKey(i) }, makeValue(i));
    }

    if (!isAtomic) {
      // all entries should exist
      for (let i = 1; i <= MAX_ENTRIES; i++) {
        const result = await db.get({ key, sortKey: getSortKey(i) });
        if (result) {
          expect(result.sortKey).toBe(getSortKey(i));
          expect(result.cachedValue).toBe(makeValue(i));
        } else {
          expect(result).not.toBe(null);
        }
      }
    }
  });

  it("should add one more cache key to trigger deletion", async () => {
    // adding one more should cause older entries to be removed, until MIN_ENTRIES are left
    await db.put({ key, sortKey: getSortKey(MAX_ENTRIES + 1) }, makeValue(MAX_ENTRIES + 1));

    // commit afterwards to see if effects took place
    if (isAtomic) {
      await db.commit();
    }

    // older entries should be gone
    for (let i = 1; i <= MIN_ENTRIES; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      expect(result).toBe(null);
    }

    // recent entries should persist
    for (let i = MIN_ENTRIES + 1; i <= MAX_ENTRIES; i++) {
      const result = await db.get({ key, sortKey: getSortKey(i) });
      if (result) {
        expect(result.sortKey).toBe(getSortKey(i));
        expect(result.cachedValue).toBe(makeValue(i));
      } else {
        expect(result).not.toBe(null);
      }
    }

    // should get the correct result for last sortKey
    const lastSortKey = await db.getLastSortKey();
    expect(lastSortKey).toBe(getSortKey(MAX_ENTRIES + 1));
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
