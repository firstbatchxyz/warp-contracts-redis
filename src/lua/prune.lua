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
  -- we are parsing the key from a cacheKey w.r.t sub-level separator
  -- this is done by calling the iterator created from gmatch
  -- and returning the first iteration
  keys[string.gmatch(cacheKey, "([^" .. sls .. "]+)")()] = true
end

-- prune for each key
for key, _ in pairs(keys) do
  -- by offsetting entriesStored keys in reverse, we can remove
  -- all the remaining keys from this ZRANGE query
  local cacheKeysToRemove = redis.call(
    "ZRANGE",
    prefix .. ".keys",
    "(" .. key .. sls .. "999999999999,9999999999999,zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    "(" .. key .. sls .. "000000000000,0000000000000,0000000000000000000000000000000000000000000000000000000000000000",
    "BYLEX",
    "REV",
    "LIMIT",
    entriesStored, -- offset
    -1             -- limit (-1 returns everything)
  )

  if #cacheKeysToRemove ~= 0 then
    redis.call("ZREM", prefix .. ".keys", unpack(cacheKeysToRemove))
    for _, cacheKey in pairs(cacheKeysToRemove) do
      redis.call("DEL", prefix .. "." .. cacheKey)
    end
  end
end
