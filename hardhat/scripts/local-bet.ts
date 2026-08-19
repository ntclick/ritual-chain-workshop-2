/**
 * Place bets on a local market from the node's own accounts.
 *
 *   PREDICT_ADDRESS=0x... npx hardhat run scripts/local-bet.ts --network localhost
 *
 * Betting is normally done from the UI with a browser wallet. This exists so the demo
 * can be driven headlessly — and so a market has both sides backed before it resolves,
 * which is what makes the payout interesting.
 *
 * Optional: MARKET_ID (defaults to the newest), YES / NO (amounts in RITUAL).
 */
import { formatEther, parseEther } from "viem";

import { network } from "hardhat";

const address = process.env.PREDICT_ADDRESS;
if (!address) throw new Error("Set PREDICT_ADDRESS to the deployed RitualPredict address.");

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;

const wallets = await viem.getWalletClients();
const [, yesBettor, noBettor] = wallets;
if (yesBettor === undefined || noBettor === undefined) {
  throw new Error("Need at least three accounts on this network.");
}

const predict = await viem.getContractAt("RitualPredict", address as `0x${string}`);
const marketId = BigInt(process.env.MARKET_ID ?? (await predict.read.marketCount()).toString());

const yesAmount = parseEther(process.env.YES ?? "1");
const noAmount = parseEther(process.env.NO ?? "3");

await predict.write.bet([marketId, true], { value: yesAmount, account: yesBettor.account });
console.log(`YES  ${formatEther(yesAmount).padStart(6)} RITUAL  from ${yesBettor.account.address}`);

await predict.write.bet([marketId, false], { value: noAmount, account: noBettor.account });
console.log(`NO   ${formatEther(noAmount).padStart(6)} RITUAL  from ${noBettor.account.address}`);

const market = await predict.read.getMarket([marketId]);
const pool = market.totalYes + market.totalNo;
const yesPct = pool === 0n ? 0 : Number((market.totalYes * 10_000n) / pool) / 100;

console.log("");
console.log(`Market #${marketId} pool ${formatEther(pool)} RITUAL`);
console.log(`  YES ${yesPct.toFixed(1)}%  /  NO ${(100 - yesPct).toFixed(1)}%`);

await connection.close();
