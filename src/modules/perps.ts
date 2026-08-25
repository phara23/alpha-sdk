import * as algosdk from 'algosdk';
import { AtomicTransactionComposer, getApplicationAddress } from 'algosdk';
import type {
  AlphaClientConfig,
  OpenPerpParams,
  ClosePerpParams,
  LpDepositParams,
  LpWithdrawParams,
  PerpActionResult,
  PerpsMarket,
  PerpPosition,
  PerpPositionView,
} from '../types.js';
import {
  DEFAULT_PERPS_APP_ID,
  DEFAULT_PERPS_ORACLE_APP_ID,
  PERPS_FUNDING_SCALE,
  PERPS_POS_BOX_MBR,
  PERPS_LP_BOX_MBR,
} from '../constants.js';
import { checkAssetOptIn } from '../utils/state.js';
import { assertUnrestrictedRegion } from '../utils/region.js';

/**
 * ALGO/USD LP-vault perpetual DEX. Pure algod — no platform API.
 *
 * The contract escrows via grouped `[Payment box-MBR] + [axfer USDC] + [call]`
 * (the call reads Gtxn[gi-2]=payment, Gtxn[gi-1]=axfer). It pumps opcode budget
 * via OpUp GroupCredit, so every call must OVERPAY its outer flat fee to cover
 * the OpUp inner calls plus the contract's fee=0 inner sends. Positions/LP
 * shares live in boxes (b"p"+addr / b"l"+addr), not local state.
 */

const BPS = 10_000n;

// generous flat outer fees (µALGO) to feed OpUp GroupCredit + fee=0 inner sends.
const TRADE_FEE_MICRO = 10_000; // open/close/liquidate: opup TRADE_BUDGET + up to 3 inner sends
const LP_FEE_MICRO = 6_000; // lp_deposit/withdraw: opup LP_BUDGET + up to 2 inner sends

const OPEN_METHOD = new algosdk.ABIMethod({
  name: 'open_position',
  args: [
    { type: 'uint8', name: 'is_long' },
    { type: 'uint64', name: 'size_base' },
    { type: 'uint64', name: 'limit_price' },
  ],
  returns: { type: 'uint64' },
});
const CLOSE_METHOD = new algosdk.ABIMethod({
  name: 'close_position',
  args: [{ type: 'uint64', name: 'limit_price' }],
  returns: { type: 'uint64' },
});
const LIQUIDATE_METHOD = new algosdk.ABIMethod({
  name: 'liquidate',
  args: [{ type: 'address', name: 'trader' }],
  returns: { type: 'uint64' },
});
const LP_DEPOSIT_METHOD = new algosdk.ABIMethod({
  name: 'lp_deposit',
  args: [{ type: 'uint64', name: 'min_shares_out' }],
  returns: { type: 'uint64' },
});
const LP_WITHDRAW_METHOD = new algosdk.ABIMethod({
  name: 'lp_withdraw',
  args: [
    { type: 'uint64', name: 'shares' },
    { type: 'uint64', name: 'min_amount_out' },
  ],
  returns: { type: 'uint64' },
});
const POKE_METHOD = new algosdk.ABIMethod({
  name: 'poke',
  args: [],
  returns: { type: 'uint8' },
});
const REPORT_ORACLE_DOWN_METHOD = new algosdk.ABIMethod({
  name: 'report_oracle_down',
  args: [],
  returns: { type: 'uint64' },
});

type PerpsIds = { perpsAppId: number; oracleAppId: number; usdcAssetId: number };

const resolveIds = (config: AlphaClientConfig): PerpsIds => {
  const perpsAppId = config.perpsAppId ?? DEFAULT_PERPS_APP_ID;
  if (!perpsAppId) {
    throw new Error('perpsAppId is not set (perps pool not deployed / configured).');
  }
  return {
    perpsAppId,
    oracleAppId: config.perpsOracleAppId ?? DEFAULT_PERPS_ORACLE_APP_ID,
    usdcAssetId: config.usdcAssetId,
  };
};

