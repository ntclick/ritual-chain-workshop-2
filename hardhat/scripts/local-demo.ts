/**
 * Stand up the whole demo on a local Hardhat node, with no testnet involved.
 *
 *   npx hardhat node                              # terminal 1
 *   npx hardhat run scripts/local-demo.ts --network localhost   # terminal 2
 *
 * The Ritual system contracts do not exist on a local node, so this puts the mock
 * runtime code from contracts/mocks/RitualMocks.sol at the canonical addresses with
 * `hardhat_setCode` — the same trick the test suite uses. RitualPredict is deployed
 * unmodified and still calls 0x0801, 0x0803, the Scheduler and the RitualWallet.
 *
 * It then deploys, funds, creates a market, and prints what to put in web/.env.local.
 *
 * The one thing a local node cannot do is run the Scheduler, so nothing wakes the
 * contract on its own. Use scripts/local-resolve.ts to deliver the execution by hand
 * once the resolve block is reached.
 */
import { parseEther } from "viem";

import { network } from "hardhat";
import { COMPARATOR, DEMO_MARKET } from "./market-presets.ts";

const RITUAL_ADDRESSES = {
  MockScheduler: "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B",
  MockRitualWallet: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
  MockTEERegistry: "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F",
  MockHttpPrecompile: "0x0000000000000000000000000000000000000801",
  MockJqPrecompile: "0x0000000000000000000000000000000000000803",
} as const;

/** 1 s/block keeps the demo's block maths readable. */
const BLOCK_TIME_MS = 1_000n;

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [wallet] = await viem.getWalletClients();

if (wallet === undefined) throw new Error("No account available on this network.");

console.log("── Etching the Ritual system contracts ───────────────────");

const testClient = await viem.getTestClient();

// Produce a block every blockTimeMs, so deadlines actually arrive.
//
// A local node only mines when a transaction shows up. Without this the chain sits at
// one height forever: closeBlock never passes, a market stays Open no matter how long
// you wait, and every countdown in the UI is fiction. Hardhat takes this in
// milliseconds, which is why it goes through the raw request rather than viem's
// setIntervalMining wrapper and its seconds.
await testClient.request({
  method: "evm_setIntervalMining" as never,
  params: [Number(BLOCK_TIME_MS)] as never,
});
console.log(`  mining every ${BLOCK_TIME_MS}ms so deadlines actually arrive`);
for (const [name, address] of Object.entries(RITUAL_ADDRESSES)) {
  const deployed = await viem.deployContract(name as keyof typeof RITUAL_ADDRESSES);
  const code = await publicClient.getCode({ address: deployed.address });
  if (!code) throw new Error(`${name} produced no runtime code`);
  await testClient.setCode({ address: address as `0x${string}`, bytecode: code });
  console.log(`  ${name.padEnd(20)} -> ${address}`);
}

// A healthy executor and an oracle that answers, so the market can actually settle.
const registry = await viem.getContractAt("MockTEERegistry", RITUAL_ADDRESSES.MockTEERegistry);
await registry.write.setExecutor([wallet.account.address, true]);

const oracleUrl = process.env.ORACLE_URL ?? DEMO_MARKET.oracleUrl;
const observed = BigInt(process.env.OBSERVED ?? "4200");

const http = await viem.getContractAt("MockHttpPrecompile", RITUAL_ADDRESSES.MockHttpPrecompile);
await http.write.setHttpResponse([200, `0x${Buffer.from(`{"price":${observed}}`).toString("hex")}`, ""]);

const jq = await viem.getContractAt("MockJqPrecompile", RITUAL_ADDRESSES.MockJqPrecompile);
await jq.write.setValue([observed]);
console.log(`  oracle answers 200 with {"price":${observed}}`);

console.log("");
console.log("── Deploy ────────────────────────────────────────────────");

// Set PREDICT_ADDRESS to add another market to an existing deployment instead of
// starting over — handy for demoing several markets side by side. Re-etching above is
// safe either way: hardhat_setCode replaces code without clearing storage, so markets
// already booked with the Scheduler double survive.
const existing = process.env.PREDICT_ADDRESS as `0x${string}` | undefined;

const predict = existing
  ? await viem.getContractAt("RitualPredict", existing)
  : await viem.deployContract("RitualPredict", [BLOCK_TIME_MS]);

if (existing) {
  console.log(`  RitualPredict        ${predict.address}  (reused)`);
} else {
  console.log(`  RitualPredict        ${predict.address}`);
  await predict.write.fundExecution([1_000_000n], { value: parseEther("1") });
  console.log(`  prepaid execution    1 RITUAL`);
}

console.log("");
console.log("── Demo market ───────────────────────────────────────────");

const bettingSeconds = BigInt(process.env.BETTING_SECONDS ?? "60");
const resolveDelaySeconds = BigInt(process.env.RESOLVE_DELAY_SECONDS ?? "30");

// Every field is overridable, so a market with a real question and a real target
// can be created without editing this file.
const question = process.env.QUESTION ?? DEMO_MARKET.question;
const jsonPath = process.env.JSON_PATH ?? DEMO_MARKET.jsonPath;
const target = BigInt(process.env.TARGET ?? DEMO_MARKET.target);
const comparatorKey = (process.env.COMPARATOR ?? DEMO_MARKET.comparator) as keyof typeof COMPARATOR;
if (COMPARATOR[comparatorKey] === undefined) {
  throw new Error(`COMPARATOR must be one of: ${Object.keys(COMPARATOR).join(", ")}`);
}

await predict.write.createMarket([
  {
    question,
    oracleUrl,
    jsonPath,
    target,
    comparator: COMPARATOR[comparatorKey],
    bettingSeconds,
    resolveDelaySeconds,
  },
]);

const marketId = await predict.read.marketCount();
const market = await predict.read.getMarket([marketId]);

console.log(`  market #${marketId}           ${question}`);
console.log(`  rule                 observed ${comparatorKey.toUpperCase()} ${target}`);
console.log(`  betting closes       block ${market.closeBlock}`);
console.log(`  resolves at          block ${market.resolveBlock}`);

console.log("");
console.log("── Point the frontend at it ──────────────────────────────");
console.log("Write this into web/.env.local:");
console.log("");
console.log(`  NEXT_PUBLIC_PREDICT_ADDRESS=${predict.address}`);
console.log(`  NEXT_PUBLIC_DEMO_ORACLE_URL=http://localhost:3000/api/oracle/eth`);
console.log("");
console.log("Then:  cd ../web && pnpm dev");
console.log("");
console.log("Place a bet in the UI, then deliver the scheduled execution by hand:");
console.log(`  PREDICT_ADDRESS=${predict.address} npx hardhat run scripts/local-resolve.ts --network localhost`);

await connection.close();
