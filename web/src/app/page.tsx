import Link from "next/link";

import { LiveStats } from "@/components/LiveStats";
import { Nav } from "@/components/Nav";

const STEPS = [
  {
    n: "01",
    title: "Create",
    body: "Set a question, an oracle URL, a jq filter and a target. The rule is written into the contract and has no setter — nobody can move the goalposts later.",
  },
  {
    n: "02",
    title: "Stake",
    body: "Back YES or NO with native RITUAL. Pari-mutuel: two running totals, no order book, no counterparty to find.",
  },
  {
    n: "03",
    title: "Wake",
    body: "At a block fixed when the market was created, the Ritual Scheduler calls the contract. Nobody presses a button; no cron job runs anywhere.",
  },
  {
    n: "04",
    title: "Settle",
    body: "Inside that one transaction the contract reads the oracle through a TEE, extracts one number, compares it to the target, and opens the pool for claims.",
  },
];

const FEATURES = [
  {
    title: "A failed read is never a NO",
    body: "A precompile failure, a non-200, an executor error, an undecodable envelope and an unparseable body are all treated as failures. Three of them and the market refunds everyone instead of inventing an answer.",
  },
  {
    title: "Deadlines are blocks, not clocks",
    body: "The Scheduler fires at a block, so betting closes at a block. “Betting is closed” and “the Scheduler woke us” can never disagree, whatever the chain's block time does.",
  },
  {
    title: "No executor is hardcoded",
    body: "The TEE executor is drawn from the on-chain registry at resolution time, and the seed is re-rolled on every attempt, so one unhealthy executor cannot sink a market.",
  },
  {
    title: "Payouts are pull-based",
    body: "Each winner computes their own share and withdraws it. Nothing loops over participants, so no market can be made too large to settle.",
  },
  {
    title: "Stuck markets can be freed",
    body: "Every path to Invalid runs inside the Scheduler callback. If those executions never arrive, anyone may expire the market after its whole booking window has passed, and every stake becomes refundable.",
  },
  {
    title: "Verified without the chain",
    body: "94 tests and 98% line coverage against a local node, with the Ritual system contracts etched at their canonical addresses. The contract under test is never modified.",
  },
];

const STACK = [
  { addr: "0x0801", name: "HTTP precompile", note: "GET the oracle URL inside a TEE" },
  { addr: "0x0803", name: "jq precompile", note: "extract one uint256 from the body" },
  { addr: "0x56e7…D58B", name: "Scheduler", note: "wakes the contract at a chosen block" },
  { addr: "0x532F…3948", name: "RitualWallet", note: "prepays execution fees" },
  { addr: "0x9644…F47F", name: "TEEServiceRegistry", note: "picks an attested executor" },
];

export default function Landing() {
  return (
    <>
      <Nav>
        <Link href="/markets" className="btn btn-primary">
          Launch app
        </Link>
      </Nav>

      <main>
        {/* ── hero ── */}
        <section className="hero">
          <div className="hero-inner">
            <span className="eyebrow">
              <span className="live" />
              Ritual Chain · self-resolving markets
            </span>
            <h1 className="hero-title">
              Prediction markets that
              <br />
              <em>settle themselves</em>
            </h1>
            <p className="hero-sub">
              Ask a question with an objective answer. Stake on YES or NO. When the window
              closes, no keeper is paid, no cron job fires and no admin signs anything — the
              chain wakes the contract, it reads the world through a TEE, and it pays out.
            </p>
            <div className="hero-cta">
              <Link href="/markets" className="btn btn-primary btn-lg">
                Open the market board
              </Link>
              <a
                className="btn btn-lg"
                href="https://github.com/ntclick/ritual-chain-workshop-2"
                target="_blank"
                rel="noreferrer"
              >
                Read the source ↗
              </a>
            </div>
            <LiveStats />
          </div>
        </section>

        {/* ── how it works ── */}
        <section className="section">
          <div className="section-inner">
            <span className="label">The loop</span>
            <h2 className="section-title">Four steps, one of them autonomous</h2>
            <div className="steps">
              {STEPS.map((step) => (
                <div key={step.n} className="step card">
                  <span className="step-n">{step.n}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── the resolution transaction ── */}
        <section className="section section-alt">
          <div className="section-inner">
            <span className="label">Inside one scheduled transaction</span>
            <h2 className="section-title">What actually happens at the resolve block</h2>
            <div className="flow">
              {[
                ["Scheduler", "calls onScheduledResolve at the booked block"],
                ["Registry", "pickServiceByCapability(HTTP_CALL) → executor"],
                ["0x0801", "GET the oracle URL, executed inside a TEE"],
                ["0x0803", "jq filter → one uint256"],
                ["Compare", "observed ⋈ target → Resolved(YES | NO)"],
              ].map(([head, body], i, all) => (
                <div key={head} className="flow-step">
                  <div className="flow-card card">
                    <span className="mono flow-head">{head}</span>
                    <span className="flow-body">{body}</span>
                  </div>
                  {i < all.length - 1 && <span className="flow-arrow">↓</span>}
                </div>
              ))}
            </div>
            <p className="flow-note">
              Three attempts are booked up front, 200 blocks apart. If all three fail the
              market becomes <strong>Invalid</strong> and every stake is refundable — a read
              that did not work is never mistaken for a NO.
            </p>
          </div>
        </section>

        {/* ── features ── */}
        <section className="section">
          <div className="section-inner">
            <span className="label">Design</span>
            <h2 className="section-title">Decisions worth knowing</h2>
            <div className="feature-grid">
              {FEATURES.map((f) => (
                <div key={f.title} className="card feature">
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── stack ── */}
        <section className="section section-alt">
          <div className="section-inner">
            <span className="label">Under the hood</span>
            <h2 className="section-title">Ritual primitives this uses</h2>
            <div className="stack-list">
              {STACK.map((s) => (
                <div key={s.addr} className="stack-row">
                  <span className="mono stack-addr">{s.addr}</span>
                  <span className="stack-name">{s.name}</span>
                  <span className="stack-note">{s.note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── cta ── */}
        <section className="section">
          <div className="section-inner cta-band card">
            <div>
              <h2 className="section-title" style={{ marginBottom: "0.35rem" }}>
                Run it yourself
              </h2>
              <p className="card-sub">
                The whole thing works on a local Hardhat node — no testnet, no faucet, no
                funded wallet.
              </p>
            </div>
            <Link href="/markets" className="btn btn-primary btn-lg">
              Launch app
            </Link>
          </div>
        </section>

        <footer className="site">
          <div className="section-inner">
            Built on Ritual Chain · markets settle whether or not anyone is watching
          </div>
        </footer>
      </main>
    </>
  );
}
