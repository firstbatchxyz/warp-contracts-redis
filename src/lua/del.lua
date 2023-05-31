-- DEPRACATED: we are not deleting this way!
-- instead, we set the key to be deleted by updating it with empty string.

local key = KEYS[1]
local sortKey = KEYS[2]
local prefix = ARGV[1]
local sls = ARGV[2]

-- remove everything less-than or equal-to this sortKey under the given key
local cacheKeysToRemove = redis.call(
  "ZRANGE",
  prefix .. ".keys",
  "[" .. key .. sls .. sortKey,
  "(" .. key .. sls .. "999999999999,9999999999999,zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  "BYLEX"
)

-- also remove them from the sorted set
redis.call("ZREM", prefix .. ".keys", unpack(cacheKeysToRemove))
for _, cacheKey in pairs(cacheKeysToRemove) do
  redis.call("DEL", prefix .. "." .. cacheKey)
end
