/* eslint-disable @typescript-eslint/no-unused-vars */
import type { RedisCommander, Result, Callback } from "ioredis";

// extend ioredis declarations to accomodate for Lua scripts
declare module "ioredis" {
  interface RedisCommander<Context> {
    atomic_del(key: string, sortKey: string, callback?: Callback<number>): Result<number, Context>;
  }
}