// ------------------------------------------------------------ state decoding
type RawValue = { uint: bigint; bytes: Uint8Array };
type StateMap = Record<string, RawValue>;

const keyToString = (key: Uint8Array | string): string =>
  typeof key === 'string'
    ? Buffer.from(key, 'base64').toString('utf8')
    : new TextDecoder().decode(key);

const toBytes = (bytes: unknown): Uint8Array => {
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof bytes === 'string') return new Uint8Array(Buffer.from(bytes, 'base64'));
  return new Uint8Array();
};

const decodeState = (kvs: any[] | undefined): StateMap => {
  const out: StateMap = {};
  for (const entry of kvs ?? []) {
    const key = keyToString(entry.key);
    const value = entry.value ?? {};
    out[key] = {
      uint: value.uint !== undefined ? BigInt(value.uint) : 0n,
      bytes: toBytes(value.bytes),
    };
  }
  return out;
};

const u = (s: StateMap, k: string): bigint => s[k]?.uint ?? 0n;

const bytesToBigInt = (b: Uint8Array): bigint => {
  let r = 0n;
  for (const byte of b) r = (r << 8n) | BigInt(byte);
  return r;
};

const boxName = (prefix: string, address: string): Uint8Array => {
  const pk = algosdk.decodeAddress(address).publicKey; // 32 bytes
  const p = new TextEncoder().encode(prefix);
  const out = new Uint8Array(p.length + pk.length);
  out.set(p, 0);
  out.set(pk, p.length);
  return out;
};

// ------------------------------------------------------------------- reads
/** Decoded market global state. Every field we use is a native uint64 global. */
export const getPerpsMarket = async (config: AlphaClientConfig): Promise<PerpsMarket> => {
  const { algodClient } = config;
  const { perpsAppId } = resolveIds(config);
  const info: any = await algodClient.getApplicationByID(perpsAppId).do();
  const s = decodeState(info?.params?.globalState);
  return {
    appId: perpsAppId,
    paused: u(s, 'paused') === 1n,
    isSetup: u(s, 'is_setup') === 1n,
    paramsSet: u(s, 'params_set') === 1n,
    usdcAssetId: Number(u(s, 'usdc_asset_id')),
    oracleAppId: Number(u(s, 'oracle_app_id')),
    oracleAssetId: Number(u(s, 'oracle_asset_id')),
    notionalDivisor: u(s, 'notional_divisor'),
    vaultAssets: u(s, 'vault_assets'),
    totalCollateral: u(s, 'total_collateral'),
    lpSharesTotal: u(s, 'lp_shares_total'),
    badDebtTotal: u(s, 'bad_debt_total'),
    longSizeBase: u(s, 'long_size_base'),
    shortSizeBase: u(s, 'short_size_base'),
    longEntryNotional: u(s, 'long_entry_notional'),
    shortEntryNotional: u(s, 'short_entry_notional'),
    openPositionsCount: u(s, 'open_positions_count'),
    fundingIndexLong: u(s, 'funding_index_long'),
    fundingIndexShort: u(s, 'funding_index_short'),
    fundingRateLongUbps: u(s, 'funding_rate_long_ubps'),
    fundingRateShortUbps: u(s, 'funding_rate_short_ubps'),
    lastAccrualTs: u(s, 'last_accrual_ts'),
    lastOracleTs: u(s, 'last_oracle_ts'),
    oracleDownSince: u(s, 'oracle_down_since'),
    oracleDownSeen: u(s, 'oracle_down_seen'),
    maxPriceAge: u(s, 'max_price_age'),
    vaultCap: u(s, 'vault_cap'),
    maxLeverageX: u(s, 'max_leverage_x'),
    maxPositionNotional: u(s, 'max_position_notional'),
    maxTotalOi: u(s, 'max_total_oi'),
    maxNetExposure: u(s, 'max_net_exposure'),
    tradeFeeBps: u(s, 'trade_fee_bps'),
    baseSpreadBps: u(s, 'base_spread_bps'),
    maxImpactBps: u(s, 'max_impact_bps'),
    fundingMaxBpsHr: u(s, 'funding_max_bps_hr'),
    maintMarginBps: u(s, 'maint_margin_bps'),
    liqRewardBps: u(s, 'liq_reward_bps'),
    liqFlatReward: u(s, 'liq_flat_reward'),
    reserveRatioBps: u(s, 'reserve_ratio_bps'),
    minCollateral: u(s, 'min_collateral'),
  };
};

