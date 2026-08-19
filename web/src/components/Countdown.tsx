"use client";

import { useEffect, useState } from "react";

import { blocksRemaining, formatDuration, msUntil } from "@/lib/market";

/**
 * A deadline that both ticks and tells the truth.
 *
 * The contract counts in blocks, so the block delta is the fact and the clock is an
 * estimate derived from `blockTimeMs`. Both are shown, because on a chain that is not
 * producing blocks the estimate is fiction and only the block count is real — which is
 * exactly the situation on a local node between transactions.
 */
export function Countdown({
  target,
  currentBlock,
  blockTimeMs,
  observedAt,
  showBlocks = true,
}: {
  target: bigint;
  currentBlock: bigint;
  blockTimeMs: bigint;
  /** Wall clock (ms) when `currentBlock` was read. 0 before the first client tick. */
  observedAt: number;
  showBlocks?: boolean;
}) {
  // Starts null so the server and the first client render agree; the interval then
  // takes over and the value ticks once per second.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now && observedAt ? Math.max(0, now - observedAt) : 0;
  const remaining = msUntil(target, currentBlock, blockTimeMs, elapsed);
  const blocks = blocksRemaining(target, currentBlock);

  if (blocks === 0) return <span className="countdown is-now">now</span>;

  // The estimate can run out while blocks are still owed — the chain simply produced
  // them slower than blockTimeMs assumed, or stopped. Saying "now" there would be a
  // lie, so the block count carries it and the clock admits it is past due.
  const expired = remaining <= 0;

  return (
    <span className="countdown">
      <span className={`countdown-time${expired ? " is-overdue" : ""}`}>
        {expired ? "due" : formatDuration(remaining)}
      </span>
      {showBlocks && (
        <span
          className="countdown-blocks"
          title="Blocks remaining — the value the contract actually uses. The clock beside it is an estimate from blockTimeMs."
        >
          {blocks.toLocaleString()} blk
        </span>
      )}
    </span>
  );
}
