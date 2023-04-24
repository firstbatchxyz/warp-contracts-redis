/**
 * Formats a sort key with the given block height
 * @param blockHeight block height
 * @param sequencerValue defaults to an arbitrary value for testing purposes
 * @param sequencerValue a sha256 hash of the concatenated buffers of the transaction id and block hash,
 * defaults to an arbitrary value for testing purposes
 * @returns sortKey
 */
export const getSortKey = (
  blockHeight: number,
  sequencerValue = "1643210931796",
  hash = "81e1bea09d3262ee36ce8cfdbbb2ce3feb18a717c3020c47d206cb8ecb43b767"
) => {
  const blockHeightPadded = blockHeight.toString().padStart(12, "0");

  return `${blockHeightPadded},${sequencerValue},${hash}`;
};

/**
 * Just map some input to some other value, testing purposes.
 */
export const makeValue = (i: number) => 100 * i;
