/**
 * RitualPredict against a local Hardhat node.
 *
 * RitualPredict hardcodes the canonical Ritual Chain addresses, none of which hold code
 * on a local node — even the constructor would revert. So the suite deploys the mocks
 * in contracts/mocks/RitualMocks.sol and copies their runtime code onto those exact
 * addresses with `hardhat_setCode`. The contract under test is byte-for-byte the one
 * that would be deployed to Ritual Chain: it still calls 0x0801, 0x0803, the Scheduler
 * and the RitualWallet, and it still cannot tell the difference.
 *
 * What that buys is every branch the testnet makes expensive or impossible to reach on
 * demand — a non-200 oracle, an executor that errors, a jq filter that silently matches
 * nothing, an unsettled async envelope, three consecutive failures — plus the payout
 * arithmetic, none of which needs a live chain.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { decodeAbiParameters, getAddress, parseEther, toHex } from "viem";

// Mirrors contracts/ritual/RitualChain.sol.
const RITUAL = {
  scheduler: "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B",
  ritualWallet: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
  teeRegistry: "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F",
  http: "0x0000000000000000000000000000000000000801",
  jq: "0x0000000000000000000000000000000000000803",
} as const;

const COMPARATOR = { GT: 0, GTE: 1, LT: 2, LTE: 3 } as const;
const STATE = { Open: 0, Closed: 1, Resolving: 2, Resolved: 3, Invalid: 4 } as const;
const OUTCOME = { Unresolved: 0, Yes: 1, No: 2 } as const;

/**
 * 1000 ms/block makes the arithmetic legible: `bettingSeconds` is the number of blocks
 * the window stays open. The contract's own minimums then put close at +30 and resolve
 * at +45 blocks, which a local node mines instantly.
 */
const BLOCK_TIME_MS = 1000n;
const BETTING_SECONDS = 30n;
const RESOLVE_DELAY_SECONDS = 15n;

const BODY = toHex('{"price":4200}');

