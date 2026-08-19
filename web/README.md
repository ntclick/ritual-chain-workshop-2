# Ritual Predict — web

**Live: <https://ritualpredict.vercel.app>** — serving sample markets, because no contract is
reachable from a public page while Ritual's testnet is down. Betting is disabled there and the
board says so. Point it at a running deployment and it switches to live data.

The frontend for the `RitualPredict` market contract. Next.js App Router, viem, and no
wallet library: a market UI does not need one, and the connection logic is small enough
to read in one sitting (`src/lib/wallet.ts`, `src/hooks/useWallet.ts`).

## What it does

- Lists every market, newest first, straight from `getMarkets()`
- Shows the pool split as the market's implied probability, and quotes the pari-mutuel
  payout multiple for the amount you are about to stake
- Places YES/NO bets, claims winnings, claims refunds on invalid markets
- Creates markets, validating against the contract's own bounds before the wallet prompt
- Surfaces the resolution diagnostics that matter: attempt count, observed value, and
  the reason a market went `Invalid`
- Serves the demo oracle at `/api/oracle/eth`

## Setup

```bash
pnpm install
cp .env.local.example .env.local     # NEXT_PUBLIC_PREDICT_ADDRESS
pnpm dev
```

The contract address can also be set from the UI and is remembered in `localStorage`, so
a fresh deployment mid-workshop does not need a rebuild.

## Running the whole thing locally, with no testnet

Ritual Chain's testnet was down while this was built, so the app is driven end to end
against a local Hardhat node. `hardhat/scripts/local-demo.ts` puts the mock system
contracts at the canonical Ritual addresses, so the **unmodified** `RitualPredict` runs
there exactly as it would on chain.

```bash
cd ../hardhat
npx hardhat node                                              # terminal 1

npx hardhat run scripts/local-demo.ts --network localhost     # terminal 2
# prints the deployed address -> put it in web/.env.local

cd ../web && pnpm dev                                         # terminal 3
```

Then, with the app open on <http://localhost:3000>:

```bash
cd hardhat
PREDICT_ADDRESS=0x... npx hardhat run scripts/local-bet.ts --network localhost
PREDICT_ADDRESS=0x... npx hardhat run scripts/local-resolve.ts --network localhost
```

`local-bet.ts` backs both sides from the node's accounts, so the pool split and the
payout maths become visible. `local-resolve.ts` stands in for the Scheduler — a local
node has no Scheduler, so nothing would wake the contract otherwise. Pass `STATUS=503`
to force a failed attempt and watch the market retry, then fall to `Invalid` with every
stake refundable.

## The one thing that cannot be faked

The oracle URL is fetched by a TEE executor in the cloud, never by the browser. A
`localhost` URL will therefore never resolve on a real chain, which is why the create
form warns about it. For a live demo, expose the route first:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Notes

- The ABI in `src/lib/predict-abi.ts` is generated. Regenerate it after changing the
  contract with `cd ../hardhat && npx hardhat build && npx hardhat run scripts/export-abi.ts`.
- `src/lib/presets.ts` mirrors the Solidity enums and
  `hardhat/scripts/market-presets.ts`. If one side changes, change both.
- There is no event subscription. Resolution happens inside a Scheduler-driven
  transaction this app never sends, so polling is the honest model for "the market
  settles whether or not anyone is watching".
