import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";
import { lastPossibleSortKey } from "warp-contracts";

describe("keys & kvMap tests", () => {
  let db: RedisCache<number>;
  const keys1 = ["a", "b", "c", "d", "e"];
  const keys2 = ["x", "y", "z"];
  const KEYS1_MAX_HEIGHT = 5;
  const KEYS2_MAX_HEIGHT = 10;

  beforeAll(async () => {
    db = new RedisCache<number>(constants.CACHE_OPTS, constants.REDIS_OPTS);

    // set some keys at different heights
    await Promise.all(
      keys1.map((key) => {
        const height = Math.floor(Math.random() * KEYS1_MAX_HEIGHT) + 1;
        return db.put({ key, sortKey: getSortKey(height) }, makeValue(height));
      })
    );
    await Promise.all(
      keys2.map((key) => {
        const height = Math.floor(Math.random() * KEYS2_MAX_HEIGHT) + KEYS1_MAX_HEIGHT;
        return db.put({ key, sortKey: getSortKey(height) }, makeValue(height));
      })
    );
  });

  it("should set & get a key", async () => {
    console.log(
      await db.keys(lastPossibleSortKey, {
        gte: "x",
        lt: "y",
      })
    );
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
