/* eslint-disable @typescript-eslint/no-unused-vars */
import type { RedisCommander, Result, Callback } from "ioredis";

// extend ioredis declarations to accomodate for Lua scripts
declare module "ioredis" {
  interface RedisCommander<Context> {
    // prettier-ignore
    atomic_del(
      key: string,
      sortKey: string,
      prefix: string,
      sls: string,
      callback?: Callback<void>
    ): Result<void, Context>;
    // prettier-ignore
    atomic_prune(
      entriesStored: number,
      prefix: string,
      sls: string,
      callback?: Callback<void>
    ): Result<void, Context>;
    // prettier-ignore
    atomic_put(
      key: string,
      sortKey: string,
      value: string,
      minCount: number,
      maxCount: number,
      prefix: string,
      sls: string,
      callback?: Callback<void>
    ): Result<void, Context>;
  }
}