/** Live FFO mark (raw) for the given oracle app + asset. */
export const getMark = async (
  algodClient: algosdk.Algodv2,
  oracleAppId: number,
  oracleAssetId: number,
): Promise<bigint> => {
  const info: any = await algodClient.getApplicationByID(oracleAppId).do();
  const keyB64 = Buffer.from(algosdk.encodeUint64(oracleAssetId)).toString('base64');
  const kv = (info?.params?.globalState ?? []).find((e: any) => {
    const k = typeof e.key === 'string' ? e.key : Buffer.from(e.key).toString('base64');
    return k === keyB64;
  });
  if (!kv) throw new Error(`No FFO price for asset ${oracleAssetId} on app ${oracleAppId}`);
  const raw = toBytes(kv.value?.bytes);
  if (raw.length < 16) throw new Error('Malformed FFO value');
  return bytesToBigInt(raw.slice(0, 8));
};

/** Raw position box, or null if the wallet has no open position. */
export const getPosition = async (
  config: AlphaClientConfig,
  walletAddress?: string,
): Promise<PerpPosition | null> => {
  const { algodClient, activeAddress } = config;
  const wallet = walletAddress ?? activeAddress;
  const { perpsAppId } = resolveIds(config);
  let box: any;
  try {
    box = await algodClient.getApplicationBoxByName(perpsAppId, boxName('p', wallet)).do();
  } catch (e: any) {
    if (String(e?.status ?? e?.message ?? '').includes('404') || /box not found/i.test(String(e?.message)))
      return null;
    // algod returns 404 for a missing box; treat any not-found as "no position"
    return null;
  }
  const v = toBytes(box?.value);
  if (v.length < 56) return null;
  const at = (o: number) => bytesToBigInt(v.slice(o, o + 8));
  return {
    address: wallet,
    isLong: at(0) === 1n,
    sizeBase: at(8),
    collateral: at(16),
    entryNotional: at(24),
    entryPrice: at(32),
    entryFundingIndex: at(40),
    openTs: at(48),
  };
};

/** LP shares held by a wallet (b"l"+addr box), or 0n. */
export const getLpShares = async (
  config: AlphaClientConfig,
  walletAddress?: string,
): Promise<bigint> => {
  const { algodClient, activeAddress } = config;
  const wallet = walletAddress ?? activeAddress;
  const { perpsAppId } = resolveIds(config);
  try {
    const box: any = await algodClient
      .getApplicationBoxByName(perpsAppId, boxName('l', wallet))
      .do();
    const v = toBytes(box?.value);
    return v.length >= 8 ? bytesToBigInt(v.slice(0, 8)) : 0n;
  } catch {
    return 0n;
  }
};

// --------------------------------------------------------- pricing mirrors
const absDiff = (a: bigint, b: bigint): bigint => (a > b ? a - b : b - a);

/** |net_base| after a signed trade — mirrors net_after_mag in the contract. */
const netAfterMag = (mkt: PerpsMarket, size: bigint, isBuy: boolean): bigint => {
  const longHeavy = mkt.longSizeBase >= mkt.shortSizeBase;
  const mag = absDiff(mkt.longSizeBase, mkt.shortSizeBase);
  if (isBuy === longHeavy) return mag + size; // grows |net|
  if (size <= mag) return mag - size; // partial rebalance
  return size - mag; // crosses zero
};

