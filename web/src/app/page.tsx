"use client";

import { CreateMarketForm } from "@/components/CreateMarketForm";
import { Header } from "@/components/Header";
import { MarketCard } from "@/components/MarketCard";
import { usePredict, usePredictAddress } from "@/hooks/usePredict";
import { useWallet } from "@/hooks/useWallet";
import { ritual } from "@/lib/market";

export default function Home() {
  const wallet = useWallet();
  const { address, setAddress } = usePredictAddress();
  const { data, error, loading, refresh } = usePredict(wallet, address);

  return (
    <main className="wrap">
      <Header wallet={wallet} address={address} onAddressChange={setAddress} />

      {!address ? (
        <section className="panel">
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Point the app at a deployment</h2>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Set <span className="mono">NEXT_PUBLIC_PREDICT_ADDRESS</span> in{" "}
            <span className="mono">web/.env.local</span>, or paste an address with{" "}
            <strong>Set address</strong> above. Deploy one with:
          </p>
          <pre
            className="mono"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "0.8rem",
              overflowX: "auto",
            }}
          >
            {`cd hardhat\nnpx hardhat node                      # terminal 1\npnpm demo:local                       # terminal 2`}
          </pre>
        </section>
      ) : (
        <>
          {data && (
            <div className="panel between" style={{ marginBottom: "1rem", fontSize: "0.86rem" }}>
              <span>
                <span className="muted">Block</span>{" "}
                <span className="mono">{data.currentBlock.toString()}</span>
              </span>
              <span>
                <span className="muted">Markets</span> {data.markets.length}
              </span>
              <span>
                <span className="muted">Prepaid execution</span>{" "}
                <span className={data.executionBalance === 0n ? "" : "mono"}>
                  {data.executionBalance === 0n ? (
                    <strong style={{ color: "var(--no)" }}>0 — resolution will be skipped</strong>
                  ) : (
                    `${ritual(data.executionBalance)} RITUAL`
                  )}
                </span>
              </span>
              <button onClick={() => void refresh()}>Refresh</button>
            </div>
          )}

          {error && <p className="error" style={{ marginBottom: "1rem" }}>{error}</p>}

          <div style={{ marginBottom: "1rem" }}>
            <CreateMarketForm wallet={wallet} address={address} onCreated={refresh} />
          </div>

          {loading && !data && <p className="muted">Loading markets…</p>}

          {data && data.markets.length === 0 && (
            <p className="muted">No markets yet. Create the first one.</p>
          )}

          <div className="grid">
            {data?.markets.map((market) => (
              <MarketCard
                key={market.id.toString()}
                market={market}
                wallet={wallet}
                address={address}
                currentBlock={data.currentBlock}
                blockTimeMs={data.blockTimeMs}
                maxAttempts={data.maxAttempts}
                onChanged={refresh}
              />
            ))}
          </div>
        </>
      )}

      <footer className="muted" style={{ marginTop: "2.5rem", fontSize: "0.82rem" }}>
        Resolution is driven by the Ritual Scheduler, not by this page. Markets settle
        whether or not anyone has it open.
      </footer>
    </main>
  );
}
