# Ritual Predict

A self-resolving binary prediction market on [Ritual Chain](https://docs.ritualfoundation.org).

Create a market like _"Will ETH/USD be at least $4,000 when this market resolves?"_, stake native
RITUAL on YES or NO, and watch it settle itself. When the betting window closes, **nobody presses a
resolve button and no backend cron job runs**. The Ritual Scheduler wakes the contract at a block
fixed when the market was created; the contract calls the HTTP precompile to read the configured
oracle URL, extracts one number with the jq precompile, compares it to the target, and settles.
Winners then pull their proportional share of the pool.

---

## Architecture

```
                 createMarket()                    ┌──────────────────────────┐
   user  ─────────────────────────────────────────▶│  RitualPredict.sol       │
   user  ─────────── bet(id, YES|NO) ─────────────▶│                          │
                                                   │  markets, pools, stakes  │
                                     schedule() ◀──┤                          │
                                                   └──────────────────────────┘
    ┌─────────────────────────────┐                     ▲              │
    │ Scheduler  0x56e7…D58B      │  onScheduledResolve │              │ deposit()
    │ system contract             │─────────────────────┘              ▼
    │ fires at resolveBlock,      │                        ┌────────────────────────┐
    │ 3 attempts, 200 blocks apart│                        │ RitualWallet 0x532F…   │
    └─────────────────────────────┘                        │ prepaid execution fees │
                                                           └────────────────────────┘
                        inside that one scheduled transaction:

   TEEServiceRegistry 0x9644…  ──pickServiceByCapability(HTTP_CALL)──▶  executor address
   HTTP precompile    0x0801   ──GET oracleUrl (in a TEE)───────────▶  demo oracle
   jq  precompile     0x0803   ──jsonPath, outputType=uint256───────▶  observed value
                                          │
                                          ▼
                        observed ⋈ target  →  Resolved(YES|NO)
                        read failed 3×     →  Invalid (everyone refunds)
```

---

### Design decisions worth knowing

**Deadlines are block numbers, not timestamps.** The Scheduler fires at a _block_, so betting also
closes at a _block_. That way "betting is closed" and "the Scheduler woke us" can never disagree,
whatever the chain's block time does. `createMarket` takes human durations in seconds and converts
them using the `blockTimeMs` fixed at deployment. Nothing on-chain reads `block.timestamp`.

**On Ritual Chain, `block.timestamp` is Unix milliseconds** (≈`1.786e12`), not seconds — verified
against the live chain, not assumed. That is a good reason to avoid it entirely, which this contract
does. Measured block time was ≈195 ms when this was written; run
`npx hardhat run scripts/block-time.ts` to check it for yourself.

**A failed oracle read is never a NO.** `onScheduledResolve` treats a precompile failure, a non-200
response, an undecodable envelope, an executor error message, and an unparseable body all as
_failures_, not as a negative outcome. The response decode happens through an external `try`, so
malformed bytes surface as a caught failure instead of reverting the execution and rolling back the
attempt counter.

**Retries are the Scheduler's own mechanism.** `createMarket` books `numCalls = 3` executions
`frequency = 200` blocks apart in a single `schedule()` call. Attempt 1 lands at `resolveBlock`; if
it succeeds, the contract `cancel()`s the remainder; if all three fail, the market becomes `Invalid`
and every stake is refundable. Each attempt re-rolls the TEE executor seed, so one unhealthy
executor cannot sink a market. The callback is idempotent, so a leftover execution is harmless.

**No executor is hardcoded.** The contract calls
`TEEServiceRegistry.pickServiceByCapability(HTTP_CALL, true, seed, 8)` at resolution time.

**Payouts are pull-based and loop-free.** `claimWinnings` computes
`stake × totalPool ÷ winningPool` for the caller only. Integer division leaves sub-wei dust in the
contract; that is deliberate and negligible.

**Empty winning side → refundable.** Pari-mutuel has no denominator when nobody backed the winning
answer, so the market records the outcome and observed value, then becomes `Invalid` so everyone
takes their stake back.

**Resolution parameters are immutable.** `target`, `comparator`, `oracleUrl`, `jsonPath`, and
`resolveBlock` have no setter. The `ResolutionRuleSet` event records them at creation.

---

## Prerequisites

- Node.js 22+ and `pnpm` (Hardhat 3 requires 22; so does the `.env` loader in
  `hardhat.config.ts`)
- A wallet with testnet RITUAL from <https://faucet.ritualfoundation.org> — only needed
  to deploy. Everything below runs without one.

## Setup

```bash
cd hardhat
pnpm install
cp .env.example .env     # RITUAL_PRIVATE_KEY, only needed for --network ritual
pnpm test
```

---

## Verifying it without the chain

The testnet was unreachable while this fork was built, so the whole contract is
exercised on a local Hardhat node instead — not as a substitute for a live run, but
because it reaches branches a live run cannot produce on demand.

```bash
cd hardhat
pnpm test         # 33 Solidity + 47 TypeScript tests
pnpm coverage     # 98.93% line coverage on RitualPredict.sol
pnpm typecheck
```

`RitualPredict` hardcodes the canonical Ritual addresses, and none of them hold code on
a local node — the constructor alone reverts. So the suites deploy the doubles in
`contracts/mocks/RitualMocks.sol` and put their runtime code at those exact addresses
(`vm.etch` in Solidity, `hardhat_setCode` in TypeScript). **The contract under test is
never modified**: it still calls `0x0801`, `0x0803`, the Scheduler and the RitualWallet
and cannot tell the difference. See [hardhat/README.md](hardhat/README.md) for the
details.

What that buys, beyond the happy path:

| Behaviour | Why a live testnet is a poor place to check it |
|---|---|
| A failed read is never a NO — all 7 failure modes | You cannot ask a real oracle for a 500, an executor error, and an unsettled envelope on demand |
| 3 failures → `Invalid` → everyone refunds | Needs three consecutive failures, ~600 blocks apart |
| Recovery when a later attempt succeeds | Needs a failure followed by a success, on cue |
| A jq filter that matches nothing | jq answers "successfully" with empty output, so this fails silently and is easy to miss |
| The `0` placeholder in calldata bytes 4-35 | The Scheduler double overwrites it exactly as the real one does, making the convention a tested property rather than a comment |
| Payout arithmetic, including sub-wei dust | Fuzzed over 512 runs; the dust left behind is asserted exactly |
| An execution still in flight when `cancel()` lands | A real race, reproducible here on demand |

---

## Scope

Intentionally not included: an AMM, an order book, an order-matching engine, governance, a separate
ERC-20, a centralized resolver, or an upgrade proxy. Staking uses the chain's native asset and the
betting model is plain pari-mutuel: two running totals and one mapping per side.

## Reference

- Ritual Chain docs — <https://docs.ritualfoundation.org>
- dApp skills — <https://github.com/ritual-foundation/ritual-dapp-skills>
- Explorer — <https://explorer.ritualfoundation.org> · Faucet — <https://faucet.ritualfoundation.org>
