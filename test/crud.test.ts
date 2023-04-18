import { createClient } from "redis";
import { RedisCache } from "../src";
import { globals } from "../jest.config.cjs";

jest.setTimeout(100 * 1000);

describe("crud operations", () => {
  let db: RedisCache;

  beforeAll(async () => {
    const redisClient = createClient({
      url: globals.__REDIS_URL__,
    });
    db = new RedisCache({
      prefix: "wcr-crud-test",
      minEntriesPerContract: 10,
      maxEntriesPerContract: 100,
      client: redisClient,
    });
    await db.open();
  });

  it("should get & set keys", async () => {
    db.put({ key: "a", sortKey: "1" }, 100);
    const v = await db.get({ key: "a", sortKey: "1" });
    expect(v?.cachedValue).toBe(100);
  });

  afterAll(async () => {
    // need to wait a bit otherwise you get `DisconnectsClientError` error
    await new Promise((res) => {
      setTimeout(res, 1000);
    });
    await db.close();
  });
});
