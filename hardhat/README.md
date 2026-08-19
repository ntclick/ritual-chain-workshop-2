# Ritual Predict — contracts

The `RitualPredict` market contract, its tests, and the deployment scripts.
Full architecture and the workshop runbook live in [../README.md](../README.md).

## Layout

```
contracts/
  RitualPredict.sol          the market: creation, betting, autonomous resolution, payouts
  RitualPredict.t.sol        Solidity unit tests
  ritual/RitualChain.sol     canonical Ritual addresses + system contract interfaces
  mocks/RitualMocks.sol      test-only stand-ins for the precompiles and system contracts
test/
  RitualPredict.e2e.ts       end-to-end walkthroughs of the workshop flow
scripts/
  block-time.ts              measure the chain's current block time
  deploy.ts                  deploy + prepay execution fees
  fund.ts                    top up the prepaid execution balance
  status.ts                  live state of every market
  create-demo-market.ts      create the preset market from the CLI
  export-abi.ts              copy the compiled ABI into the frontend
```

## Commands

```bash
cp .env.example .env                            # RITUAL_PRIVATE_KEY, funded from the faucet

pnpm test                                       # 33 Solidity + 47 TypeScript tests
pnpm test:solidity                              # Solidity only
pnpm test:e2e                                   # TypeScript only
pnpm coverage                                   # same, with a Solidity coverage report
pnpm typecheck                                  # compile, then tsc --noEmit
pnpm build                                      # compile

npx hardhat run scripts/block-time.ts           # measure block time
npx hardhat run scripts/deploy.ts               # deploy to Ritual Chain
PREDICT_ADDRESS=0x... npx hardhat run scripts/status.ts
PREDICT_ADDRESS=0x... npx hardhat run scripts/fund.ts
```

## How the tests reach Ritual-only code paths

`RitualPredict` hardcodes the canonical addresses from `ritual/RitualChain.sol`. None of
them hold code on a local node, so the constructor alone would revert. Both test layers
solve that the same way: deploy the doubles in `mocks/RitualMocks.sol`, then put their
runtime code at the canonical addresses — `vm.etch` in the Solidity tests,
`hardhat_setCode` in the TypeScript ones.

The contract under test is never modified. It still calls `0x0801`, `0x0803`, the
Scheduler and the RitualWallet exactly as it would on chain, and cannot tell the
difference. No network access and no funded account are needed.

The Scheduler double reproduces the one behaviour the contract genuinely depends on: it
overwrites calldata bytes 4-35 with the real execution index, which is why
`_scheduleResolution` books a `0` placeholder in that position. Its `fire` helper does
not gate on block number, so tests can also deliver an execution *early* and prove the
callback declines to act, and `fireIgnoringCancellation` models an execution already in
flight when `cancel()` landed.

What that combination buys is every branch a live testnet makes slow, expensive or
simply undependable to reach: an oracle returning 500, an executor reporting an error,
an async envelope that has not settled yet, a jq filter that silently matches nothing,
three consecutive failures in a row. The single most important invariant in the contract
— **a failed oracle read is never a NO** — is asserted across all seven of its failure
modes, which is not something you can arrange on demand against a real endpoint.
