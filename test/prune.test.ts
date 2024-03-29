import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

describe.each<boolean>([true, false])("prune (atomic: %s)", (isAtomic) => {
  let db: RedisCache<number>;
  const LAST_HEIGHT = 5;
  const ENTRIES_STORED = 2;
  const keySuffixes = ["a", "b"]; // arbitrary keys
  const key = "prunetest" + isAtomic ? ".atomic" : ".nonatomic";

  beforeAll(async () => {
    expect(ENTRIES_STORED).toBeLessThan(LAST_HEIGHT);
    db = new RedisCache<number>(constants.CACHE_OPTS, constants.REDIS_OPTS);
  });

  it("should prune keys", async () => {
    if (isAtomic) {
      await db.begin();
    }

    for (let k = 0; k < keySuffixes.length; k++) {
      for (let i = 1; i <= LAST_HEIGHT; i++) {
        await db.put({ key: `${key}.${keySuffixes[k]}`, sortKey: getSortKey(i) }, makeValue(i));
      }
    }

    // prune to leave only `n` sortKey's for each of them
    await db.prune(ENTRIES_STORED);

    // commit afterwards to see if effects took place
    if (isAtomic) {
      await db.commit();
    }

    for (let k = 0; k < keySuffixes.length; k++) {
      // older keys should be gone
      for (let i = 1; i <= LAST_HEIGHT - ENTRIES_STORED; i++) {
        const result = await db.get({ key: `${key}.${keySuffixes[k]}`, sortKey: getSortKey(i) });
        expect(result).toBe(null);
      }

      // new keys should persist
      for (let i = LAST_HEIGHT - ENTRIES_STORED + 1; i <= LAST_HEIGHT; i++) {
        const result = await db.get({ key: `${key}.${keySuffixes[k]}`, sortKey: getSortKey(i) });
        if (result) {
          expect(result.sortKey).toBe(getSortKey(i));
          expect(result.cachedValue).toBe(makeValue(i));
        } else {
          expect(result).not.toBe(null);
        }
      }
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