/**
 * Skew-adjusted execution price (FFO raw) — mirrors exec_price. `isBuy` = open
 * long / close short. Impact applies only when the trade increases |net|.
 */
export const execPrice = (
  mkt: PerpsMarket,
  mark: bigint,
  size: bigint,
  isBuy: boolean,
): bigint => {
  const before = absDiff(mkt.longSizeBase, mkt.shortSizeBase);
  const after = netAfterMag(mkt, size, isBuy);
  let impact = 0n;
  if (after > before) {
    let avgNotional = ((before + after) / 2n * mark) / mkt.notionalDivisor;
    if (avgNotional > mkt.maxNetExposure) avgNotional = mkt.maxNetExposure;
    impact = (mkt.maxImpactBps * avgNotional) / mkt.maxNetExposure;
  }
  const totalBps = mkt.baseSpreadBps + impact;
  return isBuy ? (mark * (BPS + totalBps)) / BPS : (mark * (BPS - totalBps)) / BPS;
};

/**
 * A slippage-guarded limit price from the live mark. `isBuy` = open long / close
 * short. `extraSlippageBps` is headroom ABOVE the current spread+impact so a
 * normal fill passes but a manipulated one reverts.
 */
export const limitFromMark = (
  mkt: PerpsMarket,
  mark: bigint,
  size: bigint,
  isBuy: boolean,
  extraSlippageBps = 50n,
): bigint => {
  const before = absDiff(mkt.longSizeBase, mkt.shortSizeBase);
  const after = netAfterMag(mkt, size, isBuy);
  let impact = 0n;
  if (after > before) {
    let avgNotional = ((before + after) / 2n * mark) / mkt.notionalDivisor;
    if (avgNotional > mkt.maxNetExposure) avgNotional = mkt.maxNetExposure;
    impact = (mkt.maxImpactBps * avgNotional) / mkt.maxNetExposure;
  }
  const tot = mkt.baseSpreadBps + impact + extraSlippageBps;
  return isBuy ? (mark * (BPS + tot)) / BPS : (mark * (BPS - tot)) / BPS;
};

/** Enrich a raw position with a live mark: PnL, funding owed, equity, liq price. */
export const buildPositionView = (
  pos: PerpPosition,
  mkt: PerpsMarket,
  mark: bigint,
): PerpPositionView => {
  const div = mkt.notionalDivisor;
  const notionalNow = (pos.sizeBase * mark) / div;
  // signed PnL at mark
  const idxNow = pos.isLong ? mkt.fundingIndexLong : mkt.fundingIndexShort;
  const fundingOwed = (pos.entryNotional * (idxNow - pos.entryFundingIndex)) / PERPS_FUNDING_SCALE;
  const priceMove = (pos.sizeBase * absDiff(mark, pos.entryPrice)) / div;
  const gained = pos.isLong ? mark >= pos.entryPrice : mark < pos.entryPrice;
  const pnl = gained ? priceMove : -priceMove;
  const equitySigned = BigInt(pos.collateral) + pnl - fundingOwed;
  const equity = equitySigned > 0n ? equitySigned : 0n;
  // liq price: equity == maint threshold, ignoring future funding growth.
  // long : collateral + size*(liq-entry)/div - funding = entry_notional*maint/1e4
  // short: collateral + size*(entry-liq)/div - funding = entry_notional*maint/1e4
  const maintThresh = (pos.entryNotional * mkt.maintMarginBps) / BPS;
  const rhs = maintThresh - BigInt(pos.collateral) + fundingOwed; // = ±size*(Δ)/div
  let liqPrice = 0n;
  if (pos.sizeBase > 0n) {
    const delta = (rhs * div) / pos.sizeBase; // signed
    liqPrice = pos.isLong ? pos.entryPrice + delta : pos.entryPrice - delta;
    if (liqPrice < 0n) liqPrice = 0n;
  }
  const leverageX = pos.collateral > 0n ? Number(pos.entryNotional) / Number(pos.collateral) : 0;
  return { ...pos, mark, notionalNow, fundingOwed, unrealizedPnl: pnl, equity, liqPrice, leverageX };
};

