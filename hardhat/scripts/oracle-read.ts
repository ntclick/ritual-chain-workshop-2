/**
 * Read a market's oracle the way the TEE would, from here.
 *
 * On a real chain the HTTP precompile fetches the URL inside a TEE and the jq precompile
 * extracts one number. A local node has neither, so the doubles answer with whatever
 * value was loaded into them — which means a local resolution otherwise settles against
 * a number somebody typed, not against the world.
 *
 * This performs the same two steps off-chain so the mock can be loaded with the real
 * answer before the Scheduler stand-in fires. It is not jq: it understands the filter
 * shapes the market templates actually use, and says so rather than failing quietly.
 *
 *   .price
 *   .ethereum.usd | floor
 *   .ethereum.usd * 100 | floor
 *   .stargazers_count
 *   .                       (a bare number is valid JSON, so the document is the value)
 */

export type OracleRead =
  | { ok: true; value: bigint; raw: unknown }
  | { ok: false; reason: string };

/** The subset of jq the templates need: a dot path, an optional scale, optional floor. */
export function applyFilter(document: unknown, filter: string): OracleRead {
  const trimmed = filter.trim();

  const floored = /\|\s*floor\s*$/.test(trimmed);
  let expression = trimmed.replace(/\|\s*floor\s*$/, "").trim();

  let scale = 1;
  const scaled = expression.match(/^(.*?)\s*\*\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (scaled) {
    expression = scaled[1]!.trim();
    scale = Number(scaled[2]);
  }

  if (!expression.startsWith(".")) {
    return { ok: false, reason: `unsupported filter "${filter}" — must start with .` };
  }

  let cursor: unknown = document;
  for (const key of expression.slice(1).split(".").filter(Boolean)) {
    if (cursor === null || typeof cursor !== "object" || !(key in cursor)) {
      return { ok: false, reason: `filter "${filter}" matched nothing at .${key}` };
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }

  const numeric = typeof cursor === "string" ? Number(cursor) : cursor;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return { ok: false, reason: `filter "${filter}" produced ${JSON.stringify(cursor)}, not a number` };
  }

  const scaledValue = numeric * scale;
  const finalValue = floored ? Math.floor(scaledValue) : scaledValue;

  if (!Number.isInteger(finalValue)) {
    return {
      ok: false,
      reason:
        `filter "${filter}" produced ${finalValue}, which is not an integer — ` +
        `the jq precompile is asked for a uint256, so add "| floor"`,
    };
  }
  if (finalValue < 0) {
    return { ok: false, reason: `filter "${filter}" produced ${finalValue}; uint256 cannot be negative` };
  }

  return { ok: true, value: BigInt(finalValue), raw: cursor };
}

/** Fetch the URL and reduce it with the filter. Never throws. */
export async function readOracle(url: string, filter: string): Promise<OracleRead> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (cause) {
    return { ok: false, reason: `fetch failed: ${(cause as Error).message}` };
  }

  if (!response.ok) return { ok: false, reason: `http status ${response.status}` };

  const text = await response.text();
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, reason: `body is not JSON: ${text.slice(0, 60)}` };
  }

  return applyFilter(document, filter);
}
