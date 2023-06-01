[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Test Workflow](https://github.com/firstbatchxyz/warp-contracts-redis/actions/workflows/test.yml/badge.svg?branch=master)
![Build Workflow](https://github.com/firstbatchxyz/warp-contracts-redis/actions/workflows/build.yml/badge.svg?branch=master)

# Warp Contracts Redis Cache

> Warp Contracts SortKeyCache implementation using [Redis](https://redis.io/).

Warp Contracts will `open` and `close` the client many times, and we have seen that this causes unexpected errors sometimes, mostly due to client being closed. To workaround this problem, we have a "managed" setting. Instead of providing a URL, you can provide the Redis client itself to the RedisCache. The effects of doing that are as follows:

- `open` function will be disabled, calling it will have no effect; it is user's responsibility to connect.
- `close` function will be disabled, calling it will have no effect; it is user's responsibility to disconnect.
- the user should make the necessary configurations for `inMemory: true` option; a static function is exposed for this purpose: `this.setConfigForInMemory`.

You can see if the client is managed or not via the `isManaged` field.

### Lua Scripts

Some of the functionality is achieved via Lua scripts (v5.1), which you can find under `src/lua` for _reference_; the actual scripts are written in `luaScripts.ts`. The `prefix` and `subLevelSeparator` must be provided as argument to Lua scripts, because multiple RedisCache instances may be created with different prefixes or sub-level separators but they may connect to the same client; and for that reason we can't simply hardcode them in the script.

## Installation

To install, do:

```sh
yarn add warp-contracts-redis # yarn
npm i warp-contracts-redis    # npm
```

## Test

Tests require a Redis server running at the specified URL within `tests/constants`. We use the default Redis URL for that, if you would like to run tests on a custom URL you must change the URL within the constants file.

```sh
yarn test         # test everything
yarn test <path>  # test a specific suite
```

## Resources

To learn more, see the links below:

- [SortKeyCache](https://github.com/warp-contracts/warp/blob/main/src/cache/SortKeyCache.ts)
- [Warp docs for SortKey](https://academy.warp.cc/docs/sdk/advanced/bundled-interaction#how-it-works)
- [KV class of SmartWeave](https://github.com/warp-contracts/warp/blob/main/src/legacy/smartweave-global.ts#L260)
