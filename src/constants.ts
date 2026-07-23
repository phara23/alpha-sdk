export const DEFAULT_API_BASE_URL = 'https://platform.alphaarcade.com/api';

export const DEFAULT_WSS_BASE_URL = 'wss://platform-wss.alphaarcade.com';

export const DEFAULT_MARKET_CREATOR_ADDRESS = '5P5Y6HTWUNG2E3VXBQDZN3ENZD3JPAIR5PKT3LOYJAPAUKOLFD6KANYTRY';

/** Mainnet ALPHA staking pool application ID */
export const DEFAULT_STAKING_APP_ID = 3626756314;

/** Mainnet ALPHA ASA ID (6 decimals) */
export const DEFAULT_ALPHA_ASSET_ID = 2726252423;

/**
 * Reward-per-share precision used by the staking contract.
 * claimable = pending + floor(staked * (acc - acc_snapshot) / PRECISION)
 */
export const STAKING_REWARD_PRECISION = 1_000_000_000_000n;
