-- find the keys to remove
local cacheKeysToRemove = redis.call(
  "ZRANGEBYLEX",
  "__PFX__.keys",
  "[" .. KEYS[1] .. "__SLS__" .. KEYS[2],
  "[" .. KEYS[1] .. "__SLS____LPSK__"
)

-- TODO: can this be done without a loop?
for _, cacheKey in ipairs(cacheKeysToRemove) do
  -- remove key from sorted set
  redis.call("ZREM", "__PFX__.keys", cacheKey)
  -- remove key itself
  redis.call("DEL", "__PFX__." .. cacheKey)
end

-- returns the number of keys to be removed
return #cacheKeysToRemove
