"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";

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
  const tx = useTx();

  const { account, publicClient, getWalletClient } = wallet;
  const bettable = isBettable(market, currentBlock);
  const yes = yesPercent(market);
  const total = pool(market);

  // The caller's own stake and what it is currently worth.
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

  async function send(fn: "bet" | "claimWinnings" | "claimRefund") {
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

  const badgeClass =
    market.state === STATE.Resolved ? "resolved" : market.state === STATE.Invalid ? "invalid" : "open";

  const explorer = tx.hash ? explorerTx(wallet.chainId, tx.hash) : undefined;

  return (
    <article className="panel grid" style={{ gap: "0.9rem" }}>
      <div className="between" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 20rem" }}>
          <div className="row" style={{ gap: "0.5rem", marginBottom: "0.4rem" }}>
            <span className="badge mono">#{market.id.toString()}</span>
            <span className={`badge ${badgeClass}`}>{stateName(market)}</span>
            {isSettled(market) && market.outcome !== RESULT.Unresolved && (
              <span className={`badge ${market.outcome === RESULT.Yes ? "resolved" : "invalid"}`}>
                {outcomeName(market)}
              </span>
            )}
          </div>
          <h2 style={{ margin: 0, fontSize: "1.08rem", lineHeight: 1.35 }}>{market.question}</h2>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.15rem", fontWeight: 600 }}>{ritual(total)} RITUAL</div>
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            total pool
          </div>
        </div>
      </div>

      {/* Pool split doubles as the market's implied probability. */}
      <div>
        <div className="between" style={{ fontSize: "0.85rem", marginBottom: "0.35rem" }}>
          <span style={{ color: "var(--yes)" }}>YES {yes.toFixed(1)}%</span>
          <span style={{ color: "var(--no)" }}>NO {(100 - yes).toFixed(1)}%</span>
        </div>
        <div className="bar">
          <span style={{ width: `${yes}%` }} />
        </div>
        <div className="between muted" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
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
              {market.oracleUrl} <span className="muted">· jq {market.jsonPath}</span>
            </td>
          </tr>
          <tr>
            <td>Betting closes</td>
            <td>
              block {market.closeBlock.toString()}{" "}
              <span className="muted">
                ({blocksUntil(market.closeBlock, currentBlock, blockTimeMs)})
              </span>
            </td>
          </tr>
          <tr>
            <td>Resolves</td>
            <td>
              block {market.resolveBlock.toString()}{" "}
              <span className="muted">
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
        <div className="row" style={{ fontSize: "0.85rem", gap: "1rem" }}>
          <span className="muted">Your position</span>
          {position.yes > 0n && <span style={{ color: "var(--yes)" }}>YES {ritual(position.yes)}</span>}
          {position.no > 0n && <span style={{ color: "var(--no)" }}>NO {ritual(position.no)}</span>}
          {position.settled ? (
            <span className="muted">· already claimed</span>
          ) : (
            position.claimable > 0n && <span>· claimable {ritual(position.claimable)}</span>
          )}
        </div>
      )}

      {bettable && (
        <div className="grid" style={{ gap: "0.6rem" }}>
          <div className="row">
            <button
              className="yes"
              aria-pressed={side === true}
              onClick={() => setSide(true)}
              style={{ flex: 1 }}
            >
              YES {stake > 0n && `· ${payoutMultiple(market, true, stake).toFixed(2)}×`}
            </button>
            <button
              className="no"
              aria-pressed={side === false}
              onClick={() => setSide(false)}
              style={{ flex: 1 }}
            >
              NO {stake > 0n && `· ${payoutMultiple(market, false, stake).toFixed(2)}×`}
            </button>
          </div>
          <div className="row">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="Stake in RITUAL"
              style={{ flex: "1 1 8rem" }}
            />
            <button
              className="primary"
              disabled={!account || side === undefined || stake <= 0n || tx.pending}
              onClick={() => void send("bet")}
            >
              {tx.pending ? "Confirming…" : `Stake ${amount || "0"} RITUAL`}
            </button>
          </div>
          {!account && (
            <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
              Connect a wallet to place a bet.
            </p>
          )}
        </div>
      )}

      {market.state === STATE.Resolved && position && !position.settled && position.claimable > 0n && (
        <button className="primary" disabled={tx.pending} onClick={() => void send("claimWinnings")}>
          {tx.pending ? "Confirming…" : `Claim ${ritual(position.claimable)} RITUAL`}
        </button>
      )}

      {market.state === STATE.Invalid && position && !position.settled && position.claimable > 0n && (
        <button disabled={tx.pending} onClick={() => void send("claimRefund")}>
          {tx.pending ? "Confirming…" : `Refund ${ritual(position.claimable)} RITUAL`}
        </button>
      )}

      {tx.error && <p className="error">{tx.error}</p>}
      {tx.hash && !tx.pending && !tx.error && (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
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
