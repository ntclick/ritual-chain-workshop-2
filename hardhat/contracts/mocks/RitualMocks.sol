// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Test doubles for the Ritual Chain system contracts and precompiles.
 *
 * RitualPredict hardcodes the canonical addresses from RitualChain.sol, which hold no
 * code on a local Hardhat node — the constructor alone would revert. The test suite
 * deploys each mock below and copies its runtime code to the canonical address with
 * `hardhat_setCode`, so the contract under test is completely unmodified: it still
 * calls 0x0801, 0x0803, the Scheduler and the RitualWallet exactly as it would on
 * chain.
 *
 * The two precompile mocks are reached through raw `abi.encode(...)` payloads that
 * carry no function selector, so they answer from `fallback()`. Their first calldata
 * word is a left-padded address or a head offset, so the leading four bytes are zero
 * and can never collide with a real selector on the configuration functions.
 */

// ─────────────────────────── Scheduler ────────────────────────────

/**
 * Records what was booked and lets a test drive executions by hand.
 *
 * `fire` reproduces the one piece of Scheduler behaviour the contract depends on:
 * calldata bytes 4-35 are overwritten with the real execution index, which is why the
 * callback encodes a 0 placeholder there. It deliberately does not gate on block
 * number — the tests need to fire early to prove the callback declines to run.
 */
