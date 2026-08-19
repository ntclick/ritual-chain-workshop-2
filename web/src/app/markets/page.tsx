"use client";

import { useMemo, useState } from "react";

import { Nav } from "@/components/Nav";
import { CreateMarketForm } from "@/components/CreateMarketForm";
import { Header } from "@/components/Header";
import { MarketCard } from "@/components/MarketCard";
import { usePredict, usePredictAddress } from "@/hooks/usePredict";
import { useWallet } from "@/hooks/useWallet";
import { isSettled, ritual, STATE, type Market } from "@/lib/market";

type Filter = "all" | "open" | "resolved" | "invalid";

const FILTERS: { id: Filter; label: string; match: (m: Market) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "open", label: "Live", match: (m) => !isSettled(m) },
  { id: "resolved", label: "Resolved", match: (m) => m.state === STATE.Resolved },
  { id: "invalid", label: "Invalid", match: (m) => m.state === STATE.Invalid },
];

export default function Home() {
  const wallet = useWallet();
  const { address, setAddress } = usePredictAddress();
  const { data, error, loading, refresh } = usePredict(wallet, address);
  const [filter, setFilter] = useState<Filter>("all");

  const markets = data?.markets ?? [];
  const visible = useMemo(
    () => markets.filter(FILTERS.find((f) => f.id === filter)!.match),
    [markets, filter],
  );

  const volume = useMemo(
    () => markets.reduce((sum, m) => sum + m.totalYes + m.totalNo, 0n),
    [markets],
  );

  return (
    <>
      <Nav />
      <main className="wrap">
        <Header wallet={wallet} address={address} onAddressChange={setAddress} />

      {!address ? (
        <section className="card stack">
          <div>
            <h2 className="card-title">No contract configured</h2>
            <p className="card-sub">
              Set <code>NEXT_PUBLIC_PREDICT_ADDRESS</code> in <code>web/.env.local</code>, or
              paste an address with <strong>Change</strong> above. To deploy one locally:
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
                <span className="label">Block</span>
                <span className="stat-value">
                  <span className="live" />
                  {data.currentBlock.toString()}
                </span>
              </div>
              <div className="stat">
                <span className="label">Markets</span>
                <span className="stat-value">{markets.length}</span>
              </div>
              <div className="stat">
                <span className="label">Volume</span>
                <span className="stat-value">{ritual(volume)} RITUAL</span>
              </div>
              <div className="stat">
                <span className="label">Prepaid execution</span>
                <span className="stat-value">
                  {data.executionBalance === 0n ? (
                    <span style={{ color: "var(--no)" }}>0 — resolution skipped</span>
                  ) : (
                    `${ritual(data.executionBalance)} RITUAL`
                  )}
                </span>
              </div>
              {data.chainIdle && (
                <span className="idle-note" title="No new block seen for a while, so the time estimates below are extrapolated, not observed">
                  chain idle — times are estimates
                </span>
              )}
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

          {markets.length > 0 && (
            <div className="filters">
              {FILTERS.map((f) => {
                const count = markets.filter(f.match).length;
                return (
                  <button
                    key={f.id}
                    className="tab"
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>
          )}

          {loading && !data && (
            <div className="market-grid">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          )}

          {data && markets.length === 0 && (
            <p className="empty">No markets yet — create the first one.</p>
          )}

          {data && markets.length > 0 && visible.length === 0 && (
            <p className="empty">Nothing matches this filter.</p>
          )}

          <div className="market-grid">
            {visible.map((market) => (
              <MarketCard
                key={market.id.toString()}
                market={market}
                wallet={wallet}
                address={address}
                currentBlock={data!.currentBlock}
                blockTimeMs={data!.blockTimeMs}
                observedAt={data!.observedAt}
                maxAttempts={data!.maxAttempts}
                onChanged={refresh}
              />
            ))}
          </div>
        </div>
      )}

      <footer className="site">
        Resolution is driven by the Ritual Scheduler, not by this page. Markets settle
        whether or not anyone has it open.
      </footer>
      </main>
    </>
  );
}
