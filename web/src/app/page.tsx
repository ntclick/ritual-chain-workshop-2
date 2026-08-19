"use client";

import { CreateMarketForm } from "@/components/CreateMarketForm";
import { Header } from "@/components/Header";
import { MarketCard } from "@/components/MarketCard";
import { usePredict, usePredictAddress } from "@/hooks/usePredict";
import { useWallet } from "@/hooks/useWallet";
import { ritual, STATE } from "@/lib/market";

export default function Home() {
  const wallet = useWallet();
  const { address, setAddress } = usePredictAddress();
  const { data, error, loading, refresh } = usePredict(wallet, address);

  const openCount = data?.markets.filter((m) => m.state === STATE.Open).length ?? 0;

  return (
    <main className="wrap">
      <Header wallet={wallet} address={address} onAddressChange={setAddress} />

      {!address ? (
        <section className="card stack">
          <div>
            <h2 className="card-title">Point the app at a deployment</h2>
            <p className="card-sub">
              Set <code>NEXT_PUBLIC_PREDICT_ADDRESS</code> in <code>web/.env.local</code>, or
              paste an address with <strong>Set address</strong> above. To deploy one on a
              local node:
            </p>
          </div>
          <pre>{`cd hardhat
npx hardhat node                                            # terminal 1
npx hardhat run scripts/local-demo.ts --network localhost   # terminal 2`}</pre>
        </section>
      ) : (
        <div className="stack">
          {data && (
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Block</span>
                <span className="stat-value">
                  <span className="live" />
                  {data.currentBlock.toString()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Markets</span>
                <span className="stat-value">
                  {data.markets.length}
                  {openCount > 0 && <span className="faint"> · {openCount} open</span>}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Prepaid execution</span>
                <span className="stat-value">
                  {data.executionBalance === 0n ? (
                    <span style={{ color: "var(--no)" }}>0 — resolution skipped</span>
                  ) : (
                    `${ritual(data.executionBalance)} RITUAL`
                  )}
                </span>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                style={{ marginLeft: "auto" }}
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            </div>
          )}

          {error && <p className="banner banner-error">{error}</p>}

          <CreateMarketForm wallet={wallet} address={address} onCreated={refresh} />

          {loading && !data && (
            <>
              <div className="skeleton" />
              <div className="skeleton" />
            </>
          )}

          {data && data.markets.length === 0 && (
            <p className="empty">No markets yet. Create the first one.</p>
          )}

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
      )}

      <footer className="site">
        Resolution is driven by the Ritual Scheduler, not by this page. Markets settle
        whether or not anyone has it open.
      </footer>
    </main>
  );
}
