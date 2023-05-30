local key = KEYS[1]
local sortKey = KEYS[2]
local prefix = ARGV[1]
local sls = ARGV[2]

local cacheKeysToRemove = redis.call(
  "ZRANGE",
  prefix .. ".keys",
  "[" .. key .. sls .. sortKey,
  "(" .. key .. sls .. "999999999999,9999999999999,zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  "BYLEX"
)

redis.call("ZREM", prefix .. ".keys", unpack(cacheKeysToRemove))
for _, cacheKey in pairs(cacheKeysToRemove) do
  redis.call("DEL", prefix .. "." .. cacheKey)
end
