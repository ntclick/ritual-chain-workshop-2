/**
 * Stand in for the Ritual Scheduler on a local node.
 *
 *   PREDICT_ADDRESS=0x... npx hardhat run scripts/local-resolve.ts --network localhost
 *
 * On Ritual Chain nothing here would exist: the Scheduler wakes the contract by itself
 * at the block fixed when the market was created. A local node has no Scheduler, so
 * this mines up to the resolve block and delivers the execution through the mock,
 * which reproduces the one behaviour that matters — overwriting calldata bytes 4-35
 * with the real execution index.
 *
 * Optional: MARKET_ID (defaults to the newest), STATUS (503 to force a failed attempt).
 */
import { network } from "hardhat";
import { MARKET_STATE, OUTCOME } from "./market-presets.ts";
import { readOracle } from "./oracle-read.ts";

const SCHEDULER = "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B";
const HTTP = "0x0000000000000000000000000000000000000801";
const JQ = "0x0000000000000000000000000000000000000803";

const address = process.env.PREDICT_ADDRESS;
if (!address) throw new Error("Set PREDICT_ADDRESS to the deployed RitualPredict address.");

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const testClient = await viem.getTestClient();

const predict = await viem.getContractAt("RitualPredict", address as `0x${string}`);
const scheduler = await viem.getContractAt("MockScheduler", SCHEDULER);

const marketId = BigInt(process.env.MARKET_ID ?? (await predict.read.marketCount()).toString());
const market = await predict.read.getMarket([marketId]);

console.log(`Market #${marketId}: ${market.question}`);
console.log(`  state now      ${MARKET_STATE[market.state]}`);
console.log(`  resolves at    block ${market.resolveBlock}`);

// Read the market's real oracle and load the answer into the doubles, so a local
// resolution settles against the world rather than against a number someone typed.
// OBSERVED= skips this and forces a value; STATUS= forces a failure instead.
if (!process.env.STATUS && !process.env.OBSERVED) {
  const read = await readOracle(market.oracleUrl, market.jsonPath);
  if (read.ok) {
    const http = await viem.getContractAt("MockHttpPrecompile", HTTP);
    const jq = await viem.getContractAt("MockJqPrecompile", JQ);
    const body = `0x${Buffer.from(JSON.stringify(read.raw)).toString("hex")}` as const;
    await http.write.setHttpResponse([200, body, ""]);
    await jq.write.setValue([read.value]);
    console.log(`  oracle read live:  ${market.jsonPath} -> ${read.value}`);
  } else {
    console.log(`  ! oracle read failed: ${read.reason}`);
    console.log("    resolving against whatever the doubles already hold");
  }
}

// Optionally make the oracle fail, to watch the retry path rather than the happy one.
if (process.env.STATUS && process.env.STATUS !== "200") {
  const http = await viem.getContractAt("MockHttpPrecompile", HTTP);
  await http.write.setHttpResponse([
    Number(process.env.STATUS),
    `0x${Buffer.from('{"price":4200}').toString("hex")}`,
    "",
  ]);
  console.log(`  oracle forced to answer ${process.env.STATUS}`);
}

const current = await publicClient.getBlockNumber();
if (current < market.resolveBlock) {
  const blocks = Number(market.resolveBlock - current);
  console.log(`  mining ${blocks} block(s) to reach the resolve block…`);
  await testClient.mine({ blocks });
}

console.log("  delivering the scheduled execution…");
await scheduler.write.fire([market.scheduleId, BigInt(market.attempts)]);

const after = await predict.read.getMarket([marketId]);
console.log("");
console.log(`  state          ${MARKET_STATE[after.state]}`);
console.log(`  outcome        ${OUTCOME[after.outcome]}`);
console.log(`  attempts       ${after.attempts}/${await predict.read.MAX_ATTEMPTS()}`);
if (after.observedValue !== 0n) console.log(`  observed       ${after.observedValue}`);
if (after.invalidReason !== "") console.log(`  invalid        ${after.invalidReason}`);

await connection.close();
