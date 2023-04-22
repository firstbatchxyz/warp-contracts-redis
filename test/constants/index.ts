const constants = {
  DBNAME: "warpcc-redis-test",
  REDIS_URL: "redis://default:redispw@localhost:6379",
  JEST_AFTERALL_TIMEOUT: 1000,
};
export default constants as Readonly<typeof constants>;
