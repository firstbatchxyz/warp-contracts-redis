# Warp Contracts Redis Cache

Warp Contracts implementation of the [SortKeyCache](https://github.com/warp-contracts/warp/blob/main/src/cache/SortKeyCache.ts) using [Redis](https://redis.io/). To learn more about `SortKey`'s, see [Warp docs](https://academy.warp.cc/docs/sdk/advanced/bundled-interaction#how-it-works) or check out [KV class](https://github.com/warp-contracts/warp/blob/main/src/legacy/smartweave-global.ts#L260) of SmartWeave global object.

## Installation

Simply `yarn add warp-contracts-redis` or `npm i warp-contracts-redis`.

## Usage

You can use Redis cache within `useStateCache`, `useContractCache` and `useKVStorageFactory` of your Warp instance. An example flow is given below:

```ts
import { RedisCache } from "warp-contracts-redis";
import { WarpFactory } from "warp-contracts";
import { createClient } from "redis"; // or "@redis/client"

// a redis client instance
const redisClient = createClient({
  url: "<your-redis-url>",
});

// deployed contract txId
const contractTxId = "<your-contract-tx-id>";

const warp = WarpFactory.forMainnet()
  .useStateCache(
    new RedisCache({
      client: redisClient,
      prefix: `${contractTxId}.state`,
    })
  )
  .useContractCache(
    new RedisCache({
      client: redisClient,
      prefix: `${contractTxId}.contract`,
    }),
    new RedisCache({
      client: redisClient,
      prefix: `${contractTxId}.src`,
    })
  )
  .useKVStorageFactory(
    (contractTxId: string) =>
      new RedisCache({
        client: redisClient,
        prefix: `${contractTxId}.${contractTxId}`,
      })
  );
```

Note that you can name the `prefix` however you would like, but relating the name to the contract transaction id is a valid approach.

### Atomics Transactions

You can provide `allowAtomics: true` option to enable atomic transactions. In that case, one can use `begin`, `commit` and `rollback` to make atomic transactions, however it is work in progress and might have bugs if `prune` or limited `put` is triggered during a transaction.
