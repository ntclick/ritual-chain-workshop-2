"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";

import { canTransact, NetworkGate } from "@/components/NetworkGate";
import { useTx } from "@/hooks/useTx";
import type { useWallet } from "@/hooks/useWallet";
import { explorerTx } from "@/lib/chains";
import {
  blocksUntil,
  isBettable,
  isSettled,
  outcomeName,
  payoutMultiple,
  pool,
  RESULT,
  ritual,
  ruleText,
  STATE,
  stateName,
  yesPercent,
  type Market,
} from "@/lib/market";
import { predictAbi } from "@/lib/predict-abi";

type Position = { yes: bigint; no: bigint; settled: boolean; claimable: bigint };

/** Actions a card can send. `expireStuck` takes no stake, the others may. */
type Action = "bet" | "claimWinnings" | "claimRefund" | "expireStuck";

export function MarketCard({
  market,
  wallet,
  address,
  currentBlock,
  blockTimeMs,
  maxAttempts,
  onChanged,
}: {
  market: Market;
  wallet: ReturnType<typeof useWallet>;
  address: `0x${string}`;
  currentBlock: bigint;
  blockTimeMs: bigint;
  maxAttempts: number;
  onChanged: () => void;
}) {
  const [side, setSide] = useState<boolean | undefined>();
  const [amount, setAmount] = useState("0.1");
  const [position, setPosition] = useState<Position | undefined>();
  const [expiryBlock, setExpiryBlock] = useState<bigint | undefined>();
  const tx = useTx();

  const { account, publicClient, getWalletClient } = wallet;
  const bettable = isBettable(market, currentBlock);
  const yes = yesPercent(market);
  const total = pool(market);

  useEffect(() => {
    if (!account) {
      setPosition(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = (await publicClient.readContract({
          address,
          abi: predictAbi,
          functionName: "stakesOf",
          args: [market.id, account],
        })) as readonly [bigint, bigint, boolean, bigint];
        if (!cancelled) {
          setPosition({
            yes: result[0],
            no: result[1],
            settled: result[2],
            claimable: result[3],
          });
        }
      } catch {
        if (!cancelled) setPosition(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, address, market.id, market.state, market.totalYes, market.totalNo, publicClient]);

  // Read the deadline from the contract rather than recomputing the formula here, so
  // the two can never drift apart.
  useEffect(() => {
    if (isSettled(market)) {
      setExpiryBlock(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const value = (await publicClient.readContract({
          address,
          abi: predictAbi,
          functionName: "expiryBlock",
          args: [market.id],
        })) as bigint;
        if (!cancelled) setExpiryBlock(value);
      } catch {
        if (!cancelled) setExpiryBlock(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, market.id, market.state, publicClient]);

  async function send(fn: Action) {
    const hash = await tx.run(
      async () => {
        const client = getWalletClient();
        if (fn === "bet") {
          if (side === undefined) throw new Error("Pick YES or NO first.");
          return client.writeContract({
            address,
            abi: predictAbi,
            functionName: "bet",
            args: [market.id, side],
            value: parseEther(amount || "0"),
            chain: wallet.chain,
            account: client.account,
          });
        }
        return client.writeContract({
          address,
          abi: predictAbi,
          functionName: fn,
          args: [market.id],
          chain: wallet.chain,
          account: client.account,
        });
      },
      (hash) => publicClient.waitForTransactionReceipt({ hash }),
    );
    if (hash) onChanged();
  }

  const stake = (() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  })();

  const stateClass =
    market.state === STATE.Resolved
      ? "badge-yes"
      : market.state === STATE.Invalid
        ? "badge-invalid"
        : "badge-open";

  const explorer = tx.hash ? explorerTx(wallet.chainId, tx.hash) : undefined;

  return (
    <article className="card market">
      <div className="market-head">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: "0.4rem" }}>
            <span className="badge badge-id">#{market.id.toString()}</span>
            <span className={`badge ${stateClass}`}>{stateName(market)}</span>
            {isSettled(market) && market.outcome !== RESULT.Unresolved && (
              <span
                className={`badge ${market.outcome === RESULT.Yes ? "badge-yes" : "badge-no"}`}
              >
                {outcomeName(market)}
              </span>
            )}
          </div>
          <h2 className="market-question">{market.question}</h2>
        </div>

        <div className="pool-total">
          <b>{ritual(total)}</b>
          <span>RITUAL pool</span>
        </div>
      </div>

      <div>
        <div className="split-legend">
          <span style={{ color: "var(--yes)" }}>YES {yes.toFixed(1)}%</span>
          <span style={{ color: "var(--no)" }}>NO {(100 - yes).toFixed(1)}%</span>
        </div>
        <div
          className="bar"
          role="img"
          aria-label={`YES ${yes.toFixed(1)} percent, NO ${(100 - yes).toFixed(1)} percent`}
        >
          <span style={{ width: `${yes}%` }} />
        </div>
        <div className="split-amounts">
          <span>{ritual(market.totalYes)}</span>
          <span>{ritual(market.totalNo)}</span>
        </div>
      </div>

      <table className="kv">
        <tbody>
          <tr>
            <td>Rule</td>
            <td className="mono">{ruleText(market)}</td>
          </tr>
          <tr>
            <td>Oracle</td>
            <td className="mono break">
              {market.oracleUrl} <span className="faint">· jq {market.jsonPath}</span>
            </td>
          </tr>
          <tr>
            <td>Betting closes</td>
            <td>
              block {market.closeBlock.toString()}{" "}
              <span className="faint">
                ({blocksUntil(market.closeBlock, currentBlock, blockTimeMs)})
              </span>
            </td>
          </tr>
          <tr>
            <td>Resolves</td>
            <td>
              block {market.resolveBlock.toString()}{" "}
              <span className="faint">
                ({blocksUntil(market.resolveBlock, currentBlock, blockTimeMs)})
              </span>
            </td>
          </tr>
          {market.attempts > 0 && (
            <tr>
              <td>Attempts</td>
              <td>
                {market.attempts} / {maxAttempts}
              </td>
            </tr>
          )}
          {market.observedValue > 0n && (
            <tr>
              <td>Observed</td>
              <td className="mono">{market.observedValue.toString()}</td>
            </tr>
          )}
          {market.invalidReason !== "" && (
            <tr>
              <td>Invalid</td>
              <td style={{ color: "var(--no)" }}>{market.invalidReason}</td>
            </tr>
          )}
        </tbody>
      </table>

      {position && (position.yes > 0n || position.no > 0n) && (
        <div className="position">
          <span className="stat-label">Your position</span>
          {position.yes > 0n && (
            <span style={{ color: "var(--yes)" }}>YES {ritual(position.yes)}</span>
          )}
          {position.no > 0n && (
            <span style={{ color: "var(--no)" }}>NO {ritual(position.no)}</span>
          )}
          {position.settled ? (
            <span className="faint">· already claimed</span>
          ) : (
            position.claimable > 0n && <span>· claimable {ritual(position.claimable)}</span>
          )}
        </div>
      )}

      {bettable && (
        <div className="bet">
          <div className="row" style={{ gap: "0.55rem", flexWrap: "nowrap" }}>
            <button
              className="btn btn-yes"
              aria-pressed={side === true}
              onClick={() => setSide(true)}
            >
              YES {stake > 0n && `· ${payoutMultiple(market, true, stake).toFixed(2)}×`}
            </button>
            <button
              className="btn btn-no"
              aria-pressed={side === false}
              onClick={() => setSide(false)}
            >
              NO {stake > 0n && `· ${payoutMultiple(market, false, stake).toFixed(2)}×`}
            </button>
          </div>
          <div className="bet-amount">
            <input
              className="mono"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="Stake in RITUAL"
            />
            <button
              className="btn btn-primary"
              disabled={
                !canTransact(wallet) || side === undefined || stake <= 0n || tx.pending
              }
              onClick={() => void send("bet")}
            >
              {tx.pending ? "Confirming…" : `Stake ${amount || "0"} RITUAL`}
            </button>
          </div>
          <NetworkGate wallet={wallet} />
        </div>
      )}

      {market.state === STATE.Resolved && position && !position.settled && position.claimable > 0n && (
        <button
          className="btn btn-primary btn-block"
          disabled={tx.pending || !canTransact(wallet)}
          onClick={() => void send("claimWinnings")}
        >
          {tx.pending ? "Confirming…" : `Claim ${ritual(position.claimable)} RITUAL`}
        </button>
      )}

      {market.state === STATE.Invalid && position && !position.settled && position.claimable > 0n && (
        <button
          className="btn btn-block"
          disabled={tx.pending || !canTransact(wallet)}
          onClick={() => void send("claimRefund")}
        >
          {tx.pending ? "Confirming…" : `Refund ${ritual(position.claimable)} RITUAL`}
        </button>
      )}

      {/* Every path to Invalid runs inside the Scheduler callback, so a market whose
          executions never arrived would otherwise trap its stakes forever. */}
      {!isSettled(market) && expiryBlock !== undefined && (
        <div className="banner banner-warn stack" style={{ gap: "0.5rem" }}>
          {currentBlock >= expiryBlock ? (
            <>
              <span>
                The Scheduler never settled this market
                {market.attempts > 0 ? ` after ${market.attempts} attempt(s)` : ""}. Anyone
                can now expire it so every stake becomes refundable.
              </span>
              <button
                className="btn"
                disabled={!canTransact(wallet) || tx.pending}
                onClick={() => void send("expireStuck")}
              >
                {tx.pending ? "Confirming…" : "Expire market and open refunds"}
              </button>
            </>
          ) : (
            market.attempts >= maxAttempts && (
              <span>
                All {maxAttempts} attempts are spent. If nothing settles it, this market
                can be expired for refunds at block {expiryBlock.toString()} (
                {blocksUntil(expiryBlock, currentBlock, blockTimeMs)}).
              </span>
            )
          )}
        </div>
      )}

      {tx.error && <p className="banner banner-error">{tx.error}</p>}
      {tx.hash && !tx.pending && !tx.error && (
        <p className="hint">
          Confirmed ·{" "}
          {explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="mono">
              {tx.hash.slice(0, 14)}…
            </a>
          ) : (
            <span className="mono">{tx.hash.slice(0, 14)}…</span>
          )}
        </p>
      )}
    </article>
  );
}
