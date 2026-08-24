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
export const DEFAULT_PERPS_APP_ID = 3678733378;

/** Folks Feed Oracle app id used by the perps pool (mainnet). */
export const DEFAULT_PERPS_ORACLE_APP_ID = 1040271396;

/** Perps funding-index scale (1e12) — matches FUNDING_SCALE in the contract. */
export const PERPS_FUNDING_SCALE = 1_000_000_000_000n;

/**
 * Perps box MBR (µALGO), = 2500 + 400 * (key_len + value_len).
 * Position box b"p"+addr is 64B -> 2500 + 400*(33+64) = 41_300.
 * LP box b"l"+addr is 16B (shares u64 | last_mint_ts u64) -> 2500 + 400*(33+16) = 22_100.
 */
export const PERPS_POS_BOX_MBR = 41_300;
export const PERPS_LP_BOX_MBR = 22_100;

/** Oracle-Lite resolution outcomes. KEEP_OPEN is dispute-only. */
export const RESOLUTION_OUTCOME = {
  NO: 0,
  YES: 1,
  FIFTY_FIFTY: 2,
  KEEP_OPEN: 3,
} as const;

/**
 * Oracle-Lite proposer-reward vault app id (mainnet). Armed oracles carry this
 * in their own ext_u1 global — the SDK reads it per-oracle, so this constant is
 * informational.
 */
export const DEFAULT_LITE_REWARDS_APP_ID = 3683917541;