describe("RitualPredict", async () => {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer, alice, bob, carol] = await viem.getWalletClients();

  /**
   * Put each mock's runtime code at the canonical address the contract will call.
   * Deploy-then-copy avoids hand-managing deployedBytecode, and the mocks hold no
   * constructor state, so nothing is lost in the move.
   */
  before(async () => {
    const testClient = await viem.getTestClient();
    const pairs = [
      ["MockScheduler", RITUAL.scheduler],
      ["MockRitualWallet", RITUAL.ritualWallet],
      ["MockTEERegistry", RITUAL.teeRegistry],
      ["MockHttpPrecompile", RITUAL.http],
      ["MockJqPrecompile", RITUAL.jq],
    ] as const;

    for (const [name, address] of pairs) {
      const deployed = await viem.deployContract(name);
      const code = await publicClient.getCode({ address: deployed.address });
      assert.ok(code, `${name} produced no runtime code`);
      await testClient.setCode({ address, bytecode: code });
    }
  });

  const scheduler = async () => viem.getContractAt("MockScheduler", RITUAL.scheduler);
  const registry = async () => viem.getContractAt("MockTEERegistry", RITUAL.teeRegistry);
  const http = async () => viem.getContractAt("MockHttpPrecompile", RITUAL.http);
  const jq = async () => viem.getContractAt("MockJqPrecompile", RITUAL.jq);

  /** A funded contract, a healthy executor, and an oracle answering 200 with 4200. */
  async function fresh() {
    const predict = await viem.deployContract("RitualPredict", [BLOCK_TIME_MS]);
    await predict.write.fundExecution([1_000_000n], { value: parseEther("1") });

    await (await registry()).write.setExecutor([alice.account.address, true]);
    await (await registry()).write.setDeriveFromSeed([false]);
    await (await http()).write.setRevert([false]);
    await (await http()).write.setHttpResponse([200, BODY, ""]);
    await (await jq()).write.setValue([4200n]);

    return predict;
  }

  type Predict = Awaited<ReturnType<typeof fresh>>;

  async function createMarket(
    predict: Predict,
    overrides: Partial<{
      question: string;
      oracleUrl: string;
      jsonPath: string;
      target: bigint;
      comparator: number;
      bettingSeconds: bigint;
      resolveDelaySeconds: bigint;
    }> = {},
  ) {
    await predict.write.createMarket([
      {
        question: "Will ETH/USD be at least $4,000 when this market resolves?",
        oracleUrl: "https://oracle.example/api/eth",
        jsonPath: ".price",
        target: 4000n,
        comparator: COMPARATOR.GTE,
        bettingSeconds: BETTING_SECONDS,
        resolveDelaySeconds: RESOLVE_DELAY_SECONDS,
        ...overrides,
      },
    ]);
    return predict.read.marketCount();
  }

  /** Mine past `resolveBlock` so the Scheduler callback is allowed to do its work. */
  async function mineToResolve(predict: Predict, marketId: bigint) {
    const market = await predict.read.getMarket([marketId]);
    const current = await publicClient.getBlockNumber();
    const target = BigInt(market.resolveBlock);
    if (target > current) await networkHelpers.mine(Number(target - current));
  }

  async function fire(predict: Predict, marketId: bigint, executionIndex = 0n) {
    const market = await predict.read.getMarket([marketId]);
    await (await scheduler()).write.fire([market.scheduleId, executionIndex]);
  }

  /** Drive a market all the way to a settled state. */
  async function settle(predict: Predict, marketId: bigint) {
    await mineToResolve(predict, marketId);
    await fire(predict, marketId);
    return predict.read.getMarket([marketId]);
  }

  // ───────────────────────────── createMarket ─────────────────────────────

  describe("createMarket", () => {
    it("books its own resolution with the Scheduler in the same transaction", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      const market = await predict.read.getMarket([marketId]);

      assert.notEqual(market.scheduleId, 0n);

      const call = await (await scheduler()).read.getCall([market.scheduleId]);
      assert.equal(getAddress(call.target), getAddress(predict.address));
      assert.equal(call.startBlock, Number(market.resolveBlock));
      assert.equal(call.numCalls, await predict.read.MAX_ATTEMPTS());
      assert.equal(call.frequency, await predict.read.RETRY_INTERVAL_BLOCKS());
      assert.equal(call.ttl, await predict.read.SCHEDULER_TTL_BLOCKS());
      assert.equal(call.gas, await predict.read.RESOLVE_GAS_LIMIT());
      // The contract pays for its own resolutions out of its RitualWallet balance.
      assert.equal(getAddress(call.payer), getAddress(predict.address));
      assert.equal(call.value, 0n);
    });

    it("encodes executionIndex as a 0 placeholder for the Scheduler to overwrite", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      const market = await predict.read.getMarket([marketId]);
      const call = await (await scheduler()).read.getCall([market.scheduleId]);

      // bytes 4-35, i.e. the first argument, must be zero at booking time.
      const firstArg = `0x${call.data.slice(10, 74)}`;
      assert.equal(BigInt(firstArg), 0n);
    });

    it("converts durations to block numbers using blockTimeMs", async () => {
      const predict = await fresh();
      const createdAt = await publicClient.getBlockNumber();
      const marketId = await createMarket(predict);
      const market = await predict.read.getMarket([marketId]);

      // createMarket itself mines one block, hence createdAt + 1.
      assert.equal(BigInt(market.closeBlock), createdAt + 1n + BETTING_SECONDS);
      assert.equal(
        BigInt(market.resolveBlock),
        createdAt + 1n + BETTING_SECONDS + RESOLVE_DELAY_SECONDS,
      );
    });

    it("records the resolution rule and emits it", async () => {
      const predict = await fresh();
      await viem.assertions.emitWithArgs(
        predict.write.createMarket([
          {
            question: "q",
            oracleUrl: "https://oracle.example/api/eth",
            jsonPath: ".price",
            target: 4000n,
            comparator: COMPARATOR.GTE,
            bettingSeconds: BETTING_SECONDS,
            resolveDelaySeconds: RESOLVE_DELAY_SECONDS,
          },
        ]),
        predict,
        "ResolutionRuleSet",
        [1n, "https://oracle.example/api/eth", ".price", 4000n, COMPARATOR.GTE],
      );
    });

    it("rejects an empty question, url or json path", async () => {
      const predict = await fresh();
      for (const field of ["question", "oracleUrl", "jsonPath"] as const) {
        await viem.assertions.revertWithCustomError(
          predict.write.createMarket([
            {
              question: "q",
              oracleUrl: "https://oracle.example/api/eth",
              jsonPath: ".price",
              target: 4000n,
              comparator: COMPARATOR.GTE,
              bettingSeconds: BETTING_SECONDS,
              resolveDelaySeconds: RESOLVE_DELAY_SECONDS,
              [field]: "",
            },
          ]),
          predict,
          "EmptyString",
        );
      }
    });

    it("rejects durations outside the allowed window", async () => {
      const predict = await fresh();
      const cases = [
        { bettingSeconds: 29n },
        { resolveDelaySeconds: 14n },
        { bettingSeconds: 86_400n, resolveDelaySeconds: 60n },
      ];
      for (const override of cases) {
        await viem.assertions.revertWithCustomError(
          predict.write.createMarket([
            {
              question: "q",
              oracleUrl: "https://oracle.example/api/eth",
              jsonPath: ".price",
              target: 4000n,
              comparator: COMPARATOR.GTE,
              bettingSeconds: BETTING_SECONDS,
              resolveDelaySeconds: RESOLVE_DELAY_SECONDS,
              ...override,
            },
          ]),
          predict,
          "BadDuration",
        );
      }
    });

    it("reverts for an unknown market id", async () => {
      const predict = await fresh();
      await viem.assertions.revertWithCustomError(
        predict.read.getMarket([99n]),
        predict,
        "UnknownMarket",
      );
    });
  });

  // ──────────────────────────────── betting ───────────────────────────────

  describe("bet", () => {
    let predict: Predict;
    let marketId: bigint;

    beforeEach(async () => {
      predict = await fresh();
      marketId = await createMarket(predict);
    });

    it("accumulates per-side pools and per-account stakes", async () => {
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await predict.write.bet([marketId, true], {
        value: parseEther("0.5"),
        account: alice.account,
      });
      await predict.write.bet([marketId, false], {
        value: parseEther("2"),
        account: bob.account,
      });

      const market = await predict.read.getMarket([marketId]);
      assert.equal(market.totalYes, parseEther("1.5"));
      assert.equal(market.totalNo, parseEther("2"));

      const [yes, no] = await predict.read.stakesOf([marketId, alice.account.address]);
      assert.equal(yes, parseEther("1.5"));
      assert.equal(no, 0n);
    });

    it("emits BetPlaced", async () => {
      await viem.assertions.emitWithArgs(
        predict.write.bet([marketId, true], {
          value: parseEther("1"),
          account: alice.account,
        }),
        predict,
        "BetPlaced",
        [marketId, getAddress(alice.account.address), true, parseEther("1")],
      );
    });

    it("rejects a zero stake", async () => {
      await viem.assertions.revertWithCustomError(
        predict.write.bet([marketId, true], { value: 0n, account: alice.account }),
        predict,
        "ZeroStake",
      );
    });

    it("rejects a bet at or after closeBlock", async () => {
      const market = await predict.read.getMarket([marketId]);
      const current = await publicClient.getBlockNumber();
      await networkHelpers.mine(Number(BigInt(market.closeBlock) - current));

      await viem.assertions.revertWithCustomError(
        predict.write.bet([marketId, true], {
          value: parseEther("1"),
          account: alice.account,
        }),
        predict,
        "BettingClosed",
      );
    });

    it("reports Closed from the view once closeBlock passes, with no transaction", async () => {
      assert.equal((await predict.read.getMarket([marketId])).state, STATE.Open);

      const market = await predict.read.getMarket([marketId]);
      const current = await publicClient.getBlockNumber();
      await networkHelpers.mine(Number(BigInt(market.closeBlock) - current));

      assert.equal((await predict.read.getMarket([marketId])).state, STATE.Closed);
    });
  });

  // ────────────────────────── the resolution callback ─────────────────────

  describe("onScheduledResolve", () => {
    it("rejects any caller that is not the Scheduler", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      await mineToResolve(predict, marketId);

      await viem.assertions.revertWithCustomError(
        predict.write.onScheduledResolve([0n, marketId], { account: alice.account }),
        predict,
        "OnlyScheduler",
      );
    });

    it("declines quietly when fired before resolveBlock", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);

      await fire(predict, marketId); // no mining: we are still inside the window

      const market = await predict.read.getMarket([marketId]);
      assert.equal(market.attempts, 0);
      assert.equal(market.state, STATE.Open);
    });

    it("resolves YES when the comparison holds", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await predict.write.bet([marketId, false], {
        value: parseEther("1"),
        account: bob.account,
      });

      const market = await settle(predict, marketId);
      assert.equal(market.state, STATE.Resolved);
      assert.equal(market.outcome, OUTCOME.Yes);
      assert.equal(market.observedValue, 4200n);
      assert.equal(market.attempts, 1);
    });

    it("resolves NO when the comparison fails", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict, { target: 5000n });
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await predict.write.bet([marketId, false], {
        value: parseEther("1"),
        account: bob.account,
      });

      const market = await settle(predict, marketId);
      assert.equal(market.state, STATE.Resolved);
      assert.equal(market.outcome, OUTCOME.No);
      assert.equal(market.observedValue, 4200n);
    });

    it("applies every comparator", async () => {
      const cases = [
        { comparator: COMPARATOR.GT, target: 4199n, expected: OUTCOME.Yes },
        { comparator: COMPARATOR.GT, target: 4200n, expected: OUTCOME.No },
        { comparator: COMPARATOR.GTE, target: 4200n, expected: OUTCOME.Yes },
        { comparator: COMPARATOR.GTE, target: 4201n, expected: OUTCOME.No },
        { comparator: COMPARATOR.LT, target: 4201n, expected: OUTCOME.Yes },
        { comparator: COMPARATOR.LT, target: 4200n, expected: OUTCOME.No },
        { comparator: COMPARATOR.LTE, target: 4200n, expected: OUTCOME.Yes },
        { comparator: COMPARATOR.LTE, target: 4199n, expected: OUTCOME.No },
      ];

      for (const { comparator, target, expected } of cases) {
        const predict = await fresh();
        const marketId = await createMarket(predict, { comparator, target });
        // Back both sides so the outcome is a real resolution, not an empty-side refund.
        await predict.write.bet([marketId, true], {
          value: parseEther("1"),
          account: alice.account,
        });
        await predict.write.bet([marketId, false], {
          value: parseEther("1"),
          account: bob.account,
        });

        const market = await settle(predict, marketId);
        assert.equal(
          market.outcome,
          expected,
          `comparator ${comparator} vs target ${target}`,
        );
      }
    });

    it("sends the oracle a well-formed 13-field HTTP GET", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict, {
        oracleUrl: "https://oracle.example/api/eth",
      });
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await settle(predict, marketId);

      const request = await (await http()).read.lastRequest();
      const decoded = decodeAbiParameters(
        [
          { type: "address" }, //  0 executor
          { type: "bytes[]" }, //  1 encryptedSecrets
          { type: "uint256" }, //  2 ttl
          { type: "bytes[]" }, //  3 secretSignatures
          { type: "bytes" }, //  4 userPublicKey
          { type: "string" }, //  5 url
          { type: "uint8" }, //  6 method
          { type: "string[]" }, //  7 headerKeys
          { type: "string[]" }, //  8 headerValues
          { type: "bytes" }, //  9 body
          { type: "uint256" }, // 10 dkmsKeyIndex
          { type: "uint8" }, // 11 dkmsKeyFormat
          { type: "bool" }, // 12 piiEnabled
        ],
        request,
      );

      assert.equal(getAddress(decoded[0]), getAddress(alice.account.address));
      assert.equal(decoded[2], await predict.read.HTTP_TTL_BLOCKS());
      assert.equal(decoded[5], "https://oracle.example/api/eth");
      assert.equal(decoded[6], 1); // GET
      assert.equal(decoded[12], false);
    });

    it("re-rolls the executor seed on every attempt", async () => {
      const predict = await fresh();
      await (await registry()).write.setDeriveFromSeed([true]);
      await (await http()).write.setHttpResponse([500, BODY, ""]); // force retries

      const marketId = await createMarket(predict);
      await mineToResolve(predict, marketId);

      const from = await publicClient.getBlockNumber();
      await fire(predict, marketId, 0n);
      await fire(predict, marketId, 1n);

      const events = await publicClient.getContractEvents({
        address: predict.address,
        abi: predict.abi,
        eventName: "ResolutionAttempted",
        fromBlock: from,
        strict: true,
      });

      assert.equal(events.length, 2);
      assert.notEqual(events[0].args.executor, events[1].args.executor);
    });

    it("is idempotent once the market has settled", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });

      const settled = await settle(predict, marketId);
      // Resolution cancels the remaining executions, but one already in flight can
      // still land. It must not touch a settled market.
      await (await scheduler()).write.fireIgnoringCancellation([settled.scheduleId, 1n]);

      const market = await predict.read.getMarket([marketId]);
      assert.equal(market.state, STATE.Resolved);
      assert.equal(market.attempts, 1);
    });

    it("hands the unused executions back to the Scheduler on success", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });

      const market = await settle(predict, marketId);
      // 3 = CANCELLED
      assert.equal(await (await scheduler()).read.getCallState([market.scheduleId]), 3);
    });
  });

  // ─────────────────────────── failure handling ───────────────────────────

  describe("failed oracle reads", () => {
    /** Each of these must be a *failure*, never a NO. */
    const failures: Array<[string, (m: Awaited<ReturnType<typeof fresh>>) => Promise<void>, string]> =
      [
        [
          "no executor is available",
          async () => {
            await (await registry()).write.setExecutor([alice.account.address, false]);
          },
          "no http executor available",
        ],
        [
          "the precompile call itself reverts",
          async () => {
            await (await http()).write.setRevert([true]);
          },
          "http precompile call failed",
        ],
        [
          "the oracle answers with a non-200 status",
          async () => {
            await (await http()).write.setHttpResponse([500, BODY, ""]);
          },
          "http status not 200",
        ],
        [
          "the executor reports an error",
          async () => {
            await (await http()).write.setHttpResponse([200, BODY, "dns failure"]);
          },
          "dns failure",
        ],
        [
          "the async output has not settled",
          async () => {
            await (await http()).write.setUnsettled();
          },
          "async output not settled",
        ],
        [
          "the envelope is undecodable",
          async () => {
            await (await http()).write.setRawResponse(["0xdeadbeef"]);
          },
          "malformed http response",
        ],
        [
          "the jq filter matches nothing",
          async () => {
            await (await jq()).write.setEmpty();
          },
          "jq extraction failed",
        ],
      ];

    for (const [label, arrange, reason] of failures) {
      it(`treats "${label}" as a failure, not a NO`, async () => {
        const predict = await fresh();
        await arrange(predict);

        const marketId = await createMarket(predict);
        await predict.write.bet([marketId, false], {
          value: parseEther("1"),
          account: bob.account,
        });
        await mineToResolve(predict, marketId);

        const from = await publicClient.getBlockNumber();
        await fire(predict, marketId);

        const events = await publicClient.getContractEvents({
          address: predict.address,
          abi: predict.abi,
          eventName: "ResolutionFailed",
          fromBlock: from,
          strict: true,
        });
        assert.equal(events.length, 1);
        assert.equal(events[0].args.reason, reason);

        const market = await predict.read.getMarket([marketId]);
        assert.equal(market.state, STATE.Resolving);
        assert.equal(market.outcome, OUTCOME.Unresolved, "a failed read must not become NO");
        assert.equal(market.attempts, 1);
      });
    }

    it("becomes Invalid and refundable after all attempts fail", async () => {
      const predict = await fresh();
      await (await http()).write.setHttpResponse([503, BODY, ""]);

      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await predict.write.bet([marketId, false], {
        value: parseEther("2"),
        account: bob.account,
      });
      await mineToResolve(predict, marketId);

      const maxAttempts = await predict.read.MAX_ATTEMPTS();
      for (let i = 0; i < maxAttempts; i++) {
        await fire(predict, marketId, BigInt(i));
      }

      const market = await predict.read.getMarket([marketId]);
      assert.equal(market.state, STATE.Invalid);
      assert.equal(market.attempts, maxAttempts);
      assert.equal(market.invalidReason, "http status not 200");

      // Both sides get their stake back, whichever side they picked.
      await viem.assertions.balancesHaveChanged(
        predict.write.claimRefund([marketId], { account: alice.account }),
        [{ address: alice.account.address, amount: parseEther("1") }],
      );
      await viem.assertions.balancesHaveChanged(
        predict.write.claimRefund([marketId], { account: bob.account }),
        [{ address: bob.account.address, amount: parseEther("2") }],
      );
    });

    it("recovers if a later attempt succeeds", async () => {
      const predict = await fresh();
      await (await http()).write.setHttpResponse([500, BODY, ""]);

      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await mineToResolve(predict, marketId);

      await fire(predict, marketId, 0n);
      assert.equal((await predict.read.getMarket([marketId])).state, STATE.Resolving);

      await (await http()).write.setHttpResponse([200, BODY, ""]);
      await fire(predict, marketId, 1n);

      const market = await predict.read.getMarket([marketId]);
      assert.equal(market.state, STATE.Resolved);
      assert.equal(market.outcome, OUTCOME.Yes);
      assert.equal(market.attempts, 2);
    });

    it("refunds everyone when the winning side is empty", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      // Observed 4200 >= 4000 resolves YES, but only NO was backed.
      await predict.write.bet([marketId, false], {
        value: parseEther("3"),
        account: bob.account,
      });

      const market = await settle(predict, marketId);
      assert.equal(market.state, STATE.Invalid);
      assert.equal(market.outcome, OUTCOME.Yes, "the outcome is still recorded");
      assert.equal(market.observedValue, 4200n);
      assert.equal(market.invalidReason, "winning side empty");

      await viem.assertions.balancesHaveChanged(
        predict.write.claimRefund([marketId], { account: bob.account }),
        [{ address: bob.account.address, amount: parseEther("3") }],
      );
    });
  });

  // ────────────────────────────── payouts ─────────────────────────────────

  describe("payouts", () => {
    let predict: Predict;
    let marketId: bigint;

    beforeEach(async () => {
      predict = await fresh();
      marketId = await createMarket(predict);
      // YES: alice 1, carol 3.  NO: bob 4.  Pool 8, winning pool 4.
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await predict.write.bet([marketId, true], {
        value: parseEther("3"),
        account: carol.account,
      });
      await predict.write.bet([marketId, false], {
        value: parseEther("4"),
        account: bob.account,
      });
    });

    it("pays stake * totalPool / winningPool", async () => {
      await settle(predict, marketId);

      // alice: 1 * 8 / 4 = 2.   carol: 3 * 8 / 4 = 6.
      await viem.assertions.balancesHaveChanged(
        predict.write.claimWinnings([marketId], { account: alice.account }),
        [{ address: alice.account.address, amount: parseEther("2") }],
      );
      await viem.assertions.balancesHaveChanged(
        predict.write.claimWinnings([marketId], { account: carol.account }),
        [{ address: carol.account.address, amount: parseEther("6") }],
      );
    });

    it("reports the claimable amount before the claim", async () => {
      await settle(predict, marketId);

      const [, , alreadySettled, claimable] = await predict.read.stakesOf([
        marketId,
        alice.account.address,
      ]);
      assert.equal(alreadySettled, false);
      assert.equal(claimable, parseEther("2"));

      await predict.write.claimWinnings([marketId], { account: alice.account });
      const [, , settledAfter, claimableAfter] = await predict.read.stakesOf([
        marketId,
        alice.account.address,
      ]);
      assert.equal(settledAfter, true);
      assert.equal(claimableAfter, 0n);
    });

    it("distributes the whole pool and leaves only dust", async () => {
      await settle(predict, marketId);
      await predict.write.claimWinnings([marketId], { account: alice.account });
      await predict.write.claimWinnings([marketId], { account: carol.account });

      const left = await publicClient.getBalance({ address: predict.address });
      assert.ok(left < 10n, `expected dust, found ${left} wei`);
    });

    it("gives the losing side nothing", async () => {
      await settle(predict, marketId);
      await viem.assertions.revertWithCustomError(
        predict.write.claimWinnings([marketId], { account: bob.account }),
        predict,
        "NothingToClaim",
      );
    });

    it("refuses a second claim", async () => {
      await settle(predict, marketId);
      await predict.write.claimWinnings([marketId], { account: alice.account });
      await viem.assertions.revertWithCustomError(
        predict.write.claimWinnings([marketId], { account: alice.account }),
        predict,
        "AlreadySettled",
      );
    });

    it("refuses a claim before the market resolves", async () => {
      await viem.assertions.revertWithCustomError(
        predict.write.claimWinnings([marketId], { account: alice.account }),
        predict,
        "NotResolved",
      );
    });

    it("refuses a refund on a resolved market", async () => {
      await settle(predict, marketId);
      await viem.assertions.revertWithCustomError(
        predict.write.claimRefund([marketId], { account: alice.account }),
        predict,
        "NotInvalid",
      );
    });
  });

  // ─────────────────────────── execution funding ──────────────────────────

  describe("execution funding", () => {
    it("prepays the RitualWallet balance the Scheduler draws on", async () => {
      const predict = await viem.deployContract("RitualPredict", [BLOCK_TIME_MS]);
      assert.equal(await predict.read.executionBalance(), 0n);

      await predict.write.fundExecution([1_000n], { value: parseEther("0.5") });
      assert.equal(await predict.read.executionBalance(), parseEther("0.5"));
    });

    it("rejects a zero deposit", async () => {
      const predict = await fresh();
      await viem.assertions.revertWithCustomError(
        predict.write.fundExecution([1_000n], { value: 0n }),
        predict,
        "ZeroStake",
      );
    });
  });

  // ─────────────────────────────── edge cases ────────────────────────────

  describe("edge cases", () => {
    it("refuses a zero block time at deployment", async () => {
      const predict = await fresh();
      await viem.assertions.revertWithCustomError(
        viem.deployContract("RitualPredict", [0n]),
        predict,
        "BadDuration",
      );
    });

    it("clamps a sub-block duration to one block", async () => {
      // A chain slower than the requested window: 30s of betting is less than one
      // 60s block, and a zero-block window would close betting before it opened.
      const predict = await viem.deployContract("RitualPredict", [60_000n]);
      const createdAt = await publicClient.getBlockNumber();
      const marketId = await createMarket(predict);
      const market = await predict.read.getMarket([marketId]);

      assert.equal(BigInt(market.closeBlock), createdAt + 2n);
      assert.equal(BigInt(market.resolveBlock), createdAt + 3n);
    });

    it("keeps the schedule booked when the last attempt is the one that works", async () => {
      const predict = await fresh();
      await (await http()).write.setHttpResponse([500, BODY, ""]);

      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, true], {
        value: parseEther("1"),
        account: alice.account,
      });
      await mineToResolve(predict, marketId);

      await fire(predict, marketId, 0n);
      await fire(predict, marketId, 1n);
      await (await http()).write.setHttpResponse([200, BODY, ""]);
      await fire(predict, marketId, 2n);

      const market = await predict.read.getMarket([marketId]);
      assert.equal(market.state, STATE.Resolved);
      assert.equal(market.attempts, 3);
      // Nothing was left to cancel, so the call reads COMPLETED rather than CANCELLED.
      assert.equal(await (await scheduler()).read.getCallState([market.scheduleId]), 2);
    });

    it("reports the refundable amount on an invalid market", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, false], {
        value: parseEther("2"),
        account: bob.account,
      });
      await settle(predict, marketId); // YES wins, nobody backed YES

      const [, , , claimable] = await predict.read.stakesOf([
        marketId,
        bob.account.address,
      ]);
      assert.equal(claimable, parseEther("2"));
    });

    it("refuses a second refund, and a refund to someone who never bet", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);
      await predict.write.bet([marketId, false], {
        value: parseEther("2"),
        account: bob.account,
      });
      await settle(predict, marketId);

      await predict.write.claimRefund([marketId], { account: bob.account });
      await viem.assertions.revertWithCustomError(
        predict.write.claimRefund([marketId], { account: bob.account }),
        predict,
        "AlreadySettled",
      );
      await viem.assertions.revertWithCustomError(
        predict.write.claimRefund([marketId], { account: carol.account }),
        predict,
        "NothingToClaim",
      );
    });

    it("surfaces a failed payout instead of marking the claim settled", async () => {
      const predict = await fresh();
      const marketId = await createMarket(predict);

      const rejector = await viem.deployContract("RejectingReceiver");
      await rejector.write.bet([predict.address, marketId, true], {
        value: parseEther("1"),
      });
      await predict.write.bet([marketId, false], {
        value: parseEther("1"),
        account: bob.account,
      });
      await settle(predict, marketId);

      await viem.assertions.revertWithCustomError(
        rejector.write.claim([predict.address, marketId]),
        predict,
        "TransferFailed",
      );
    });
  });

  // ──────────────────────────────── views ─────────────────────────────────

  describe("getMarkets", () => {
    it("returns every market, newest first", async () => {
      const predict = await fresh();
      await createMarket(predict, { question: "first" });
      await createMarket(predict, { question: "second" });
      await createMarket(predict, { question: "third" });

      const all = await predict.read.getMarkets();
      assert.deepEqual(
        all.map((m) => m.question),
        ["third", "second", "first"],
      );
      assert.deepEqual(
        all.map((m) => m.id),
        [3n, 2n, 1n],
      );
    });
  });
});
