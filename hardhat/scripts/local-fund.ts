/**
 * Send RITUAL to your own wallet on the local node.
 *
 *   TO=0xYourMetaMaskAddress npx hardhat run scripts/local-fund.ts --network localhost
 *
 * A Hardhat node pre-funds its own twenty accounts and nothing else, so a MetaMask
 * account you created yourself starts at zero and cannot even pay gas — the wallet
 * refuses to sign and shows "insufficient funds" rather than anything about this app.
 *
 * Worth knowing: the node keeps no state between runs. Restart it and every balance,
 * every deployment and every market is gone, including whatever you funded last time.
 *
 * Optional: AMOUNT (default 100).
 */
import { formatEther, isAddress, parseEther } from "viem";

import { network } from "hardhat";

const to = process.env.TO;
if (!to || !isAddress(to)) {
  throw new Error("Set TO to the wallet address you want funded, e.g. TO=0x1234…");
}

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [funder] = await viem.getWalletClients();

if (funder === undefined) throw new Error("No account available on this network.");

const amount = parseEther(process.env.AMOUNT ?? "100");
const before = await publicClient.getBalance({ address: to });

const hash = await funder.sendTransaction({ to, value: amount });
await publicClient.waitForTransactionReceipt({ hash });

const after = await publicClient.getBalance({ address: to });

console.log(`Funded ${to}`);
console.log(`  from    ${funder.account.address}`);
console.log(`  sent    ${formatEther(amount)} RITUAL`);
console.log(`  balance ${formatEther(before)} -> ${formatEther(after)}`);

await connection.close();
