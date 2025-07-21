import minimist from "minimist";
import path from "path";
import os from "os";
import { PublicKey } from "@solana/web3.js";
import { loadKeypair } from "./utils/keypair.js";
import { createConnection } from "./utils/connection.js";
import { initializeConfig } from "./operations/initialize.js";
import { createEcosystem } from "./operations/createEcosystem.js";
import { createTokenAccount } from "./operations/createTokenAccount.js";
import { depositEcosystem } from "./operations/depositEcosystem.js";
import { addApprover, removeApprover } from "./operations/manageApprovers.js";
import { createWithdrawalRequest } from "./operations/withdrawalRequest.js";
import { approveWithdrawalRequest } from "./operations/approveWithdrawal.js";
import { checkMerchantBalance } from "./operations/debugAccounts.js";
import { DEFAULT_CONFIG } from "./config/constants.js";
import {
  CliArgs,
  EcosystemConfig,
  DepositConfig,
  ApproverConfig,
  ApprovalConfig,
  WithdrawalConfig,
} from "./types/index.js";

/**
 * Args for running oerations - differ for different operations. For details check the readme
 */
const argv = minimist(process.argv.slice(2), {
  string: [
    "keypair",
    "url",
    "decimals",
    "name",
    "symbol",
    "uri",
    "transfer-hook-program-id",
    "ecosystem-partner-wallet",
    "max-minting-cap",
    "withdrawal-fee-basis-points",
    "deposit-fee-basis-points",
    "collateral-token-mint",
    "ecosystem-mint",
    "user-collateral-account",
    "amount",
    "approver-address",
    "merchant-wallet",
    "merchant-token-account",
  ],
  boolean: ["verbose", "help"],
  default: {
    // keypair: path.join(os.homedir(), ".config/solana/id.json"),
    keypair: DEFAULT_CONFIG.keypair,
    url: DEFAULT_CONFIG.url,
    decimals: "5",
    name: "Test Ecosystem Token",
    symbol: "TEST",
    uri: "",
    "max-minting-cap": "1000000000000",
    "withdrawal-fee-basis-points": "0",
    "deposit-fee-basis-points": "0",
    amount: "1000000",
    verbose: false,
  },
}) as CliArgs;

