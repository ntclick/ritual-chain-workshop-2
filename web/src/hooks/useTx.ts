"use client";

import { useCallback, useState } from "react";
import {
  BaseError,
  ContractFunctionRevertedError,
  ResourceUnavailableRpcError,
  UserRejectedRequestError,
} from "viem";

export type TxState = {
  pending: boolean;
  hash: `0x${string}` | undefined;
  error: string | undefined;
};

/**
 * Turns a viem error into something a person can act on.
 *
 * RitualPredict signals every rejection with a custom error, so the useful part is the
 * error name rather than the wrapped stack viem hands back by default.
 */
function describe(cause: unknown): string {
  if (cause instanceof BaseError) {
    // Wallet-level failures come back before the contract is ever reached, and their
    // default text ("Requested resource not available") reads like a contract problem
    // when it is really a popup waiting to be answered.
    if (cause.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Cancelled in the wallet.";
    }
    if (cause.walk((e) => e instanceof ResourceUnavailableRpcError)) {
      return "Your wallet already has a request open. Open the wallet extension, finish or dismiss it, then try again.";
    }

    const reverted = cause.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const explain: Record<string, string> = {
        BettingClosed: "Betting has closed for this market.",
        ZeroStake: "Enter an amount greater than zero.",
        NotResolved: "This market has not resolved yet.",
        NotInvalid: "This market is not invalid, so there is nothing to refund.",
        NothingToClaim: "You have nothing to claim on this market.",
        AlreadySettled: "You have already been paid out on this market.",
        BadDuration: "Those durations are outside the range the contract allows.",
        EmptyString: "Question, oracle URL and json path are all required.",
        UnknownMarket: "No market with that id.",
        TransferFailed: "The payout transfer was rejected by the receiving account.",
        OnlyScheduler: "Only the Ritual Scheduler can trigger resolution.",
      };
      if (name) return explain[name] ?? `Rejected by the contract: ${name}.`;
    }

    return cause.shortMessage ?? cause.message;
  }

  return (cause as Error)?.message ?? "Something went wrong.";
}

export function useTx() {
  const [state, setState] = useState<TxState>({
    pending: false,
    hash: undefined,
    error: undefined,
  });

  const run = useCallback(
    async (action: () => Promise<`0x${string}`>, waitFor?: (hash: `0x${string}`) => Promise<unknown>) => {
      setState({ pending: true, hash: undefined, error: undefined });
      try {
        const hash = await action();
        setState({ pending: true, hash, error: undefined });
        if (waitFor) await waitFor(hash);
        setState({ pending: false, hash, error: undefined });
        return hash;
      } catch (cause) {
        setState({ pending: false, hash: undefined, error: describe(cause) });
        return undefined;
      }
    },
    [],
  );

  const reset = useCallback(
    () => setState({ pending: false, hash: undefined, error: undefined }),
    [],
  );

  return { ...state, run, reset };
}
