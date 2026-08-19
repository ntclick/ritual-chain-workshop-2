"use client";

import { useState } from "react";

import { SUPPORTED_CHAINS } from "@/lib/chains";
import { shortAddress } from "@/lib/market";
import type { useWallet } from "@/hooks/useWallet";

export function Header({
  wallet,
  address,
  onAddressChange,
}: {
  wallet: ReturnType<typeof useWallet>;
  address: `0x${string}` | undefined;
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
    <header style={{ marginBottom: "1.5rem" }}>
      <div className="between" style={{ marginBottom: "0.9rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", letterSpacing: "-0.02em" }}>
            Ritual Predict
          </h1>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>
            Markets that resolve themselves. No keeper, no cron, no external bot.
          </p>
        </div>

        <div className="row">
          <select
            aria-label="Network"
            value={wallet.chainId ?? ""}
            onChange={(event) => void wallet.requestChain(Number(event.target.value))}
            style={{ width: "auto" }}
          >
            {!wallet.isSupportedChain && (
              <option value="">
                {wallet.chainId ? `Unsupported (${wallet.chainId})` : "No network"}
              </option>
            )}
            {SUPPORTED_CHAINS.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>

          {wallet.account ? (
            <span className="badge mono" title={wallet.account}>
              {shortAddress(wallet.account)}
            </span>
          ) : (
            <button className="primary" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>

      <div className="panel row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: "0.5rem" }}>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Contract
          </span>
          {address ? (
            <span className="mono break">{address}</span>
          ) : (
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              not set
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
              style={{ flex: "1 1 20rem", borderColor: invalid ? "var(--no)" : undefined }}
            />
            <button onClick={save}>Save</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}>{address ? "Change" : "Set address"}</button>
        )}
      </div>

      {!wallet.hasWallet && (
        <p className="note" style={{ marginTop: "0.9rem" }}>
          No injected wallet detected. You can still browse every market — betting and
          claiming need MetaMask or another EIP-1193 wallet.
        </p>
      )}

      {wallet.error && (
        <p className="error" style={{ marginTop: "0.9rem" }}>
          {wallet.error}
        </p>
      )}
    </header>
  );
}
