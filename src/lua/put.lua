local key = KEYS[1]
local sortKey = KEYS[2]
local value = ARGV[1]
local minCount = tonumber(ARGV[2])
local maxCount = tonumber(ARGV[3])
local prefix = ARGV[4]
local sls = ARGV[5]

-- put in cache & sorted set
redis.call("SET", prefix .. "." .. key .. sls .. sortKey, value)
redis.call("ZADD", prefix .. ".keys", 0, key .. sls .. sortKey)

-- get number of entries for this key
local count = redis.call(
  "ZLEXCOUNT",
  prefix .. ".keys",
  "(" .. key .. sls .. "000000000000,0000000000000,0000000000000000000000000000000000000000000000000000000000000000",
  "[" .. key .. sls .. sortKey
)

-- prune if needed
if count > maxCount then
  local cacheKeysToRemove = redis.call(
    "ZRANGE",
    prefix .. ".keys",
    "[" .. key .. sls .. sortKey,
    "(" .. key .. sls .. "000000000000,0000000000000,0000000000000000000000000000000000000000000000000000000000000000",
    "BYLEX",
    "REV",
    "LIMIT",
    minCount, -- offset
    -1        -- limit (-1 returns everything)
  )

  if #cacheKeysToRemove ~= 0 then
    redis.call("ZREM", prefix .. ".keys", unpack(cacheKeysToRemove))
    for _, cacheKey in pairs(cacheKeysToRemove) do
      redis.call("DEL", prefix .. "." .. cacheKey)
    end
  end
end
