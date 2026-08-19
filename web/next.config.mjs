import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the trace root to this app. Without it Next walks up past the repo, finds an
  // unrelated lockfile in a parent directory, and picks that as the workspace root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The demo oracle is fetched by a TEE executor in the cloud, so the route has to
  // stay dynamic and uncached — a cached price would resolve markets against a stale
  // number.
  async headers() {
    return [
      {
        source: "/api/oracle/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
