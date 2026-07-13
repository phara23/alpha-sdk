import algosdk from 'algosdk';
import type {
  AlphaClientConfig,
  ComboRfqQuote,
  RequestComboRfqQuoteParams,
  SubmitComboRfqResult,
  SubmitComboRfqWalletParams,
} from '../types.js';
import { DEFAULT_API_BASE_URL } from '../constants.js';

const requireApiKey = (config: AlphaClientConfig, operation: string): string => {
  if (!config.apiKey) {
    throw new Error(`apiKey is required for ${operation}.`);
  }

  return config.apiKey;
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
    const code = data && typeof data === 'object' && 'code' in data
      ? ` (${String((data as { code?: unknown }).code)})`
      : '';
    throw new Error(`Alpha API error: ${message}${code}`);
  }

  return data as T;
};

export const requestComboRfqQuote = async (
  config: AlphaClientConfig,
  params: RequestComboRfqQuoteParams,
): Promise<ComboRfqQuote> =>
  postJson<ComboRfqQuote>(
    config,
    '/combo/quote',
    {
      groups: params.tree.groups,
      connectors: params.tree.connectors,
      grossStakeMicro: params.grossStakeMicro,
      userAddress: params.userAddress,
      ...(params.name ? { name: params.name } : {}),
    },
    'combo RFQ quote',
  );

export const submitComboRfqWallet = async (
  config: AlphaClientConfig,
  params: SubmitComboRfqWalletParams,
): Promise<SubmitComboRfqResult> =>
  postJson<SubmitComboRfqResult>(
    config,
    '/combo/submit',
    params,
    'combo RFQ submission',
  );

export const signComboRfqTransactions = async (
  unsignedTxnsB64: string[],
  signer: AlphaClientConfig['signer'],
): Promise<string[]> => {
  const txns = unsignedTxnsB64.map((txnB64) =>
    algosdk.decodeUnsignedTransaction(Buffer.from(txnB64, 'base64')),
  );
  const signed = await signer(txns, txns.map((_, index) => index));

  return signed.map((bytes) => Buffer.from(bytes).toString('base64'));
};

