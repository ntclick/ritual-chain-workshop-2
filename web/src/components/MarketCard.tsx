"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";

import { Countdown } from "@/components/Countdown";
import { canTransact, NetworkGate } from "@/components/NetworkGate";
import { useTx } from "@/hooks/useTx";
import type { useWallet } from "@/hooks/useWallet";
import { explorerTx } from "@/lib/chains";
import {

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
type Action = "bet" | "claimWinnings" | "claimRefund" | "expireStuck";

export function MarketCard({
  market,
  wallet,
  address,
  currentBlock,
  blockTimeMs,
  observedAt,
  isDemo,
  maxAttempts,
  onChanged,
}: {
  market: Market;
  wallet: ReturnType<typeof useWallet>;
  address: `0x${string}`;
  currentBlock: bigint;
  blockTimeMs: bigint;
  observedAt: number;
  isDemo: boolean;
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
  const settled = isSettled(market);
  const bettingOver = settled || currentBlock >= market.closeBlock;
  const resolveDue = !settled && currentBlock >= market.resolveBlock;

  useEffect(() => {
    if (!account || isDemo) {
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
  }, [account, isDemo, address, market.id, market.state, market.totalYes, market.totalNo, publicClient]);

  // Read the deadline from the contract rather than recomputing the formula here, so
  // the two can never drift apart.
  useEffect(() => {
    if (settled || isDemo) {
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
  }, [address, isDemo, market.id, settled, publicClient]);

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
        : market.state === STATE.Resolving
          ? "badge-live"
          : "badge-open";

  const explorer = tx.hash ? explorerTx(wallet.chainId, tx.hash) : undefined;
  const canClaim = position && !position.settled && position.claimable > 0n;
  // Sample markets exist on no chain, so there is nothing to sign against.
  const writable = canTransact(wallet) && !isDemo;

  return (
    <article className="card market">
      <div>
        <div className="market-top">
          <span className="badge">#{market.id.toString()}</span>
          <span className={`badge ${stateClass}`}>{stateName(market)}</span>
          {settled && market.outcome !== RESULT.Unresolved && (
            <span className={`badge ${market.outcome === RESULT.Yes ? "badge-yes" : "badge-no"}`}>
              {outcomeName(market)}
            </span>
          )}
          {market.state === STATE.Resolving && (
            <span className="badge badge-live">
              {market.attempts}/{maxAttempts} tries
            </span>
          )}
        </div>
        <h2 className="market-question" title={market.question}>
          {market.question}
        </h2>
      </div>

      {/* The headline number, the way a prediction market is actually read. */}
      <div className="odds">
        <div className={`odds-figure${yes < 50 ? " low" : ""}`}>
          <b>{yes.toFixed(0)}%</b>
          <span>chance yes</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="stat-value">{ritual(total)}</div>
          <div className="label">pool</div>
        </div>
      </div>

      <div
        className="bar"
        role="img"
        aria-label={`YES ${yes.toFixed(1)} percent, NO ${(100 - yes).toFixed(1)} percent`}
      >
        <span style={{ width: `${yes}%` }} />
      </div>

      {bettable && (
        <div className="bet">
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-yes"
              aria-pressed={side === true}
              onClick={() => setSide(true)}
            >
              Yes
              <small>{stake > 0n ? `${payoutMultiple(market, true, stake).toFixed(2)}×` : "—"}</small>
            </button>
            <button
              className="btn btn-no"
              aria-pressed={side === false}
              onClick={() => setSide(false)}
            >
              No
              <small>{stake > 0n ? `${payoutMultiple(market, false, stake).toFixed(2)}×` : "—"}</small>
            </button>
          </div>
          <div className="bet-amount">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="Stake in RITUAL"
            />
            <button
              className="btn btn-primary"
              disabled={!writable || side === undefined || stake <= 0n || tx.pending}
              onClick={() => void send("bet")}
            >
              {tx.pending ? "Signing…" : "Stake"}
            </button>
          </div>
          {isDemo ? (
            <p className="hint">Sample market — connect to a live deployment to bet.</p>
          ) : (
            <NetworkGate wallet={wallet} />
          )}
        </div>
      )}

      {position && (position.yes > 0n || position.no > 0n) && (
        <div className="position">
          <span className="label">Position</span>
          {position.yes > 0n && <span style={{ color: "var(--yes)" }}>YES {ritual(position.yes)}</span>}
          {position.no > 0n && <span style={{ color: "var(--no)" }}>NO {ritual(position.no)}</span>}
          {position.settled ? (
            <span className="faint">· claimed</span>
          ) : (
            position.claimable > 0n && <span>· worth {ritual(position.claimable)}</span>
          )}
        </div>
      )}

      {market.state === STATE.Resolved && canClaim && (
        <button
          className="btn btn-primary btn-block"
          disabled={tx.pending || !writable}
          onClick={() => void send("claimWinnings")}
        >
          {tx.pending ? "Signing…" : `Claim ${ritual(position!.claimable)} RITUAL`}
        </button>
      )}

      {market.state === STATE.Invalid && canClaim && (
        <button
          className="btn btn-block"
          disabled={tx.pending || !writable}
          onClick={() => void send("claimRefund")}
        >
          {tx.pending ? "Signing…" : `Refund ${ritual(position!.claimable)} RITUAL`}
        </button>
      )}

      {/* Every path to Invalid runs inside the Scheduler callback, so a market whose
          executions never arrived would otherwise trap its stakes forever. */}
      {!settled && expiryBlock !== undefined && currentBlock >= expiryBlock && (
        <div className="banner banner-warn stack" style={{ gap: "0.5rem" }}>
          <span>
            The Scheduler never settled this market
            {market.attempts > 0 ? ` after ${market.attempts} attempt(s)` : ""}. Anyone can
            expire it so every stake becomes refundable.
          </span>
          <button
            className="btn btn-sm"
            disabled={!writable || tx.pending}
            onClick={() => void send("expireStuck")}
          >
            {tx.pending ? "Signing…" : "Expire and open refunds"}
          </button>
        </div>
      )}

      <details className="detail">
        <summary>Resolution rule</summary>
        <table className="kv">
          <tbody>
            <tr>
              <td>Rule</td>
              <td className="mono">{ruleText(market)}</td>
            </tr>
            <tr>
              <td>Oracle</td>
              <td className="mono break">{market.oracleUrl}</td>
            </tr>
            <tr>
              <td>jq</td>
              <td className="mono">{market.jsonPath}</td>
            </tr>
            <tr>
              <td>{bettingOver ? "Closed" : "Closes"}</td>
              <td>
                block {market.closeBlock.toString()}
                {/* Only count toward a deadline that is still ahead. A countdown stuck
                    on "now" makes a market that has already passed the point look like
                    it is still waiting for it. */}
                {!bettingOver && (
                  <>
                    {" "}
                    <Countdown
                      target={market.closeBlock}
                      currentBlock={currentBlock}
                      blockTimeMs={blockTimeMs}
                      observedAt={observedAt}
                    />
                  </>
                )}
              </td>
            </tr>
            <tr>
              <td>{settled ? "Settled" : "Resolves"}</td>
              <td>
                block {market.resolveBlock.toString()}
                {settled ? (
                  <span className="settled-mark"> · confirmed on chain</span>
                ) : resolveDue ? (
                  /* The block arrived and nothing came. Saying "now" hides that; the
                     market is waiting on a callback that may never fire, which is what
                     expireStuck exists for. */
                  <span className="awaiting-mark"> · awaiting the Scheduler</span>
                ) : (
                  <>
                    {" "}
                    <Countdown
                      target={market.resolveBlock}
                      currentBlock={currentBlock}
                      blockTimeMs={blockTimeMs}
                      observedAt={observedAt}
                    />
                  </>
                )}
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
      </details>

      {tx.error && <p className="banner banner-error">{tx.error}</p>}
      {tx.hash && !tx.pending && !tx.error && (
        <p className="hint">
          Confirmed ·{" "}
          {explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="mono">
              {tx.hash.slice(0, 12)}…
            </a>
          ) : (
            <span className="mono">{tx.hash.slice(0, 12)}…</span>
          )}
        </p>
      )}

      <div className="market-foot">
        <span>
          {ritual(market.totalYes)} yes · {ritual(market.totalNo)} no
        </span>
        {settled ? (
          <span>settled</span>
        ) : (
          <span className="foot-clock">
            {bettable ? "closes" : "resolves"}{" "}
            <Countdown
              target={bettable ? market.closeBlock : market.resolveBlock}
              currentBlock={currentBlock}
              blockTimeMs={blockTimeMs}
              observedAt={observedAt}
            />
          </span>
        )}
      </div>
    </article>
  );
}
