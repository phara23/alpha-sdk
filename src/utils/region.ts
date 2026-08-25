/**
 * Region gate for perps risk-opening (open a position, deposit LP liquidity).
 *
 * Perps are NOT available in restricted jurisdictions. The SDK enforces this
 * with a best-effort IP country lookup before building any risk-opening
 * transaction; closing a position, withdrawing liquidity, and liquidations are
 * NEVER gated — nobody's funds are ever trapped by this check.
 *
 * Restricted list (2026-08-25): US, Canada, UK, Australia, New Zealand,
 * Singapore, Hong Kong, Japan, China, India, Southeast Asia
 * (TH/MY/ID/VN/PH/MM/KH/LA), plus sanctioned jurisdictions (Cuba, Iran,
 * North Korea, Syria) and Russia / Belarus.
 *
 * This is a compliance control, not a security boundary: the contract itself
 * is permissionless and a client-side check is inherently best-effort. Using
 * this SDK from a restricted jurisdiction — with any modification or setting
 * that skips the check — violates the Alpha Arcade terms of service.
 * `disablePerpsRegionCheck` exists solely for first-party operational
 * infrastructure (keepers/liquidation bots on US-hosted servers acting for
 * the protocol itself).
 */

export const PERPS_RESTRICTED_REGIONS = new Set([
  'CU', 'IR', 'KP', 'SY', // OFAC comprehensively-sanctioned
  'RU', 'BY',             // Russia / Belarus
  'US',                   // United States
  'CA', 'GB', 'AU', 'NZ', // Canada, UK, Australia, New Zealand
  'SG', 'HK', 'JP',       // Singapore, Hong Kong, Japan
  'CN', 'IN',             // China, India
  'TH', 'MY', 'ID', 'VN', 'PH', 'MM', 'KH', 'LA', // Southeast Asia
]);

export class PerpsRestrictedRegionError extends Error {
  readonly country: string;
  constructor(country: string) {
    super(
      `Perps trading is not available in your region (${country}). ` +
      'Restricted jurisdictions include the US, UK, Canada, Australia, ' +
      'New Zealand, Singapore, Hong Kong, Japan, China, India, Southeast ' +
      'Asia, and sanctioned countries. Closing positions and withdrawing ' +
      'liquidity remain available.',
    );
    this.name = 'PerpsRestrictedRegionError';
    this.country = country;
  }
}

// one lookup per process; the answer cannot change under a running client
let cachedCountry: string | null | undefined;

const lookupCountry = async (): Promise<string | null> => {
  if (cachedCountry !== undefined) return cachedCountry;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5_000);
    const r = await fetch('https://get.geojs.io/v1/ip/country.json', { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const j = (await r.json()) as { country?: string };
      if (j?.country && /^[A-Z]{2}$/.test(j.country)) {
        cachedCountry = j.country;
        return cachedCountry;
      }
    }
  } catch { /* offline / blocked lookup — see below */ }
  cachedCountry = null;
  return null;
};

/**
 * Throws PerpsRestrictedRegionError when the caller's IP resolves to a
 * restricted jurisdiction. A failed lookup passes (best-effort — an air-gapped
 * or egress-restricted server must not be bricked), which is why this is a
 * compliance signal rather than a hard control.
 */
export const assertUnrestrictedRegion = async (
  config: { disablePerpsRegionCheck?: boolean },
): Promise<void> => {
  if (config.disablePerpsRegionCheck) return;
  const country = await lookupCountry();
  if (country && PERPS_RESTRICTED_REGIONS.has(country)) {
    throw new PerpsRestrictedRegionError(country);
  }
};
