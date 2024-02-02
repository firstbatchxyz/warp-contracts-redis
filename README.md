[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![NPM](https://img.shields.io/npm/v/warp-contracts-redis?logo=npm&color=CB3837)](https://www.npmjs.com/package/warp-contracts-redis)
![Test Workflow](https://github.com/firstbatchxyz/warp-contracts-redis/actions/workflows/test.yml/badge.svg?branch=master)

# Warp Contracts Redis Cache

> Warp Contracts SortKeyCache implementation using [Redis](https://redis.io/).

Warp Contracts will `open` and `close` the client many times, and we have seen that this causes unexpected errors sometimes, mostly due to client being closed. Furthermore, we would like to have an "online" cache option rather than local caches too. That is why this package was developed.

`RedisCache` solves the `open` and `close` problem with a "managed" setting. Instead of providing a URL, you can provide the Redis client itself. The effects of doing that are as follows:

- `open` function will be disabled, calling it will have no effect; it is user's responsibility to connect.
- `close` function will be disabled, calling it will have no effect; it is user's responsibility to disconnect.
- the user should make the necessary configurations for `inMemory: true` option; a static function is exposed for this purpose: `setConfigForInMemory`.
- you can see if the client is managed or not via the `isManaged` field.

Some of the functionality is achieved via [Lua](https://www.lua.org/home.html) scripts (v5.1), which you can find under `src/lua` for _reference_; the actual scripts are written in `luaScripts.ts`. The `prefix` and `subLevelSeparator` must be provided as argument to Lua scripts, because multiple `RedisCache` instances may be created with different prefixes or sub-level separators but they may connect to the same client; and for that reason we can't simply hardcode them in the script.

> [!TIP]
>
> To learn more about SortKeyCache, see the links below:
>
> - [SortKeyCache](https://github.com/warp-contracts/warp/blob/main/src/cache/SortKeyCache.ts)
> - [Warp docs for SortKey](https://academy.warp.cc/docs/sdk/advanced/bundled-interaction#how-it-works)
> - [KV class of SmartWeave](https://github.com/warp-contracts/warp/blob/main/src/legacy/smartweave-global.ts#L260)

## Installation

You can install the NPM package as shown below:

```sh
npm i warp-contracts-redis
yarn add warp-contracts-redis
pnpm add warp-contracts-redis
```

## Usage

The `RedisCache` constructor takes two inputs, one is of type `CacheOptions` as is the case for all `SortKeyCache` implementations of Warp Contracts. The other is Redis-specific options.

```ts
import type { CacheOptions } from "warp-contracts";
import type { RedisOptions } from "warp-contracts-redis";

const cacheOptions = {
  // does not dump on close
  inMemory: true,

  // acts as a prefix for all keys
  dbLocation: "redis.location",

  // separates key from sortKey
  subLevelSeparator: "|",
} satisfies CacheOptions;

const redisOptions = {
  // redis connection url
  url: "redis://default:redispw@localhost:6379",

  // leave at least this many on pruning
  minEntriesPerContract: 10,

  // after this many entries, prune
  maxEntriesPerContract: 100,
} satisfies RedisOptions;

const redisCache = new RedisCache(cacheOptions, redisOptions);
```

For the managed version, simply create your `ioredis` client outside and pass it within `redisOptions` similar to the example above; do not pass in URL.

## Test

Tests require a Redis server running at the specified URL within `tests/constants`. We use the default Redis URL for that, if you would like to run tests on a custom URL you must change the URL within the constants file.

```sh
pnpm test         # test everything
pnpm test <path>  # test a specific suite
```

## Building

Build the package with:

```sh
pnpm build
```

## Styling

Check styling with:

```sh
pnpm format
pnpm lint
```