/** Convenience: read market + mark + position and return the enriched view (or null). */
export const getPositionView = async (
  config: AlphaClientConfig,
  walletAddress?: string,
): Promise<PerpPositionView | null> => {
  const mkt = await getPerpsMarket(config);
  const pos = await getPosition(config, walletAddress);
  if (!pos) return null;
  const mark = await getMark(config.algodClient, mkt.oracleAppId, mkt.oracleAssetId);
  return buildPositionView(pos, mkt, mark);
};

// ----------------------------------------------------------- box existence
const boxExists = async (
  algodClient: algosdk.Algodv2,
  appId: number,
  name: Uint8Array,
): Promise<boolean> => {
  try {
    await algodClient.getApplicationBoxByName(appId, name).do();
    return true;
  } catch {
    return false;
  }
};

// --------------------------------------------------------------- txn builders
const submit = async (
  atc: AtomicTransactionComposer,
  algodClient: algosdk.Algodv2,
): Promise<PerpActionResult> => {
  const result = await atc.execute(algodClient, 8);
  let returnValue: bigint | undefined;
  const last = result.methodResults?.[result.methodResults.length - 1];
  if (last && typeof last.returnValue === 'bigint') returnValue = last.returnValue;
  else if (last && last.returnValue != null) {
    try { returnValue = BigInt(last.returnValue as any); } catch { /* ignore */ }
  }
  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: Number(result.confirmedRound),
    returnValue,
  };
};

/**
 * Open a long/short position. Group: [Payment POS_BOX_MBR → app] + [axfer USDC
 * collateral → app] + [open_position call]. Collateral is `collateralMicro`;
 * the entry fee is taken from it on-chain.
 */
export const openPosition = async (
  config: AlphaClientConfig,
  params: OpenPerpParams,
): Promise<PerpActionResult> => {
  // risk-opening is region-gated (US + restricted jurisdictions); closing and
  // liquidations never are — see utils/region.ts
  await assertUnrestrictedRegion(config);
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId, usdcAssetId } = resolveIds(config);
  const { isLong, sizeBase, collateralMicro, limitPrice } = params;
  if (!Number.isInteger(sizeBase) || sizeBase <= 0) throw new Error('sizeBase must be a positive integer (µALGO)');
  if (!Number.isInteger(collateralMicro) || collateralMicro <= 0) throw new Error('collateralMicro must be a positive integer (µUSDC)');
  if (!Number.isInteger(limitPrice) || limitPrice <= 0) throw new Error('limitPrice must be a positive integer (FFO raw)');

  const sp = await algodClient.getTransactionParams().do();
  const appAddress = getApplicationAddress(perpsAppId).toString();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: TRADE_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();

  atc.addTransaction({
    txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: activeAddress, receiver: appAddress, amount: PERPS_POS_BOX_MBR, suggestedParams: sp,
    }),
    signer,
  });
  atc.addTransaction({
    txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: activeAddress, receiver: appAddress, amount: collateralMicro,
      assetIndex: usdcAssetId, suggestedParams: sp,
    }),
    signer,
  });
  atc.addMethodCall({
    appID: perpsAppId,
    method: OPEN_METHOD,
    methodArgs: [isLong ? 1 : 0, BigInt(sizeBase), BigInt(limitPrice)],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignApps: [oracleAppId],
    appForeignAssets: [usdcAssetId],
    boxes: [{ appIndex: perpsAppId, name: boxName('p', activeAddress) }],
  });
  return submit(atc, algodClient);
};

