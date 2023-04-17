import { createClient } from "redis";
import { RedisCache } from "../src";
import { globals } from "../jest.config.cjs";

describe("crud operations", () => {
  let db: RedisCache;
  beforeAll(async () => {
    db = new RedisCache({
      prefix: "wcr-crud-test",
      minEntriesPerContract: 10,
      maxEntriesPerContract: 100,
      client: createClient({
        url: globals.__REDIS_URL__,
      }),
    });
  });

  // TODO
});
