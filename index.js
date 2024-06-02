const { Wallet, Contract, utils, Provider } = require("zksync-ethers");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const dotenv = require("dotenv");
const { chains } = require("./chains");

dotenv.config();

async function chargeExpiredSubscriptions(logFilePath) {
  const provider = new Provider(chains.inMemoryLocalNode.rpcUrl);
  const wallet = new Wallet(process.env.OWNER_WALLET_PRIVATE_KEY, provider);

  const subscriptionManagerAddress = process.env.SUBSCRIPTION_MANAGER_ADDRESS;
  const subscriptionManagerArtifact = require("./artifacts-zk/contracts/SubscriptionManager.sol/SubscriptionManager.json");

  const subscriptionManager = new Contract(
    subscriptionManagerAddress,
    subscriptionManagerArtifact.abi,
    wallet
  );

  const startTime = new Date().toISOString();
  console.log(`[${startTime}] Charging expired subscriptions...`);

  let chargeExpiredTx =
    await subscriptionManager.populateTransaction.chargeExpiredSubscriptions();

  chargeExpiredTx = {
    ...chargeExpiredTx,
    from: wallet.address,
    chainId: (await provider.getNetwork()).chainId,
    nonce: await provider.getTransactionCount(wallet.address),
    type: 113,
    customData: {
      gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
    },
    value: ethers.BigNumber.from(0),
  };

  chargeExpiredTx.gasPrice = await provider.getGasPrice();
  chargeExpiredTx.gasLimit = await provider.estimateGas(chargeExpiredTx);

  const txCost = chargeExpiredTx.gasPrice.mul(chargeExpiredTx.gasLimit);

  console.log(
    `[${startTime}] Estimated gas: ${chargeExpiredTx.gasLimit.toString()}`
  );
  console.log(
    `[${startTime}] Gas price: ${ethers.utils.formatUnits(
      chargeExpiredTx.gasPrice,
      "gwei"
    )} gwei`
  );
  console.log(
    `[${startTime}] Estimated transaction cost: ${ethers.utils.formatEther(
      txCost
    )} ETH`
  );

  const tx = await wallet.sendTransaction(chargeExpiredTx);
  console.log("Transaction sent. Waiting for confirmation...");
  await tx.wait();

  const endTime = new Date().toISOString();
  console.log(`[${endTime}] Expired subscriptions charged successfully`);

  const logMessage =
    `[${startTime}] Charging expired subscriptions...\n` +
    `[${startTime}] Estimated gas: ${chargeExpiredTx.gasLimit.toString()}\n` +
    `[${startTime}] Gas price: ${ethers.utils.formatUnits(
      chargeExpiredTx.gasPrice,
      "gwei"
    )} gwei\n` +
    `[${startTime}] Estimated transaction cost: ${ethers.utils.formatEther(
      txCost
    )} ETH\n` +
    `[${endTime}] Expired subscriptions charged successfully\n\n`;

  fs.appendFileSync(logFilePath, logMessage);
}

// Get the absolute path to the log file
const logFilePath = path.resolve(__dirname, "cron.log");

// Commented out: Schedule the cron job to run every day at 12:00:02 AM UTC
cron.schedule(
  "2 0 * * *",
  async () => {
    try {
      await chargeExpiredSubscriptions(logFilePath);
    } catch (error) {
      console.error("Error charging expired subscriptions:", error);
      fs.appendFileSync(
        logFilePath,
        `[${new Date().toISOString()}] Error: ${error.message}\n\n`
      );
    }
  },
  {
    scheduled: true,
    timezone: "UTC",
  }
);
