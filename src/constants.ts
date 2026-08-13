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

/** ALGO/USD perps pool app ID (mainnet). Override via config.perpsAppId. */
export const DEFAULT_PERPS_APP_ID = 3673221104;

/** Folks Feed Oracle app id used by the perps pool (mainnet). */
export const DEFAULT_PERPS_ORACLE_APP_ID = 1040271396;

/** Perps funding-index scale (1e12) — matches FUNDING_SCALE in the contract. */
export const PERPS_FUNDING_SCALE = 1_000_000_000_000n;

/** Perps box MBR (µALGO): position box (b"p"+addr, 64B) and LP box (b"l"+addr, 8B). */
export const PERPS_POS_BOX_MBR = 41_300;
export const PERPS_LP_BOX_MBR = 18_900;
