const { Wallet, Contract, utils, Provider } = require("zksync-ethers");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const dotenv = require("dotenv");
const express = require("express");
const { chains } = require("./chains");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

let cronJob;

async function chargeExpiredSubscriptions(logFilePath) {
  const provider = new Provider(chains.inMemoryLocalNode.rpcUrl);
  const wallet = new Wallet(process.env.WALLET_PRIVATE_KEY, provider);

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

const logFilePath = path.resolve(__dirname, "cron.log");

function startCronJob() {
  cronJob = cron.schedule(
    "2 0 * * *", // Runs every midnight at 12:00:02 AM UTC
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
  console.log("Cron job started");
}

function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    console.log("Cron job stopped");
  }
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Start cron job endpoint
app.post("/start", (req, res) => {
  startCronJob();
  res.status(200).json({ message: "Cron job started" });
});

// Stop cron job endpoint
app.post("/stop", (req, res) => {
  stopCronJob();
  res.status(200).json({ message: "Cron job stopped" });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
