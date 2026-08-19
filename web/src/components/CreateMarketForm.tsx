"use client";

import { useMemo, useState } from "react";

import { useTx } from "@/hooks/useTx";
import type { useWallet } from "@/hooks/useWallet";
import {
  BLANK_TEMPLATE,
  COMPARATOR,
  LIMITS,
  MARKET_TEMPLATES,
  type ComparatorKey,
  type MarketTemplate,
} from "@/lib/presets";
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
  const [templateId, setTemplateId] = useState(MARKET_TEMPLATES[0]!.id);
  const [form, setForm] = useState(() => toForm(MARKET_TEMPLATES[0]!));
  const tx = useTx();

  const templates = useMemo(() => [...MARKET_TEMPLATES, BLANK_TEMPLATE], []);
  const active = templates.find((t) => t.id === templateId) ?? BLANK_TEMPLATE;

  function toForm(template: MarketTemplate) {
    return {
      question: template.question,
      oracleUrl: template.oracleUrl,
      jsonPath: template.jsonPath,
      target: template.id === "custom" ? "" : template.target.toString(),
      comparator: template.comparator,
      bettingSeconds: template.bettingSeconds.toString(),
      resolveDelaySeconds: template.resolveDelaySeconds.toString(),
    };
  }

  function pick(template: MarketTemplate) {
    setTemplateId(template.id);
    setForm(toForm(template));
    tx.reset();
  }

  const set = <K extends keyof ReturnType<typeof toForm>>(
    key: K,
    value: ReturnType<typeof toForm>[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * The same checks the contract makes, run before the wallet prompt so a mistake costs
   * nothing. The localhost check is the one that actually bites: the oracle URL is
   * fetched by a TEE executor in the cloud, so a loopback address can never resolve.
   */
  const problem = useMemo((): string | undefined => {
    if (!form.question.trim() || !form.oracleUrl.trim() || !form.jsonPath.trim()) {
      return "Question, oracle URL and jq filter are all required.";
    }
    if (!/^https?:\/\//.test(form.oracleUrl)) {
      return "The oracle URL must start with http:// or https://.";
    }

    let betting: bigint;
    let delay: bigint;
    try {
      betting = BigInt(form.bettingSeconds);
      delay = BigInt(form.resolveDelaySeconds);
      if (BigInt(form.target) < 0n) return "The target cannot be negative — it is a uint256.";
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
  }, [form]);

  const localhostOracle = /localhost|127\.0\.0\.1/.test(form.oracleUrl);

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
              question: form.question.trim(),
              oracleUrl: form.oracleUrl.trim(),
              jsonPath: form.jsonPath.trim(),
              target: BigInt(form.target),
              comparator: COMPARATOR[form.comparator],
              bettingSeconds: BigInt(form.bettingSeconds),
              resolveDelaySeconds: BigInt(form.resolveDelaySeconds),
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
      <button className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
        <span aria-hidden>+</span> Create a market
      </button>
    );
  }

  const groups = [...new Set(templates.map((t) => t.group))];

  return (
    <section className="card create">
      <div className="card-head">
        <div>
          <h2 className="card-title">New market</h2>
          <p className="card-sub">
            Pick a template or write your own. The rule is fixed at creation — there is no
            setter.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div className="templates">
        {groups.map((group) => (
          <div key={group} className="template-group">
            <span className="template-group-label">{group}</span>
            <div className="chips">
              {templates
                .filter((t) => t.group === group)
                .map((template) => (
                  <button
                    key={template.id}
                    className="chip"
                    aria-pressed={template.id === templateId}
                    onClick={() => pick(template)}
                  >
                    {template.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      <p className="hint">
        <strong>jq</strong> · {active.note}
      </p>

      <div className="fields">
        <label className="field field-wide">
          <span>Question</span>
          <input
            value={form.question}
            placeholder="Will …?"
            onChange={(event) => set("question", event.target.value)}
          />
        </label>

        <label className="field field-wide">
          <span>Oracle URL — fetched by a TEE executor, so it must be publicly reachable</span>
          <input
            value={form.oracleUrl}
            placeholder="https://…"
            onChange={(event) => set("oracleUrl", event.target.value)}
          />
        </label>

        <label className="field">
          <span>jq filter</span>
          <input
            className="mono"
            value={form.jsonPath}
            placeholder=".price"
            onChange={(event) => set("jsonPath", event.target.value)}
          />
        </label>

        <label className="field field-narrow">
          <span>Comparator</span>
          <select
            value={form.comparator}
            onChange={(event) => set("comparator", event.target.value as ComparatorKey)}
          >
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
          </select>
        </label>

        <label className="field">
          <span>Target</span>
          <input
            className="mono"
            inputMode="numeric"
            value={form.target}
            placeholder="4000"
            onChange={(event) => set("target", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Betting window (seconds)</span>
          <input
            className="mono"
            inputMode="numeric"
            value={form.bettingSeconds}
            onChange={(event) => set("bettingSeconds", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Then resolve after (seconds)</span>
          <input
            className="mono"
            inputMode="numeric"
            value={form.resolveDelaySeconds}
            onChange={(event) => set("resolveDelaySeconds", event.target.value)}
          />
        </label>
      </div>

      {form.question && form.jsonPath && (
        <p className="preview">
          Resolves <strong>YES</strong> when{" "}
          <code>
            {form.jsonPath} {["＞", "≥", "＜", "≤"][COMPARATOR[form.comparator]]}{" "}
            {form.target || "?"}
          </code>
        </p>
      )}

      {localhostOracle && (
        <p className="banner banner-warn">
          A loopback URL will never resolve on a real chain: the HTTP precompile runs inside
          a TEE in the cloud, not in your browser. Expose it first, e.g.{" "}
          <code>cloudflared tunnel --url http://localhost:3000</code>. On a local Hardhat
          node it is fine — the mock precompile answers without fetching.
        </p>
      )}

      {problem && <p className="banner banner-error">{problem}</p>}
      {tx.error && <p className="banner banner-error">{tx.error}</p>}

      <button
        className="btn btn-primary btn-block"
        disabled={Boolean(problem) || tx.pending || !wallet.account}
        onClick={() => void submit()}
      >
        {tx.pending ? "Confirming…" : "Create market and schedule its resolution"}
      </button>
      {!wallet.account && <p className="hint">Connect a wallet first.</p>}
    </section>
  );
}
