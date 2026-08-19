"use client";

import { useState } from "react";

import { Logo } from "@/components/Logo";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { shortAddress } from "@/lib/market";
import type { useWallet } from "@/hooks/useWallet";

export function Header({
  wallet,
  address,
  isDemo,
  onAddressChange,
}: {
  wallet: ReturnType<typeof useWallet>;
  address: `0x${string}` | undefined;
  isDemo?: boolean;
  onAddressChange: (next: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function save() {
    if (onAddressChange(draft.trim())) {
      setEditing(false);
      setInvalid(false);
      setDraft("");
    } else {
      setInvalid(true);
    }
  }

  return (
    <header className="stack" style={{ marginBottom: "1.5rem" }}>
      <div className="masthead">
        <div className="brandmark">
          <Logo />
          <div className="brand">
            <h1>Ritual Predict</h1>
            <p>
              Markets that settle themselves — Scheduler wakes the contract, a TEE reads the
              oracle, the pool pays out. No keeper, no cron, no bot.
            </p>
          </div>
        </div>

        <div className="row">
          {/* Drives what the app reads, not just what the wallet is asked to do. */}
          <select
            aria-label="Network to view"
            value={wallet.chain.id}
            onChange={(event) => void wallet.requestChain(Number(event.target.value))}
            style={{ width: "auto" }}
          >
            {SUPPORTED_CHAINS.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>

          {wallet.account ? (
            <span className="badge mono" title={wallet.account}>
              <span className="live" />
              {shortAddress(wallet.account)}
            </span>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting}
            >
              {wallet.connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>

      <div className="addressbar">
        <div className="row" style={{ gap: "0.55rem", minWidth: 0 }}>
          <span className="label">Contract</span>
          {address ? (
            <span className="mono break">{address}</span>
          ) : (
            /* "not set" alone reads like a fault while sample markets sit below it. */
            <span className="faint">
              {isDemo ? "none — showing sample markets" : "not set"}
            </span>
          )}
        </div>

        {editing ? (
          <div className="row" style={{ flex: "1 1 22rem", justifyContent: "flex-end" }}>
            <input
              autoFocus
              placeholder="0x…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && save()}
              style={{ flex: "1 1 18rem", borderColor: invalid ? "var(--no)" : undefined }}
            />
            <button className="btn btn-sm" onClick={save}>
              Save
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            {address ? "Change" : "Point at a deployment"}
          </button>
        )}
      </div>

      {wallet.account && !wallet.isSupportedChain && (
        <div className="banner banner-warn between">
          <span>
            Viewing <strong>{wallet.chain.name}</strong>, but the wallet is on
            {wallet.walletChainId ? ` chain ${wallet.walletChainId}` : " another network"}.
            Browsing works either way — betting and claiming need the wallet to match.
          </span>
          <button className="btn btn-sm" onClick={() => void wallet.requestChain(wallet.chain.id)}>
            Switch wallet to {wallet.chain.name}
          </button>
        </div>
      )}

      {!wallet.hasWallet && (
        <p className="banner banner-info">
          No wallet detected — you can still browse every market. If you have one
          installed, extensions do not run inside another app's in-app browser; open this
          page in Chrome or Firefox directly.
        </p>
      )}

      {wallet.error && <p className="banner banner-error">{wallet.error}</p>}
    </header>
  );
}