/** Close the caller's position in full at the skew-adjusted exec price. */
export const closePosition = async (
  config: AlphaClientConfig,
  params: ClosePerpParams,
): Promise<PerpActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId, usdcAssetId } = resolveIds(config);
  const { limitPrice } = params;
  if (!Number.isInteger(limitPrice) || limitPrice <= 0) throw new Error('limitPrice must be a positive integer (FFO raw)');

  const sp = await algodClient.getTransactionParams().do();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: TRADE_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: perpsAppId,
    method: CLOSE_METHOD,
    methodArgs: [BigInt(limitPrice)],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignApps: [oracleAppId],
    appForeignAssets: [usdcAssetId],
    boxes: [{ appIndex: perpsAppId, name: boxName('p', activeAddress) }],
  });
  return submit(atc, algodClient);
};

/** Permissionless liquidation of `trader` (for keepers). */
export const liquidate = async (
  config: AlphaClientConfig,
  trader: string,
): Promise<PerpActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId, usdcAssetId } = resolveIds(config);
  const sp = await algodClient.getTransactionParams().do();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: TRADE_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: perpsAppId,
    method: LIQUIDATE_METHOD,
    methodArgs: [trader],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignApps: [oracleAppId],
    appForeignAssets: [usdcAssetId],
    appAccounts: [trader],
    boxes: [{ appIndex: perpsAppId, name: boxName('p', trader) }],
  });
  return submit(atc, algodClient);
};

/**
 * Deposit USDC into the LP vault. Group: [Payment LP_BOX_MBR (first deposit
 * only)] + [axfer USDC] + [lp_deposit call].
 */
export const lpDeposit = async (
  config: AlphaClientConfig,
  params: LpDepositParams,
): Promise<PerpActionResult> => {
  // adding liquidity is risk-opening too — region-gated like openPosition;
  // lpWithdraw never is
  await assertUnrestrictedRegion(config);
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId, usdcAssetId } = resolveIds(config);
  const { amountMicro, minSharesOut } = params;
  if (!Number.isInteger(amountMicro) || amountMicro <= 0) throw new Error('amountMicro must be a positive integer (µUSDC)');
  if (!Number.isInteger(minSharesOut) || minSharesOut < 0) throw new Error('minSharesOut must be a non-negative integer');

  const sp = await algodClient.getTransactionParams().do();
  const appAddress = getApplicationAddress(perpsAppId).toString();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: LP_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();

  // MBR payment only on the FIRST deposit (when the LP box doesn't exist yet).
  const hasBox = await boxExists(algodClient, perpsAppId, boxName('l', activeAddress));
  if (!hasBox) {
    atc.addTransaction({
      txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress, receiver: appAddress, amount: PERPS_LP_BOX_MBR, suggestedParams: sp,
      }),
      signer,
    });
  }
  atc.addTransaction({
    txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: activeAddress, receiver: appAddress, amount: amountMicro,
      assetIndex: usdcAssetId, suggestedParams: sp,
    }),
    signer,
  });
  atc.addMethodCall({
    appID: perpsAppId,
    method: LP_DEPOSIT_METHOD,
    methodArgs: [BigInt(minSharesOut)],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignApps: [oracleAppId],
    appForeignAssets: [usdcAssetId],
    boxes: [{ appIndex: perpsAppId, name: boxName('l', activeAddress) }],
  });
  return submit(atc, algodClient);
};