async function main(): Promise<void> {
  const command = argv._[0];

  try {
    const payer = loadKeypair(argv.keypair);
    const connection = createConnection(argv.url);

    console.log(`\nEcosystem CLI`);
    console.log(`Command: ${command}`);
    console.log(`Network: ${argv.url}`);
    console.log(`Payer: ${payer.publicKey.toString()}\n`);

    switch (command) {
      case "initialize":
        await initializeConfig(connection, payer);
        break;

      case "create-ecosystem":
        await handleCreateEcosystem(connection, payer);
        break;

      case "create-token-account":
        await handleCreateTokenAccount(connection, payer);
        break;

      case "deposit":
        await handleDeposit(connection, payer);
        break;

      case "add-approver":
        await handleAddApprover(connection, payer);
        break;

      case "remove-approver":
        await handleRemoveApprover(connection, payer);
        break;

      case "request-withdrawal":
        await handleCreateWithdrawalRequest(connection, payer);
        break;

      case "approve-withdrawal":
        await handleApproveWithdrawal(connection, payer);
        break;

      case "check-balance":
        await handleCheckBalance(connection, payer);
        break;

      case "run-all":
        await runAllSteps(connection, payer);
        break;

      default:
        console.error(`unkown command: ${command}`);
        process.exit(1);
    }

    console.log("\nOperation completed");
    process.exit(1);
  } catch (error) {
    console.error("\n Err ", (error as Error).message);
    if (argv.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function handleCreateEcosystem(
  connection: any,
  payer: any
): Promise<void> {
  if (!argv["collateral-token-mint"]) {
    throw new Error("--collateral-token-mint is required");
  }

  const config: EcosystemConfig = {
    decimals: argv.decimals,
    name: argv.name,
    symbol: argv.symbol,
    uri: argv.uri,
    transferHookProgramId: argv["transfer-hook-program-id"],
    ecosystemPartnerWallet: argv["ecosystem-partner-wallet"],
    maxMintingCap: argv["max-minting-cap"],
    withdrawalFeeBasisPoints: argv["withdrawal-fee-basis-points"],
    depositFeeBasisPoints: argv["deposit-fee-basis-points"],
    collateralTokenMint: argv["collateral-token-mint"],
  };

  await createEcosystem(connection, payer, config);
}

async function handleCreateTokenAccount(
  connection: any,
  payer: any
): Promise<void> {
  if (!argv["ecosystem-mint"]) {
    throw new Error("--ecosystem-mint is required");
  }

  const mintAddress = new PublicKey(argv["ecosystem-mint"]);
  await createTokenAccount(connection, payer, mintAddress);
}

async function handleDeposit(connection: any, payer: any): Promise<void> {
  if (!argv["ecosystem-mint"]) {
    throw new Error("--ecosystem-mint is required");
  }
  if (!argv["user-collateral-account"]) {
    throw new Error("--user-collateral-account is required");
  }

  const config: DepositConfig = {
    ecosystemMint: argv["ecosystem-mint"],
    userCollateralAccount: argv["user-collateral-account"],
    amount: argv.amount,
  };

  await depositEcosystem(connection, payer, config);
}

async function handleAddApprover(connection: any, payer: any): Promise<void> {
  if (!argv["approver-address"]) {
    throw new Error("--approver-address is required");
  }

  const config: ApproverConfig = {
    approverAddress: argv["approver-address"],
  };

  await addApprover(connection, payer, config);
}

async function handleRemoveApprover(
  connection: any,
  payer: any
): Promise<void> {
  if (!argv["approver-address"]) {
    throw new Error("--approver-address is required");
  }

  const config: ApproverConfig = {
    approverAddress: argv["approver-address"],
  };

  await removeApprover(connection, payer, config);
}

async function handleCreateWithdrawalRequest(
  connection: any,
  payer: any
): Promise<void> {
  if (!argv["ecosystem-mint"]) {
    throw new Error("--ecosystem-mint is required");
  }

  const config: WithdrawalConfig = {
    ecosystemMint: argv["ecosystem-mint"],
    merchantWallet: argv["merchant-wallet"] || undefined,
  };

  await createWithdrawalRequest(connection, payer, config);
}

async function handleApproveWithdrawal(
  connection: any,
  payer: any
): Promise<void> {
  if (!argv["ecosystem-mint"]) {
    throw new Error("--ecosystem-mint is required");
  }
  if (!argv["merchant-wallet"]) {
    throw new Error("--merchant-wallet is required");
  }
  if (!argv["merchant-token-account"]) {
    throw new Error("--merchant-token-account is required");
  }

  const config: ApprovalConfig = {
    ecosystemMint: argv["ecosystem-mint"],
    merchantWallet: argv["merchant-wallet"],
    merchantTokenAccount: argv["merchant-token-account"],
  };

  await approveWithdrawalRequest(connection, payer, config);
}

async function handleCheckBalance(connection: any, payer: any): Promise<void> {
  if (!argv["ecosystem-mint"]) {
    throw new Error("--ecosystem-mint is required");
  }

  const merchantWallet = argv["merchant-wallet"] || payer.publicKey.toString();

  await checkMerchantBalance(
    connection,
    argv["ecosystem-mint"],
    merchantWallet
  );
}

async function runAllSteps(connection: any, payer: any): Promise<void> {
  console.log("🔄 Running all steps in sequence...\n");

  if (!argv["collateral-token-mint"]) {
    throw new Error("--collateral-token-mint is required for run-all");
  }

  await initializeConfig(connection, payer);

  const ecosystemConfig: EcosystemConfig = {
    decimals: argv.decimals,
    name: argv.name,
    symbol: argv.symbol,
    uri: argv.uri,
    transferHookProgramId: argv["transfer-hook-program-id"],
    ecosystemPartnerWallet: argv["ecosystem-partner-wallet"],
    maxMintingCap: argv["max-minting-cap"],
    withdrawalFeeBasisPoints: argv["withdrawal-fee-basis-points"],
    depositFeeBasisPoints: argv["deposit-fee-basis-points"],
    collateralTokenMint: argv["collateral-token-mint"],
  };

  const { mint } = await createEcosystem(connection, payer, ecosystemConfig);

  await createTokenAccount(connection, payer, mint);

  if (argv["user-collateral-account"]) {
    const depositConfig: DepositConfig = {
      ecosystemMint: mint.toString(),
      userCollateralAccount: argv["user-collateral-account"],
      amount: argv.amount,
    };

    await depositEcosystem(connection, payer, depositConfig);
  } else {
    console.log("\n Skipping deposit (no --user-collateral-account arg)");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
