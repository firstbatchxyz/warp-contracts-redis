import { RedisCache } from "../src";
import { getSortKey, makeValue } from "./utils";
import constants from "./constants";
import { lastPossibleSortKey } from "warp-contracts";

describe("keys & kvMap tests", () => {
  let db: RedisCache<number>;

  const KEYS1_MAX_HEIGHT = 5;
  const KEYS2_MAX_HEIGHT = 10;

  const keys1 = ["a", "b", "c", "d", "e"];
  const keys2 = ["x", "y", "z"];
  const heights1 = keys1.map(() => Math.floor(Math.random() * KEYS1_MAX_HEIGHT) + 1);
  const heights2 = keys2.map(() => Math.floor(Math.random() * KEYS2_MAX_HEIGHT) + KEYS1_MAX_HEIGHT + 1);

  beforeAll(async () => {
    db = new RedisCache<number>(constants.CACHE_OPTS, constants.REDIS_OPTS);

    await Promise.all(
      keys1.map((key, i) => {
        return db.put({ key, sortKey: getSortKey(heights1[i]) }, makeValue(heights1[i]));
      })
    );
    await Promise.all(
      keys2.map((key, i) => {
        return db.put({ key, sortKey: getSortKey(heights2[i]) }, makeValue(heights2[i]));
      })
    );
  });

  it("should get keys <= sortKey", async () => {
    expect((await db.keys(getSortKey(KEYS1_MAX_HEIGHT))).sort()).toEqual(keys1);
  });

  it("should get keys by range options", async () => {
    expect(
      (
        await db.keys(lastPossibleSortKey, {
          gte: "x",
          lt: "y",
        })
      ).sort()
    ).toEqual(["x"]);

    expect(
      (
        await db.keys(lastPossibleSortKey, {
          gte: "x",
          lt: "z",
        })
      ).sort()
    ).toEqual(["x", "y"]);
  });

  it("should get keys by range options with limit", async () => {
    expect(
      await db.keys(lastPossibleSortKey, {
        limit: 1,
      })
    ).toEqual(["a"]);

    expect(
      await db.keys(getSortKey(KEYS1_MAX_HEIGHT), {
        limit: 1,
        reverse: true,
      })
    ).toEqual(["e"]);

    expect(
      await db.keys(lastPossibleSortKey, {
        limit: 1,
        reverse: true,
      })
    ).toEqual(["z"]);
  });

  it("should get correct kvMap values", async () => {
    const map = await db.kvMap(getSortKey(KEYS1_MAX_HEIGHT));
    for (let i = 0; i < keys1.length; i++) {
      expect(map.get(keys1[i])).toEqual(makeValue(heights1[i]));
    }
  });

  it("should get correct kvMap values with limit", async () => {
    const map = await db.kvMap(lastPossibleSortKey, {
      limit: 1,
    });
    expect(map.size).toBe(1);
    expect(map.get(keys1[0])).toEqual(makeValue(heights1[0]));
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