contract MockScheduler {
    struct Call {
        address target;
        bytes data;
        uint32 gas;
        uint32 startBlock;
        uint32 numCalls;
        uint32 frequency;
        uint32 ttl;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        uint256 value;
        address payer;
        uint32 executed;
        bool cancelled;
    }

    uint256 public nextCallId;
    mapping(uint256 => Call) private _calls;
    mapping(address => bool) public approved;

    function approveScheduler(address) external {
        approved[msg.sender] = true;
    }

    function schedule(
        bytes calldata data,
        uint32 gas,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId) {
        callId = ++nextCallId;
        _calls[callId] = Call({
            target: msg.sender,
            data: data,
            gas: gas,
            startBlock: startBlock,
            numCalls: numCalls,
            frequency: frequency,
            ttl: ttl,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            value: value,
            payer: payer,
            executed: 0,
            cancelled: false
        });
    }

    function cancel(uint256 callId) external {
        require(_calls[callId].target == msg.sender, "not the owner of this call");
        require(!_calls[callId].cancelled, "already cancelled");
        _calls[callId].cancelled = true;
    }

    /// 0 SCHEDULED · 2 COMPLETED · 3 CANCELLED
    function getCallState(uint256 callId) external view returns (uint8) {
        Call storage c = _calls[callId];
        if (c.cancelled) return 3;
        if (c.executed >= c.numCalls) return 2;
        return 0;
    }

    function getCall(uint256 callId) external view returns (Call memory) {
        return _calls[callId];
    }

    /**
     * Test-only. Deliver execution `executionIndex` of a booked call.
     *
     * Reverts are bubbled rather than swallowed — the real Scheduler marks the
     * execution skipped, but in a test an unexpected revert should fail loudly.
     */
    function fire(uint256 callId, uint256 executionIndex) external {
        require(!_calls[callId].cancelled, "call was cancelled");
        _deliver(callId, executionIndex);
    }

    /**
     * Test-only. Deliver an execution even though the call has been cancelled, which
     * models an execution already in flight when the cancel landed. That is the case
     * the callback's idempotence guard exists for.
     */
    function fireIgnoringCancellation(uint256 callId, uint256 executionIndex) external {
        _deliver(callId, executionIndex);
    }

    function _deliver(uint256 callId, uint256 executionIndex) private {
        Call storage c = _calls[callId];
        require(c.target != address(0), "no such call");

        bytes memory data = c.data;
        // Overwrite calldata bytes 4-35 (skip the 32-byte length header, then the
        // 4-byte selector) with the real execution index.
        assembly {
            mstore(add(data, 36), executionIndex)
        }

        c.executed += 1;
        (bool ok, bytes memory ret) = c.target.call{gas: c.gas}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

// ────────────────────────── RitualWallet ──────────────────────────

contract MockRitualWallet {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public lockUntil;

    function deposit(uint256 lockDuration) external payable {
        balanceOf[msg.sender] += msg.value;
        lockUntil[msg.sender] = block.number + lockDuration;
    }
}

// ─────────────────────── TEEServiceRegistry ───────────────────────

contract MockTEERegistry {
    address public executor;
    bool public found;
    /// When set, the returned executor is derived from the seed instead of fixed, so a
    /// test can observe that the seed really is re-rolled on every attempt.
    bool public deriveFromSeed;

    function pickServiceByCapability(
        uint8,
        bool,
        uint256 seed,
        uint256
    ) external view returns (address, bool) {
        if (!found) return (address(0), false);
        if (deriveFromSeed) {
            return (address(uint160(uint256(keccak256(abi.encode(seed))))), true);
        }
        return (executor, true);
    }

    function setExecutor(address executor_, bool found_) external {
        executor = executor_;
        found = found_;
    }

    function setDeriveFromSeed(bool value) external {
        deriveFromSeed = value;
    }

    function getIndexedServiceCountByCapability(uint8) external view returns (uint256) {
        return found ? 1 : 0;
    }
}

// ─────────────────────── HTTP precompile 0x0801 ───────────────────

contract MockHttpPrecompile {
    /// The exact envelope returned to the caller.
    bytes public envelope;
    bool public shouldRevert;
    /// The raw 13-field request the contract encoded, kept so a test can decode it.
    bytes public lastRequest;

    /// A normal short-running async result: envelope(simmedInput, actualOutput).
    function setHttpResponse(
        uint16 status,
        bytes calldata body,
        string calldata errorMessage
    ) external {
        bytes memory actualOutput = abi.encode(
            status,
            new string[](0),
            new string[](0),
            body,
            errorMessage
        );
        envelope = abi.encode(bytes(""), actualOutput);
    }

    /// The simulation pass, before the executor has written a result back.
    function setUnsettled() external {
        envelope = abi.encode(bytes(""), bytes(""));
    }

    /// Anything that is not a decodable envelope.
    function setRawResponse(bytes calldata raw) external {
        envelope = raw;
    }

    function setRevert(bool value) external {
        shouldRevert = value;
    }

    fallback() external {
        if (shouldRevert) revert("http precompile failure");
        lastRequest = msg.data;
        bytes memory data = envelope;
        assembly {
            return(add(data, 32), mload(data))
        }
    }
}

// ──────────────────────── jq precompile 0x0803 ────────────────────

/**
 * Reached through `staticcall`, so `fallback()` must not touch state.
 *
 * Not a jq engine: it returns a preset number. It does honour `outputType`, because
 * the contract's length check exists precisely to catch the case where jq answers
 * "successfully" with zero-length output.
 */
contract MockJqPrecompile {
    uint256 public value;
    bool public returnEmpty;

    function setValue(uint256 value_) external {
        value = value_;
        returnEmpty = false;
    }

    /// A wrong filter: ok = true, but no output at all.
    function setEmpty() external {
        returnEmpty = true;
    }

    fallback() external {
        if (returnEmpty) {
            assembly {
                return(0, 0)
            }
        }

        // (string query, string inputData, uint8 outputType) — 1 means uint256.
        (, , uint8 outputType) = abi.decode(msg.data, (string, string, uint8));
        if (outputType != 1) {
            assembly {
                return(0, 0)
            }
        }

        uint256 result = value;
        assembly {
            mstore(0, result)
            return(0, 32)
        }
    }
}

// ─────────────────────────── Misc helpers ─────────────────────────

/// Rejects plain transfers, to exercise the TransferFailed path.
contract RejectingReceiver {
    function bet(address market, uint256 marketId, bool isYes) external payable {
        (bool ok, ) = market.call{value: msg.value}(
            abi.encodeWithSignature("bet(uint256,bool)", marketId, isYes)
        );
        require(ok, "bet failed");
    }

    function claim(address market, uint256 marketId) external {
        (bool ok, bytes memory ret) = market.call(
            abi.encodeWithSignature("claimWinnings(uint256)", marketId)
        );
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {
        revert("no thanks");
    }
}
