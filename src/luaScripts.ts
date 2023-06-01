/**
 * A Lua Command defintion, as defined by `ioredis` in `Redis.defineCommand` function.
 *
 * - `lua` is the script to run
 * - `numberOfKeys` is the number of keys to be given to the command, where it is accessed
 * via `KEYS`. If omitted, the number of keys is treated dynamically and `ioredis` will have
 * the first argument determine the number of keys. We do not omit this in our scripts.
 * - `readOnly` is an additional option, where if true, the script is treated as read-only. See
 * the relevant section here: {@link https://redis.io/docs/manual/programmability/#read-only-scripts}
 */
export const luaScripts: { [name: string]: { lua: string; numberOfKeys: number; readOnly?: boolean } } = {
  /** {@see [definition](./lua/prune.lua)} */
  sortkeycache_atomic_prune: {
    lua: `
local entriesStored = KEYS[1]
local prefix = ARGV[1]
local sls = ARGV[2]

local allCacheKeys = redis.call(
  "ZRANGE",
  prefix .. ".keys",
  "-",
  "+",
  "BYLEX"
)

local keys = {}
for _, cacheKey in pairs(allCacheKeys) do
  keys[string.gmatch(cacheKey, "([^" .. sls .. "]+)")()] = true
end

for key, _ in pairs(keys) do
  local cacheKeysToRemove = redis.call(
    "ZRANGE",
    prefix .. ".keys",
    "(" .. key .. sls .. "999999999999,9999999999999,zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    "(" .. key .. sls .. "000000000000,0000000000000,0000000000000000000000000000000000000000000000000000000000000000",
    "BYLEX",
    "REV",
    "LIMIT",
    entriesStored,
    -1
  )

  redis.call("ZREM", prefix .. ".keys", unpack(cacheKeysToRemove))
  for _, cacheKey in pairs(cacheKeysToRemove) do
    redis.call("DEL", prefix .. "." .. cacheKey)
  end
end
`,
    numberOfKeys: 1,
  },
  /** {@see [definition](./lua/put.lua)} */
  sortkeycache_atomic_put: {
    lua: `
local key = KEYS[1]
local sortKey = KEYS[2]
local value = ARGV[1]
local minCount = tonumber(ARGV[2])
local maxCount = tonumber(ARGV[3])
local prefix = ARGV[4]
local sls = ARGV[5]

redis.call("SET", prefix .. "." .. key .. sls .. sortKey, value)
redis.call("ZADD", prefix .. ".keys", 0, key .. sls .. sortKey)

local count = redis.call(
  "ZLEXCOUNT",
  prefix .. ".keys",
  "(" .. key .. sls .. "000000000000,0000000000000,0000000000000000000000000000000000000000000000000000000000000000",
  "[" .. key .. sls .. sortKey
)

if count > maxCount then
  local cacheKeysToRemove = redis.call(
    "ZRANGE",
    prefix .. ".keys",
    "(" .. key .. sls .. sortKey,
    "(" .. key .. sls .. "000000000000,0000000000000,0000000000000000000000000000000000000000000000000000000000000000",
    "BYLEX",
    "REV",
    "LIMIT",
    minCount,
    -1
  )

  if #cacheKeysToRemove ~= 0 then
    redis.call("ZREM", prefix .. ".keys", unpack(cacheKeysToRemove))
    for _, cacheKey in pairs(cacheKeysToRemove) do
      redis.call("DEL", prefix .. "." .. cacheKey)
    end
  end
end
`,
    numberOfKeys: 2,
  },
};
