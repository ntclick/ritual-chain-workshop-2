// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {RitualPredict} from "./RitualPredict.sol";
import {RitualChain} from "./ritual/RitualChain.sol";
import {
    MockHttpPrecompile,
    MockJqPrecompile,
    MockRitualWallet,
    MockScheduler,
    MockTEERegistry
} from "./mocks/RitualMocks.sol";

/**
 * Unit tests for RitualPredict, run inside the EVM.
 *
 * RitualPredict calls the canonical Ritual Chain addresses, which hold no code on a
 * local node, so `setUp` etches the mock runtime code onto each of them. The contract
 * under test is untouched: it still calls 0x0801, 0x0803, the Scheduler and the
 * RitualWallet exactly as it would on chain.
 *
 * The TypeScript suite in test/RitualPredict.e2e.ts covers the same contract from the
 * outside, where balance changes and event streams are easier to assert. This layer
 * covers the branch-level behaviour and the payout arithmetic, including fuzzing.
 */
contract RitualPredictTest is Test {
    RitualPredict internal predict;

    MockScheduler internal scheduler = MockScheduler(RitualChain.SCHEDULER);
    MockTEERegistry internal registry = MockTEERegistry(RitualChain.TEE_SERVICE_REGISTRY);
    MockHttpPrecompile internal http = MockHttpPrecompile(payable(RitualChain.HTTP_PRECOMPILE));
    MockJqPrecompile internal jq = MockJqPrecompile(payable(RitualChain.JQ_PRECOMPILE));

    /// 1000 ms/block: `bettingSeconds` is simply the number of blocks the window lasts.
    uint256 internal constant BLOCK_TIME_MS = 1000;
    uint256 internal constant BETTING_SECONDS = 30;
    uint256 internal constant RESOLVE_DELAY_SECONDS = 15;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal executor = makeAddr("executor");

    bytes internal constant BODY = bytes('{"price":4200}');

    function setUp() public {
        // _pickExecutor reads blockhash(block.number - 1).
        vm.roll(1_000);

        vm.etch(RitualChain.SCHEDULER, address(new MockScheduler()).code);
        vm.etch(RitualChain.RITUAL_WALLET, address(new MockRitualWallet()).code);
        vm.etch(RitualChain.TEE_SERVICE_REGISTRY, address(new MockTEERegistry()).code);
        vm.etch(RitualChain.HTTP_PRECOMPILE, address(new MockHttpPrecompile()).code);
        vm.etch(RitualChain.JQ_PRECOMPILE, address(new MockJqPrecompile()).code);

        registry.setExecutor(executor, true);
        http.setHttpResponse(200, BODY, "");
        jq.setValue(4200);

        predict = new RitualPredict(BLOCK_TIME_MS);
        vm.deal(address(this), 1_000 ether);
        predict.fundExecution{value: 1 ether}(1_000_000);
    }

    // ────────────────────────────── helpers ──────────────────────────────

    function _newMarket() internal returns (uint256) {
        return _newMarket(4000, RitualPredict.Comparator.GTE);
    }

    function _newMarket(uint256 target, RitualPredict.Comparator comparator)
        internal
        returns (uint256)
    {
        return predict.createMarket(
            RitualPredict.NewMarket({
                question: "Will ETH/USD be at least $4,000 when this market resolves?",
                oracleUrl: "https://oracle.example/api/eth",
                jsonPath: ".price",
                target: target,
                comparator: comparator,
                bettingSeconds: BETTING_SECONDS,
                resolveDelaySeconds: RESOLVE_DELAY_SECONDS
            })
        );
    }

    function _bet(uint256 marketId, address who, bool isYes, uint256 amount) internal {
        vm.deal(who, amount);
        vm.prank(who);
        predict.bet{value: amount}(marketId, isYes);
    }

    function _rollToResolve(uint256 marketId) internal {
        vm.roll(predict.getMarket(marketId).resolveBlock);
    }

    function _fire(uint256 marketId, uint256 executionIndex) internal {
        scheduler.fire(predict.getMarket(marketId).scheduleId, executionIndex);
    }

    function _settle(uint256 marketId) internal {
        _rollToResolve(marketId);
        _fire(marketId, 0);
    }

    // ──────────────────────────── createMarket ───────────────────────────

    function test_CreateMarketBooksItsOwnResolution() public {
        uint256 marketId = _newMarket();
        RitualPredict.Market memory m = predict.getMarket(marketId);

        MockScheduler.Call memory call = scheduler.getCall(m.scheduleId);
        assertEq(call.target, address(predict), "callback target");
        assertEq(call.payer, address(predict), "the contract pays for itself");
        assertEq(call.startBlock, m.resolveBlock, "first attempt at resolveBlock");
        assertEq(call.numCalls, predict.MAX_ATTEMPTS());
        assertEq(call.frequency, predict.RETRY_INTERVAL_BLOCKS());
        assertEq(call.ttl, predict.SCHEDULER_TTL_BLOCKS());
        assertEq(call.gas, predict.RESOLVE_GAS_LIMIT());
    }

    function test_CreateMarketConvertsSecondsToBlocks() public {
        uint256 start = block.number;
        uint256 marketId = _newMarket();
        RitualPredict.Market memory m = predict.getMarket(marketId);

        assertEq(m.closeBlock, start + BETTING_SECONDS);
        assertEq(m.resolveBlock, start + BETTING_SECONDS + RESOLVE_DELAY_SECONDS);
    }

    function test_CreateMarketRejectsEmptyStrings() public {
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(
            RitualPredict.NewMarket({
                question: "",
                oracleUrl: "https://oracle.example/api/eth",
                jsonPath: ".price",
                target: 4000,
                comparator: RitualPredict.Comparator.GTE,
                bettingSeconds: BETTING_SECONDS,
                resolveDelaySeconds: RESOLVE_DELAY_SECONDS
            })
        );
    }

    function test_CreateMarketRejectsShortBettingWindow() public {
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(
            RitualPredict.NewMarket({
                question: "q",
                oracleUrl: "https://oracle.example/api/eth",
                jsonPath: ".price",
                target: 4000,
                comparator: RitualPredict.Comparator.GTE,
                bettingSeconds: 29,
                resolveDelaySeconds: RESOLVE_DELAY_SECONDS
            })
        );
    }

    function test_ResolutionParametersHaveNoSetter() public {
        uint256 marketId = _newMarket();
        RitualPredict.Market memory before_ = predict.getMarket(marketId);

        _bet(marketId, alice, true, 1 ether);
        _settle(marketId);

        RitualPredict.Market memory after_ = predict.getMarket(marketId);
        assertEq(after_.target, before_.target);
        assertEq(uint8(after_.comparator), uint8(before_.comparator));
        assertEq(after_.oracleUrl, before_.oracleUrl);
        assertEq(after_.jsonPath, before_.jsonPath);
        assertEq(after_.resolveBlock, before_.resolveBlock);
    }

    // ────────────────────────────── betting ──────────────────────────────

    function test_BetPoolsPerSide() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 2 ether);
        _bet(marketId, alice, true, 0.5 ether);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(m.totalYes, 1.5 ether);
        assertEq(m.totalNo, 2 ether);
        assertEq(predict.yesStake(marketId, alice), 1.5 ether);
    }

    function test_BetRejectsZeroStake() public {
        uint256 marketId = _newMarket();
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.bet{value: 0}(marketId, true);
    }

    function test_BetClosesAtCloseBlock() public {
        uint256 marketId = _newMarket();
        vm.roll(predict.getMarket(marketId).closeBlock);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RitualPredict.BettingClosed.selector);
        predict.bet{value: 1 ether}(marketId, true);
    }

    function test_ViewReportsClosedWithoutATransaction() public {
        uint256 marketId = _newMarket();
        assertEq(uint8(predict.getMarket(marketId).state), uint8(RitualPredict.MarketState.Open));

        vm.roll(predict.getMarket(marketId).closeBlock);
        assertEq(uint8(predict.getMarket(marketId).state), uint8(RitualPredict.MarketState.Closed));
    }

    // ───────────────────────────── resolution ────────────────────────────

    function test_OnlySchedulerMayResolve() public {
        uint256 marketId = _newMarket();
        _rollToResolve(marketId);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.OnlyScheduler.selector);
        predict.onScheduledResolve(0, marketId);
    }

    function test_ResolvesYes() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 1 ether);
        _settle(marketId);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes));
        assertEq(m.observedValue, 4200);
    }

    function test_ResolvesNo() public {
        uint256 marketId = _newMarket(5000, RitualPredict.Comparator.GTE);
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 1 ether);
        _settle(marketId);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.No));
    }

    function test_DoesNothingBeforeResolveBlock() public {
        uint256 marketId = _newMarket();
        _fire(marketId, 0);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(m.attempts, 0);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Open));
    }

    function test_CallbackIsIdempotent() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _settle(marketId);

        // An execution already in flight when the cancel landed.
        scheduler.fireIgnoringCancellation(predict.getMarket(marketId).scheduleId, 1);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(m.attempts, 1, "a late execution must not burn an attempt");
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
    }

    // ── a failed read is never a NO ──

    function test_NonOkStatusIsAFailureNotANo() public {
        http.setHttpResponse(500, BODY, "");
        _assertFailsWithout("http status not 200");
    }

    function test_ExecutorErrorIsAFailureNotANo() public {
        http.setHttpResponse(200, BODY, "dns failure");
        _assertFailsWithout("dns failure");
    }

    function test_UnsettledAsyncOutputIsAFailureNotANo() public {
        http.setUnsettled();
        _assertFailsWithout("async output not settled");
    }

    function test_MalformedEnvelopeIsAFailureNotANo() public {
        http.setRawResponse(hex"deadbeef");
        _assertFailsWithout("malformed http response");
    }

    function test_EmptyJqOutputIsAFailureNotANo() public {
        jq.setEmpty();
        _assertFailsWithout("jq extraction failed");
    }

    function test_MissingExecutorIsAFailureNotANo() public {
        registry.setExecutor(executor, false);
        _assertFailsWithout("no http executor available");
    }

    function test_RevertingPrecompileIsAFailureNotANo() public {
        http.setRevert(true);
        _assertFailsWithout("http precompile call failed");
    }

    /// One attempt runs, it fails for `reason`, and the market is still unresolved.
    function _assertFailsWithout(string memory reason) internal {
        uint256 marketId = _newMarket();
        _bet(marketId, bob, false, 1 ether);
        _rollToResolve(marketId);

        vm.expectEmit(true, false, false, true, address(predict));
        emit RitualPredict.ResolutionFailed(marketId, 1, reason);
        _fire(marketId, 0);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolving));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Unresolved), "must not be NO");
        assertEq(m.attempts, 1);
    }

    function test_ExhaustedAttemptsBecomeInvalidAndRefundable() public {
        http.setHttpResponse(503, BODY, "");

        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 2 ether);
        _rollToResolve(marketId);

        for (uint256 i = 0; i < predict.MAX_ATTEMPTS(); i++) {
            _fire(marketId, i);
        }

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));
        assertEq(m.attempts, predict.MAX_ATTEMPTS());

        vm.prank(alice);
        predict.claimRefund(marketId);
        assertEq(alice.balance, 1 ether, "refunded whichever side was backed");

        vm.prank(bob);
        predict.claimRefund(marketId);
        assertEq(bob.balance, 2 ether);
    }

    function test_ALaterAttemptCanStillSucceed() public {
        http.setHttpResponse(500, BODY, "");

        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _rollToResolve(marketId);
        _fire(marketId, 0);

        http.setHttpResponse(200, BODY, "");
        _fire(marketId, 1);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
        assertEq(m.attempts, 2);
    }

    function test_EmptyWinningSideRefundsEveryone() public {
        uint256 marketId = _newMarket();
        _bet(marketId, bob, false, 3 ether); // YES wins, nobody backed YES
        _settle(marketId);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes), "outcome still recorded");
        assertEq(m.observedValue, 4200);

        vm.prank(bob);
        predict.claimRefund(marketId);
        assertEq(bob.balance, 3 ether);
    }

    // ────────────────────────────── payouts ──────────────────────────────

    function test_PayoutIsProportionalToStake() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, carol, true, 3 ether);
        _bet(marketId, bob, false, 4 ether);
        _settle(marketId);

        // pool 8, winning pool 4 → alice 1*8/4 = 2, carol 3*8/4 = 6
        vm.prank(alice);
        predict.claimWinnings(marketId);
        assertEq(alice.balance, 2 ether);

        vm.prank(carol);
        predict.claimWinnings(marketId);
        assertEq(carol.balance, 6 ether);
    }

    function test_LosingSideGetsNothing() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 1 ether);
        _settle(marketId);

        vm.prank(bob);
        vm.expectRevert(RitualPredict.NothingToClaim.selector);
        predict.claimWinnings(marketId);
    }

    function test_CannotClaimTwice() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 1 ether);
        _settle(marketId);

        vm.startPrank(alice);
        predict.claimWinnings(marketId);
        vm.expectRevert(RitualPredict.AlreadySettled.selector);
        predict.claimWinnings(marketId);
        vm.stopPrank();
    }

    function test_CannotClaimBeforeResolution() public {
        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, 1 ether);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.NotResolved.selector);
        predict.claimWinnings(marketId);
    }

    /**
     * The whole pool is paid out, and never more than the whole pool. Integer division
     * leaves sub-wei dust behind, which is deliberate — this pins down how much.
     */
    function testFuzz_PayoutsNeverExceedThePool(uint96 aliceYes, uint96 carolYes, uint96 bobNo)
        public
    {
        aliceYes = uint96(bound(aliceYes, 1, 1_000 ether));
        carolYes = uint96(bound(carolYes, 1, 1_000 ether));
        bobNo = uint96(bound(bobNo, 1, 1_000 ether));

        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, aliceYes);
        _bet(marketId, carol, true, carolYes);
        _bet(marketId, bob, false, bobNo);
        _settle(marketId);

        uint256 pool = uint256(aliceYes) + carolYes + bobNo;

        vm.prank(alice);
        predict.claimWinnings(marketId);
        vm.prank(carol);
        predict.claimWinnings(marketId);

        uint256 paid = alice.balance + carol.balance;
        assertLe(paid, pool, "never pays out more than was staked");
        // Two winners, so at most one wei of truncation each.
        assertGe(paid, pool - 2, "the pool is distributed except for dust");
        assertEq(address(predict).balance, pool - paid, "dust stays in the contract");
    }

    /// Whatever the numbers, a resolved market always has a claimable winner.
    function testFuzz_ResolvedMarketAlwaysHasAWinner(uint96 yesStake, uint96 noStake, uint64 observed)
        public
    {
        yesStake = uint96(bound(yesStake, 1, 1_000 ether));
        noStake = uint96(bound(noStake, 1, 1_000 ether));

        jq.setValue(observed);

        uint256 marketId = _newMarket();
        _bet(marketId, alice, true, yesStake);
        _bet(marketId, bob, false, noStake);
        _settle(marketId);

        RitualPredict.Market memory m = predict.getMarket(marketId);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));

        address winner = m.outcome == RitualPredict.Outcome.Yes ? alice : bob;
        (,,, uint256 claimable) = predict.stakesOf(marketId, winner);
        assertGt(claimable, 0, "the winning side must always be able to claim");

        vm.prank(winner);
        predict.claimWinnings(marketId);
    }

    // ───────────────────────────── comparators ───────────────────────────

    function test_AllComparators() public {
        _assertComparator(RitualPredict.Comparator.GT, 4199, RitualPredict.Outcome.Yes);
        _assertComparator(RitualPredict.Comparator.GT, 4200, RitualPredict.Outcome.No);
        _assertComparator(RitualPredict.Comparator.GTE, 4200, RitualPredict.Outcome.Yes);
        _assertComparator(RitualPredict.Comparator.GTE, 4201, RitualPredict.Outcome.No);
        _assertComparator(RitualPredict.Comparator.LT, 4201, RitualPredict.Outcome.Yes);
        _assertComparator(RitualPredict.Comparator.LT, 4200, RitualPredict.Outcome.No);
        _assertComparator(RitualPredict.Comparator.LTE, 4200, RitualPredict.Outcome.Yes);
        _assertComparator(RitualPredict.Comparator.LTE, 4199, RitualPredict.Outcome.No);
    }

    function _assertComparator(
        RitualPredict.Comparator comparator,
        uint256 target,
        RitualPredict.Outcome expected
    ) internal {
        uint256 marketId = _newMarket(target, comparator);
        _bet(marketId, alice, true, 1 ether);
        _bet(marketId, bob, false, 1 ether);
        _settle(marketId);

        assertEq(uint8(predict.getMarket(marketId).outcome), uint8(expected));
    }

    // ──────────────────────── execution funding ──────────────────────────

    function test_FundExecutionPrepaysTheRitualWallet() public {
        uint256 before_ = predict.executionBalance();
        predict.fundExecution{value: 0.5 ether}(1_000);
        assertEq(predict.executionBalance(), before_ + 0.5 ether);
    }

    function test_FundExecutionRejectsZero() public {
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.fundExecution{value: 0}(1_000);
    }
}