/** Burn LP shares for USDC (adds a USDC opt-in if needed). */
export const lpWithdraw = async (
  config: AlphaClientConfig,
  params: LpWithdrawParams,
): Promise<PerpActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId, usdcAssetId } = resolveIds(config);
  const { shares, minAmountOutMicro } = params;
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('shares must be a positive integer');

  const sp = await algodClient.getTransactionParams().do();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: LP_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();

  const hasUsdc = await checkAssetOptIn(algodClient, activeAddress, usdcAssetId);
  if (!hasUsdc) {
    atc.addTransaction({
      txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress, receiver: activeAddress, amount: 0,
        assetIndex: usdcAssetId, suggestedParams: sp,
      }),
      signer,
    });
  }
  atc.addMethodCall({
    appID: perpsAppId,
    method: LP_WITHDRAW_METHOD,
    methodArgs: [BigInt(shares), BigInt(minAmountOutMicro)],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignApps: [oracleAppId],
    appForeignAssets: [usdcAssetId],
    boxes: [{ appIndex: perpsAppId, name: boxName('l', activeAddress) }],
  });
  return submit(atc, algodClient);
};

/** Permissionless keeper checkpoint: accrue funding + re-derive rates. */
export const poke = async (config: AlphaClientConfig): Promise<PerpActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId } = resolveIds(config);
  const sp = await algodClient.getTransactionParams().do();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: LP_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: perpsAppId,
    method: POKE_METHOD,
    methodArgs: [],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignApps: [oracleAppId],
  });
  return submit(atc, algodClient);
};

/**
 * Permissionless attestation that the FFO feed is (or is no longer) stale.
 * Returns the resulting `oracle_down_since` — 0 means the feed is currently
 * fine. This is the ONLY call that both SUCCEEDS and records an outage: `poke`
 * needs a price fresh enough to trade on, so it reverts exactly when the feed
 * is broken.
 *
 * The outage must be attested CONTINUOUSLY — at least once every
 * ORACLE_ATTEST_GAP (2 days) — or the clock restarts, so an attester bot should
 * run DAILY. The emergency valve opens EMERGENCY_STALENESS (7 days) after the
 * first stamp of an unbroken attestation chain.
 */
export const reportOracleDown = async (
  config: AlphaClientConfig,
): Promise<PerpActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { perpsAppId, oracleAppId } = resolveIds(config);
  const sp = await algodClient.getTransactionParams().do();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: LP_FEE_MICRO, flatFee: true };
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: perpsAppId,
    method: REPORT_ORACLE_DOWN_METHOD,
    methodArgs: [],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    // MUST be present: an unavailable resource is a runtime error, not hasValue=0.
    appForeignApps: [oracleAppId],
  });
  return submit(atc, algodClient);
};

/**
 * Every open position, by enumerating the app's b"p"+addr boxes. This is what a
 * keeper scans; there is no on-chain index. O(n) algod calls, which is fine at
 * the launch caps (max_total_oi caps the book at a handful of positions).
 */
export const readAllPositions = async (
  config: AlphaClientConfig,
): Promise<PerpPosition[]> => {
  const { algodClient } = config;
  const { perpsAppId } = resolveIds(config);
  const list: any = await algodClient.getApplicationBoxes(perpsAppId).do();
  const prefix = 'p'.charCodeAt(0);
  const names: Uint8Array[] = (list?.boxes ?? [])
    .map((b: any) => toBytes(b.name))
    // b"p" + 32-byte pubkey; the b"l" LP boxes share the app and must be skipped
    .filter((n: Uint8Array) => n.length === 33 && n[0] === prefix);

  const out: PerpPosition[] = [];
  for (const name of names) {
    let box: any;
    try {
      box = await algodClient.getApplicationBoxByName(perpsAppId, name).do();
    } catch {
      continue; // box closed between the list and the read
    }
    const v = toBytes(box?.value);
    if (v.length < 56) continue;
    const at = (o: number) => bytesToBigInt(v.slice(o, o + 8));
    const sizeBase = at(8);
    if (sizeBase === 0n) continue;
    out.push({
      address: algosdk.encodeAddress(name.slice(1)),
      isLong: at(0) === 1n,
      sizeBase,
      collateral: at(16),
      entryNotional: at(24),
      entryPrice: at(32),
      entryFundingIndex: at(40),
      openTs: at(48),
    });
  }
  return out;
};
