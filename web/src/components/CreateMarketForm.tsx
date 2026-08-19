"use client";

import { useState } from "react";

import { useTx } from "@/hooks/useTx";
import type { useWallet } from "@/hooks/useWallet";
import { COMPARATOR, DEMO_MARKET, LIMITS, type ComparatorKey } from "@/lib/presets";
import { predictAbi } from "@/lib/predict-abi";

export function CreateMarketForm({
  wallet,
  address,
  onCreated,
}: {
  wallet: ReturnType<typeof useWallet>;
  address: `0x${string}`;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState<string>(DEMO_MARKET.question);
  const [oracleUrl, setOracleUrl] = useState<string>(DEMO_MARKET.oracleUrl);
  const [jsonPath, setJsonPath] = useState<string>(DEMO_MARKET.jsonPath);
  const [target, setTarget] = useState<string>(DEMO_MARKET.target.toString());
  const [comparator, setComparator] = useState<ComparatorKey>(DEMO_MARKET.comparator);
  const [bettingSeconds, setBettingSeconds] = useState<string>(DEMO_MARKET.bettingSeconds.toString());
  const [resolveDelaySeconds, setResolveDelay] = useState<string>(
    DEMO_MARKET.resolveDelaySeconds.toString(),
  );
  const tx = useTx();

  /**
   * The same checks the contract makes, run before the wallet prompt so a mistake costs
   * nothing. The localhost check is the one that actually bites: the oracle URL is
   * fetched by a TEE executor in the cloud, so a loopback address can never resolve.
   */
  function validate(): string | undefined {
    if (!question.trim() || !oracleUrl.trim() || !jsonPath.trim()) {
      return "Question, oracle URL and json path are all required.";
    }
    if (!/^https?:\/\//.test(oracleUrl)) return "The oracle URL must start with http:// or https://.";

    let betting: bigint;
    let delay: bigint;
    try {
      betting = BigInt(bettingSeconds);
      delay = BigInt(resolveDelaySeconds);
      BigInt(target);
    } catch {
      return "Target and durations must be whole numbers.";
    }

    if (betting < LIMITS.minBettingSeconds) {
      return `Betting must stay open for at least ${LIMITS.minBettingSeconds} seconds.`;
    }
    if (delay < LIMITS.minResolveDelaySeconds) {
      return `The resolve delay must be at least ${LIMITS.minResolveDelaySeconds} seconds.`;
    }
    if (betting + delay > LIMITS.maxMarketSeconds) {
      return "Betting plus resolve delay cannot exceed 24 hours.";
    }
    return undefined;
  }

  const localhostOracle = /localhost|127\.0\.0\.1/.test(oracleUrl);
  const problem = validate();

  async function submit() {
    const hash = await tx.run(
      async () => {
        const client = wallet.getWalletClient();
        return client.writeContract({
          address,
          abi: predictAbi,
          functionName: "createMarket",
          args: [
            {
              question: question.trim(),
              oracleUrl: oracleUrl.trim(),
              jsonPath: jsonPath.trim(),
              target: BigInt(target),
              comparator: COMPARATOR[comparator],
              bettingSeconds: BigInt(bettingSeconds),
              resolveDelaySeconds: BigInt(resolveDelaySeconds),
            },
          ],
          chain: wallet.chain,
          account: client.account,
        });
      },
      (hash) => wallet.publicClient.waitForTransactionReceipt({ hash }),
    );
    if (hash) {
      onCreated();
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button className="primary" onClick={() => setOpen(true)} style={{ width: "100%" }}>
        Create a market
      </button>
    );
  }

  return (
    <section className="panel grid" style={{ gap: "0.8rem" }}>
      <div className="between">
        <strong>New market</strong>
        <button onClick={() => setOpen(false)}>Close</button>
      </div>

      <label className="grid" style={{ gap: "0.3rem" }}>
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          Question
        </span>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} />
      </label>

      <label className="grid" style={{ gap: "0.3rem" }}>
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          Oracle URL — fetched by a TEE executor, so it must be publicly reachable
        </span>
        <input value={oracleUrl} onChange={(event) => setOracleUrl(event.target.value)} />
      </label>

      <div className="row" style={{ gap: "0.6rem", alignItems: "flex-end" }}>
        <label className="grid" style={{ gap: "0.3rem", flex: "1 1 8rem" }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            jq filter
          </span>
          <input value={jsonPath} onChange={(event) => setJsonPath(event.target.value)} />
        </label>
        <label className="grid" style={{ gap: "0.3rem", flex: "0 0 6rem" }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Comparator
          </span>
          <select
            value={comparator}
            onChange={(event) => setComparator(event.target.value as ComparatorKey)}
          >
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
          </select>
        </label>
        <label className="grid" style={{ gap: "0.3rem", flex: "1 1 7rem" }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Target
          </span>
          <input inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
      </div>

      <div className="row" style={{ gap: "0.6rem" }}>
        <label className="grid" style={{ gap: "0.3rem", flex: 1 }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Betting window (seconds)
          </span>
          <input
            inputMode="numeric"
            value={bettingSeconds}
            onChange={(event) => setBettingSeconds(event.target.value)}
          />
        </label>
        <label className="grid" style={{ gap: "0.3rem", flex: 1 }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Then resolve after (seconds)
          </span>
          <input
            inputMode="numeric"
            value={resolveDelaySeconds}
            onChange={(event) => setResolveDelay(event.target.value)}
          />
        </label>
      </div>

      {localhostOracle && (
        <p className="note">
          A loopback URL will never resolve: the HTTP precompile runs inside a TEE in the
          cloud, not in your browser. Expose it first, e.g.{" "}
          <span className="mono">cloudflared tunnel --url http://localhost:3000</span>.
        </p>
      )}

      {problem && <p className="error">{problem}</p>}
      {tx.error && <p className="error">{tx.error}</p>}

      <button
        className="primary"
        disabled={Boolean(problem) || tx.pending || !wallet.account}
        onClick={() => void submit()}
      >
        {tx.pending ? "Confirming…" : "Create market and schedule its resolution"}
      </button>
      {!wallet.account && (
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
          Connect a wallet first.
        </p>
      )}
    </section>
  );
}
