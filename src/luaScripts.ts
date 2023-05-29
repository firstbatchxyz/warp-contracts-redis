import { genesisSortKey, lastPossibleSortKey } from "warp-contracts";

/**
 * A Lua Command defintion, as defined by `ioredis` in `Redis.defineCommand` function.
 *
 * - `lua` is the script to run
 * - `numberOfKeys` is the number of keys to be given to the command, where it is accessed
 * via `KEYS`. If omitted, the number of keys is treated dynamically and `ioredis` will have
 * the first argument determine the number of keys.
 * - `readOnly` is an additional option, where if true, the script is treated as read-only. See
 * the relevant section here: {@link https://redis.io/docs/manual/programmability/#read-only-scripts}
 */
type LuaCommandDefintionType = { lua: string; numberOfKeys?: number; readOnly?: boolean };

export class LuaScriptBuilder {
  /** Sub-level separator, usually `|` */
  private readonly sls: string;
  /** Prefix of all keys */
  private readonly pfx: string;
  /** Last possible sortKey */
  private readonly lpsk = lastPossibleSortKey;
  /** genesis sortKey */
  private readonly gsk = genesisSortKey;

  constructor(prefix: string, subLevelSeparator: string) {
    this.sls = subLevelSeparator;
    this.pfx = prefix;
  }

  /**
   *
   * @returns an array of doubles, that have the command name and definition
   */
  commands(): [name: string, definition: LuaCommandDefintionType][] {
    console.log(this.atomic_del().lua);
    return [["atomic_del", this.atomic_del()]];
  }

  /** @see [reference](lua/del.lua) */
  private atomic_del(): LuaCommandDefintionType {
    return {
      lua: `
      local cacheKeysToRemove = redis.call(
        "ZRANGEBYLEX",
        "${this.pfx}.keys",
        "[" .. KEYS[1] .. "${this.sls}" .. KEYS[2],
        "[" .. KEYS[1] .. "${this.sls}${this.lpsk}"
      )
       
      for _, cacheKey in ipairs(cacheKeysToRemove) do
        redis.call("ZREM", "${this.pfx}.keys", cacheKey)
        redis.call("DEL", "${this.pfx}." .. cacheKey)
      end

      return #cacheKeysToRemove`,
      numberOfKeys: 2,
    };
  }
}
