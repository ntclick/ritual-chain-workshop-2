import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Hardhat 3 resolves configVariable() from process.env but does not read .env itself,
// and this project has no dotenv dependency — so without this the documented
// "copy .env.example to .env" workflow silently produces an unset key. Node 22's
// built-in loader keeps that a zero-dependency fix. Real environment variables win,
// which is what CI wants.
try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // No .env — fine. Only the `ritual` network needs one, and it fails loudly there.
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // A running `npx hardhat node`. scripts/local-demo.ts etches the Ritual system
    // contracts onto it so the frontend can drive the real contract without a testnet.
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    // Ritual Chain testnet. Requires EIP-1559 (type-2) transactions; viem sends
    // those by default.
    ritual: {
      type: "http",
      chainType: "l1",
      chainId: 1979,
      url: process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org",
      accounts: [configVariable("RITUAL_PRIVATE_KEY")],
    },
  },
});
