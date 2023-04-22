import { createClient } from "@redis/client";
import { RedisCache, RedisClient } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";

jest.setTimeout(100 * 1000);

describe.each<boolean>([true, false])("redis cache prune", (isAtomic) => {
  let db: RedisCache<number>;
  const LAST_HEIGHT = 5;
  const ENTRIES_STORED = 2;
  const keySuffixes = ["a", "b"]; // arbitrary keys
  const key = "prunetest" + isAtomic ? ".atomic" : ".nonatomic";

  beforeAll(async () => {
    expect(ENTRIES_STORED).toBeLessThan(LAST_HEIGHT);
    const redisClient: RedisClient = createClient({
      url: constants.REDIS_URL,
    });
    db = new RedisCache<number>({
      prefix: constants.DBNAME,
      minEntriesPerContract: 10,
      maxEntriesPerContract: 100,
      allowAtomics: true,
      client: redisClient,
    });
    await db.open();
  });

  it(`should prune keys (atomic: ${isAtomic})`, async () => {
    if (isAtomic) {
      await db.begin();
    }

    for (let k = 0; k < keySuffixes.length; k++) {
      for (let i = 1; i <= LAST_HEIGHT; i++) {
        await db.put({ key: `${key}.${keySuffixes[k]}`, sortKey: getSortKey(i) }, makeValue(i));
      }
    }

    // prune to leave only `n` sortKey's for each of them
    const pruneStats = await db.prune(ENTRIES_STORED);
    if (pruneStats) {
      expect(pruneStats.entriesBefore).toBe(LAST_HEIGHT * keySuffixes.length);
      expect(pruneStats.entriesAfter).toBe(ENTRIES_STORED * keySuffixes.length);
    }

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
          fail("expected a result");
        }
      }
    }
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
