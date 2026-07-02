import type {
  AlphaClientConfig,
  CrossVenueExecConfig,
  CrossVenueRfqQuote,
  RequestRfqQuoteParams,
  SubmitRoutedOrderParams,
  SubmitRoutedOrderResult,
} from '../types.js';
import { DEFAULT_API_BASE_URL } from '../constants.js';

const requireApiKey = (config: AlphaClientConfig, operation: string): string => {
  if (!config.apiKey) {
    throw new Error(`apiKey is required for ${operation}. Retrieve an API key from the Alpha Arcade platform via the Account page and pass it to the client.`);
  }

  return config.apiKey;
};

const getJson = async <T>(
  config: AlphaClientConfig,
  path: string,
  operation: string,
): Promise<T> => {
  const apiKey = requireApiKey(config, operation);
  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'x-api-key': apiKey } });

  if (!response.ok) {
    throw new Error(`Alpha API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
};

const postJson = async <T>(
  config: AlphaClientConfig,
  path: string,
  body: unknown,
  operation: string,
): Promise<T> => {
  const apiKey = requireApiKey(config, operation);
  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message)
      : `${response.status} ${response.statusText}`;
    throw new Error(`Alpha API error: ${message}`);
  }

  return data as T;
};

export const getCrossVenueConfig = async (
  config: AlphaClientConfig,
): Promise<CrossVenueExecConfig> =>
  getJson<CrossVenueExecConfig>(config, '/cross-venue-exec/config', 'cross-venue config fetching');

export const requestRfqQuote = async (
  config: AlphaClientConfig,
  params: RequestRfqQuoteParams,
): Promise<CrossVenueRfqQuote> => {
  const response = await postJson<{ ok: boolean; quote: CrossVenueRfqQuote }>(
    config,
    '/cross-venue-exec/quote',
    params,
    'cross-venue RFQ',
  );

  return response.quote;
};

export const submitRoutedOrder = async (
  config: AlphaClientConfig,
  params: SubmitRoutedOrderParams,
): Promise<SubmitRoutedOrderResult> =>
  postJson<SubmitRoutedOrderResult>(
    config,
    '/cross-venue-exec/submit-for-wallet',
    params,
    'routed order submission',
  );
