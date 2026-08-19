/**
 * Claim on a settled local market, from whichever of the node's accounts is owed
 * something.
 *
 *   PREDICT_ADDRESS=0x... npx hardhat run scripts/local-claim.ts --network localhost
 *
 * Closes the loop the other local scripts open: create, bet, resolve, get paid. Prints
 * the balance either side of the claim so the pari-mutuel arithmetic is visible rather
 * than asserted.
 *
 * Optional: MARKET_ID (defaults to the newest).
 */
import { formatEther } from "viem";

import { network } from "hardhat";
import { MARKET_STATE } from "./market-presets.ts";

const address = process.env.PREDICT_ADDRESS;
if (!address) throw new Error("Set PREDICT_ADDRESS to the deployed RitualPredict address.");

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;
const publicClient = await viem.getPublicClient();

const predict = await viem.getContractAt("RitualPredict", address as `0x${string}`);
const marketId = BigInt(process.env.MARKET_ID ?? (await predict.read.marketCount()).toString());
const market = await predict.read.getMarket([marketId]);

const RESOLVED = 3;
const INVALID = 4;

console.log(`Market #${marketId}: ${MARKET_STATE[market.state]}`);
if (market.state !== RESOLVED && market.state !== INVALID) {
  console.log("Nothing to claim until the market settles.");
  await connection.close();
  process.exit(0);
}

const refunding = market.state === INVALID;
const pool = market.totalYes + market.totalNo;
const winningPool = market.outcome === 1 ? market.totalYes : market.totalNo;

if (!refunding) {
  console.log(`  pool ${formatEther(pool)} / winning side ${formatEther(winningPool)} RITUAL`);
}
console.log("");

let paid = 0n;

for (const wallet of await viem.getWalletClients()) {
  const account = wallet.account.address;
  const [, , alreadySettled, claimable] = await predict.read.stakesOf([marketId, account]);
  if (alreadySettled || claimable === 0n) continue;

  const before = await publicClient.getBalance({ address: account });
  const hash = refunding
    ? await predict.write.claimRefund([marketId], { account: wallet.account })
    : await predict.write.claimWinnings([marketId], { account: wallet.account });
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address: account });

  paid += claimable;
  console.log(`${account}`);
  console.log(
    `  ${refunding ? "refund" : "payout"}  ${formatEther(claimable).padStart(8)} RITUAL` +
      `   balance ${formatEther(before)} -> ${formatEther(after)}`,
  );
}

if (paid === 0n) {
  console.log("No account held a claimable position on this market.");
} else {
  const held = await publicClient.getBalance({ address: predict.address });
  console.log("");
  console.log(`Paid out ${formatEther(paid)} RITUAL of a ${formatEther(pool)} pool.`);
  // One contract holds every market's stakes, so its balance is not this market's
  // leftover — it still owes whatever nobody has claimed elsewhere.
  console.log(
    `Contract still holds ${formatEther(held)} RITUAL across all markets (unclaimed stakes plus dust).`,
  );
}

await connection.close();
