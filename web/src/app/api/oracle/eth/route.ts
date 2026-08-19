import { NextResponse } from "next/server";

/**
 * The demo oracle the workshop market points at.
 *
 * The market's jq filter is `.price`, so the only contract of this endpoint is that it
 * returns a JSON object with a numeric `price`. The jq precompile is asked for a
 * uint256, so the value must be a non-negative integer — a float would extract as 0 and
 * look exactly like a broken filter.
 *
 * This is fetched by a TEE executor in the cloud, never by the browser, so it has to be
 * reachable from the public internet. During a workshop that means a tunnel:
 *
 *   cloudflared tunnel --url http://localhost:3000
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FALLBACK_PRICE = 4200;

/**
 * A CoinGecko key, if one is configured.
 *
 * Read without a NEXT_PUBLIC_ prefix on purpose. That prefix inlines a value into the
 * JavaScript sent to the browser, which would publish the key to anyone who opens the
 * page. This route runs on the server, so the key never leaves it. The free tier works
 * without one; the key only raises the rate limit.
 */
const COINGECKO_KEY = process.env.COINGECKO_API_KEY;

async function livePrice(): Promise<{ price: number; source: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      {
        signal: controller.signal,
        cache: "no-store",
        headers: COINGECKO_KEY ? { "x-cg-demo-api-key": COINGECKO_KEY } : undefined,
      },
    );
    if (!response.ok) throw new Error(`upstream returned ${response.status}`);

    const body = (await response.json()) as { ethereum?: { usd?: number } };
    const usd = body.ethereum?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd)) {
      throw new Error("upstream payload had no numeric price");
    }

    return { price: Math.floor(usd), source: COINGECKO_KEY ? "coingecko-keyed" : "coingecko" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  let price = FALLBACK_PRICE;
  let source = "fallback";

  try {
    ({ price, source } = await livePrice());
  } catch {
    // A demo oracle that goes down would make every market Invalid after three
    // attempts, which is correct but a poor demo. Serving a known constant keeps the
    // failure visible in `source` without pretending the upstream answered.
  }

  return NextResponse.json(
    { price, source, asOf: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
