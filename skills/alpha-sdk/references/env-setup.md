# Environment Setup

Create a `.env` file in your project root with these variables. Defaults to mainnet Algonode public nodes — no registration needed.

```ini
# Your 25-word Algorand mnemonic — NEVER commit this to git
ALPHA_MNEMONIC="word1 word2 word3 ... word25"

# Network — defaults to mainnet Algonode (free, no API key)
ALGOD_SERVER=https://mainnet-api.algonode.cloud
ALGOD_TOKEN=
ALGOD_PORT=443
INDEXER_SERVER=https://mainnet-idx.algonode.cloud
INDEXER_TOKEN=
INDEXER_PORT=443

# The market you're interacting with (Algorand app ID)
MARKET_APP_ID=

# Alpha Arcade matcher app and USDC asset — defaults to mainnet values
MATCHER_APP_ID=3078581851
USDC_ASSET_ID=31566704

# Alpha Arcade API key — required for getLiveMarketsFromApi(), getRewardMarkets(), getWalletOrdersFromApi()
ALPHA_API_KEY=your_api_key_here
```

Add `dotenv` to your project and load it at the top of your entry file:

```bash
npm install dotenv
```

```typescript
import 'dotenv/config';  // loads .env automatically
```

Or load explicitly:

```typescript
import dotenv from 'dotenv';
dotenv.config();
```

## Testnet

To use testnet, point the env vars at Algonode testnet and get the testnet `matcherAppId` from the Alpha Arcade team:

```ini
ALGOD_SERVER=https://testnet-api.algonode.cloud
INDEXER_SERVER=https://testnet-idx.algonode.cloud
```

Then update `matcherAppId` and `usdcAssetId` in your `AlphaClient` config accordingly — see the Constants table in `SKILL.md`.
