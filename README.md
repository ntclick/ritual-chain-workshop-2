# Ritual Predict

A self-resolving binary prediction market on [Ritual Chain](https://docs.ritualfoundation.org).

Create a market like _"Will ETH/USD be at least $4,000 when this market resolves?"_, stake native
RITUAL on YES or NO, and watch it settle itself. When the betting window closes, **nobody presses a
resolve button and no backend cron job runs**. The Ritual Scheduler wakes the contract at a block
fixed when the market was created; the contract calls the HTTP precompile to read the configured
oracle URL, extracts one number with the jq precompile, compares it to the target, and settles.
Winners then pull their proportional share of the pool.

**Live: <https://ritualpredict.vercel.app>**

The deployed board shows **sample markets, not chain data** — there is nowhere public to read
from while Ritual's testnet is down, and the working contract lives on a local node. It is
labelled as such in the app, and betting is disabled there. To see it settle real markets, run
[the stack locally](#the-frontend); the site switches to live data the moment it is pointed at a
reachable deployment.

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

## What this fork adds

Everything below sits on top of `cozfuttu/ritual-chain-workshop-2@6e93b08`, in five pieces.

| | |
|---|---|
| **The contract runs** | The five stubbed functions are implemented |
| **The starter's own workflow works** | `.env` was never read; `hardhat test` failed on a dead test |
| **It is tested** | 94 tests, 98.32% line coverage, no testnet needed |
| **The contract is extended** | A stuck market can be freed; scheduled executions no longer book a zero tip |
| **There is a frontend** | Landing page and market board, plus the scripts to drive them locally |

### 1. The contract was not actually written

The announcement said *"the contract is already written, so this isn't fill-in-the-blanks."*
It is not: `RitualPredict.sol` at upstream `6e93b08` has five function bodies replaced by
`// we'll fill this up` — `createMarket`, `onScheduledResolve`, `_readOracle`,
`_pickExecutor` and `_scheduleResolution`. Between them they are the whole product:
nothing can be created, nothing resolves, no oracle is ever read.

They are implemented here against the behaviour the README documents — the 13-field HTTP
request, the `0` calldata placeholder the Scheduler overwrites, the per-attempt executor
re-roll, and the rule that a failed read is a failure and never a NO.

### 2. Three config bugs that broke the documented setup

- `.env.example` defines `RITUAL_PRIVATE_KEY`; `hardhat.config.ts` asked for
  `DEPLOYER_PRIVATE_KEY`. Following the README left the deployer unset.
- `.env.example` claims the file is *"loaded automatically by hardhat.config.ts"*. It was
  not: Hardhat 3 reads only `process.env` and the project has no dotenv dependency, so
  `.env` was never read at all. Fixed with Node 22's built-in loader, no new package.
- `RITUAL_RPC_URL` was documented as an override but the URL was hardcoded.
- `test/Counter.ts` tested a `Counter` contract that does not exist in this repo, so
  `npx hardhat test` failed on a clean checkout.

### 3. A test suite that needs no chain

`RitualPredict` hardcodes the canonical Ritual addresses, and none of them hold code on a
local node — the constructor alone reverts. `contracts/mocks/RitualMocks.sol` provides
doubles for the Scheduler, RitualWallet, TEEServiceRegistry and the `0x0801` / `0x0803`
precompiles, and both suites copy their runtime code onto those exact addresses
(`vm.etch` in Solidity, `hardhat_setCode` in TypeScript). **The contract under test is
never modified.**

The precompile doubles answer from `fallback()` and return raw bytes with assembly. A
named Solidity function would have ABI-encoded the return value a second time and the
consumer would decode garbage — the single most common way a precompile mock goes wrong.

The Scheduler double reproduces the one behaviour the contract depends on: it overwrites
calldata bytes 4-35 with the real execution index, which makes the `0` placeholder
convention a tested property rather than a comment.

### 4. Two contract extensions

Both are about failures the original has no answer for, and both are written up in full
further down: `expireStuck` frees a market whose scheduled executions never arrived and
whose stakes are otherwise unreachable, and scheduled executions no longer book a
priority fee of zero on a chain that drops such transactions silently. A swallowed
`cancel()` failure now emits `ScheduleCancelFailed` instead of leaking prepaid fees with
nothing on chain to explain it.

### 5. A frontend, and the scripts to drive it

`web/` is described under [The frontend](#the-frontend). Alongside it,
`scripts/local-demo.ts`, `local-bet.ts`, `local-resolve.ts` and `local-claim.ts` take a
market from creation through betting, settlement and payout on a local node — including
the retry-to-`Invalid` path — so the whole lifecycle can be shown without a testnet.

---

### A market the Scheduler never wakes traps its stakes forever

Every path to `Invalid` runs *inside* `onScheduledResolve`. If the callback never fires,
the market cannot reach `Invalid` at all: `attempts` stays at 0, `claimWinnings` reverts
`NotResolved`, `claimRefund` reverts `NotInvalid`, and the pool sits in the contract with
no way out.

That is not a hypothetical. The repo's own `scripts/fund.ts` documents the mechanism:
scheduled executions are **skipped**, not cancelled, when the payer's RitualWallet
balance is short. A market created against an empty execution balance books three
executions that silently never run, and the booking is only alive for
`resolveBlock + 2 × 200 + TTL` blocks. After that nothing will ever fire again.

`expireStuck(marketId)` is the way out. It is permissionless — whoever is owed money
should not need anyone's approval to unstick their own stake — and it only ever turns a
market nobody can settle into one everybody can refund from. `expiryBlock(marketId)`
exposes the deadline, which clears the last booked retry, the Scheduler's TTL, and a
grace margin, so a market that was about to resolve is never expired out from under a
real result.

The frontend surfaces this: an unsettled market past its deadline shows the reason and an
**Expire market and open refunds** button.

### Scheduled executions were booked with a zero tip

Ritual Chain drops transactions under 1 gwei of priority fee *silently* — no error, no
receipt, no nonce consumed. `_scheduleResolution` floored `maxFeePerGas` at 1 gwei but
passed `0` for the tip, so a booked resolution could simply evaporate with nothing to
debug. The tip is now floored too, and `maxFeePerGas` covers it.

A failed `cancel()` used to be swallowed by a bare `catch {}`, which leaks the prepaid
fees for the unused executions with nothing on chain to explain it. It now emits
`ScheduleCancelFailed`.

---

## The frontend

`web/` is a Next.js app that talks to the contract directly with viem — market list with
live pool splits and pari-mutuel odds, betting, claiming, market creation, and the
resolution diagnostics (attempt count, observed value, why a market went `Invalid`). It
also serves the demo oracle at `/api/oracle/eth`. See [web/README.md](web/README.md).

Deployed at <https://ritualpredict.vercel.app>. It opens on the local Hardhat node rather
than Ritual Chain — pointing visitors at an RPC that answers nothing helps nobody, whereas
anyone running the stack can drive their own node from the deployed page. Whether a browser
permits an `https://` origin to reach `127.0.0.1` is untested and may well be refused; if it
is, the board falls back to clearly-labelled sample markets rather than an error.

The whole thing runs without a testnet:

```bash
cd hardhat
npx hardhat node                                              # terminal 1
npx hardhat run scripts/local-demo.ts --network localhost     # terminal 2 — prints the address
cd ../web && pnpm dev                                         # terminal 3
```

`local-demo.ts` puts the mock system contracts at the canonical Ritual addresses, so the
unmodified `RitualPredict` runs on a local node. It also turns on interval mining at
`blockTimeMs`: a local node otherwise mines only when a transaction arrives, so the chain
would sit at one height, `closeBlock` would never pass, and a market would stay `Open`
however long you waited. With it, betting closes on its own and the countdowns in the UI
track real block progress.

Resolution is the half that still needs a hand here — a local node has no Scheduler, so
nothing wakes the contract. `local-bet.ts`, `local-resolve.ts` and `local-claim.ts` drive
a market through betting, settlement and payout, and `STATUS=503` on the resolve step
walks the retry-to-`Invalid` path instead. Every field of the market is overridable
(`QUESTION`, `JSON_PATH`, `TARGET`, `COMPARATOR`, `OBSERVED`), so you can pose a real
question against a real target without editing the script.

---

## Verifying it without the chain

The testnet was unreachable while this fork was built, so the whole contract is
exercised on a local Hardhat node instead — not as a substitute for a live run, but
because it reaches branches a live run cannot produce on demand.

```bash
cd hardhat
pnpm test         # 42 Solidity + 52 TypeScript tests
pnpm coverage     # 98.32% line coverage on RitualPredict.sol
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

## What is proven, and what is not

Ritual's testnet was unreachable throughout — its RPC accepts the connection and then
never answers — so it is worth being exact about which claims here are backed by a run.

**Run end to end on a local node**, across seven markets on one deployment:

- A market resolving `YES` from a live oracle read, and winners paid
  `stake × totalPool ÷ winningPool` — a 2 RITUAL stake into an 8 RITUAL pool with a
  2 RITUAL winning side returned 8
- A market failing three times and falling to `Invalid`, with every stake refunded. The
  outcome stayed `Unresolved` through all three attempts: **a failed read was never
  turned into a NO**
- A market whose Scheduler callback never arrived at all, freed with `expireStuck` and
  refunded in full — money that was otherwise unreachable by either claim path
- A market resolving `YES` where nobody had backed YES, correctly becoming refundable
  rather than paying out of an empty pool
- Betting closing by itself once `closeBlock` passed, with the UI's countdown tracking
  real block progress
- Accounting closing exactly: 14 RITUAL staked, 14 paid out, contract balance back to 0
- A bet placed and signed through MetaMask against the deployed contract

**Not proven, and not claimed:**

- **No deployment to Ritual Chain.** Nothing here has run against the real Scheduler,
  the real TEE registry, or the real `0x0801` / `0x0803`. The precompiles are exercised
  through doubles, which prove the contract's own logic and calling convention — not that
  the chain answers the way its documentation says.
- **No real oracle fetch.** The HTTP double returns a canned body regardless of the URL,
  so the market templates' jq filters were checked against the live APIs by hand
  (CoinGecko returns `{"ethereum":{"usd":1917.9}}`, blockchain.info returns a bare
  integer, the repo has 54 stars) but never through a TEE.
- **The zero-tip fix is reasoning, not measurement.** Ritual drops transactions under
  1 gwei of priority fee silently; scheduled executions were booking a tip of `0`. Whether
  a Scheduler-fired system transaction is subject to that mempool floor at all could not
  be tested with the chain down.
- **The deployed site is not a live deployment.** <https://ritualpredict.vercel.app> serves
  the app itself, and the oracle route on it returns a real CoinGecko price, but the market
  board there is sample data. No contract is reachable from it.
- **Local resolution is manual.** `local-demo.ts` mines on a timer so deadlines arrive,
  but a local node has no Scheduler, so `local-resolve.ts` stands in for it. Only the
  closing half of the lifecycle is autonomous here.

## Scope

Intentionally not included: an AMM, an order book, an order-matching engine, governance, a separate
ERC-20, a centralized resolver, or an upgrade proxy. Staking uses the chain's native asset and the
betting model is plain pari-mutuel: two running totals and one mapping per side.

Markets are resolved by an oracle rule fixed at creation, never by a vote or an admin. A
human resolver would make the Scheduler, the TEE and both precompiles pointless — the
whole exercise is settling without one. Users choose the question, the source, the filter
and the target; nobody chooses the answer.

## Reference

- Ritual Chain docs — <https://docs.ritualfoundation.org>
- dApp skills — <https://github.com/ritual-foundation/ritual-dapp-skills>
- Explorer — <https://explorer.ritualfoundation.org> · Faucet — <https://faucet.ritualfoundation.org>
