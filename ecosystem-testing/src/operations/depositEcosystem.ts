import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  PROGRAM_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
} from "../config/constants.js";
import {
  findConfigPda,
  findMintAuthorityPda,
  findEcosystemConfigPda,
  findFeeVaultPda,
  findCollateralVaultPda,
} from "../utils/pda.js";
import {
  waitForConfirmation,
  sendAndConfirmTransactionWithRetry,
} from "../utils/helpers.js";
import { DepositConfig, OperationResult } from "../types/index.js";

export async function depositEcosystem(
  connection: Connection,
  payer: Keypair,
  config: DepositConfig
): Promise<OperationResult> {
  console.log("\nDepositing");
  console.log(`Using payer ${payer.publicKey.toString()}`);

  const ecosystemMint = new PublicKey(config.ecosystemMint);
  const userCollateralAccount = new PublicKey(config.userCollateralAccount);

  console.log(`Ecosystem Mint: ${ecosystemMint.toString()}`);
  console.log(`User Collateral Account: ${userCollateralAccount.toString()}`);

  const [configPda] = findConfigPda();
  const [mintAuthorityPda] = findMintAuthorityPda(ecosystemMint);
  const [ecosystemConfigPda] = findEcosystemConfigPda(ecosystemMint);
  const [feeVaultPda] = findFeeVaultPda(ecosystemMint);
  const [collateralVaultPda] = findCollateralVaultPda(ecosystemMint);

  const ecosystemConfigInfo = await connection.getAccountInfo(
    ecosystemConfigPda
  );
  if (!ecosystemConfigInfo) {
    throw new Error(`Ecosystem config not found ${ecosystemConfigPda}`);
  }

  const userEcosystemTokenAccount = await findUserEcosystemTokenAccount(
    connection,
    payer.publicKey,
    ecosystemMint
  );

  const ecosystemTokenProgram = (await connection.getAccountInfo(
    ecosystemMint
  ))!.owner;
  const collateralTokenProgram = (await connection.getAccountInfo(
    userCollateralAccount
  ))!.owner;

  const collateralTokenMint = await getCollateralTokenMint(
    connection,
    userCollateralAccount
  );

  const data = buildDepositEcosystemData(config.amount);

  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: config.computeUnits || 400000,
  });

  const accounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: ecosystemMint, isSigner: false, isWritable: true },
    { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: userEcosystemTokenAccount, isSigner: false, isWritable: true },
    { pubkey: ecosystemConfigPda, isSigner: false, isWritable: true },
    { pubkey: collateralTokenMint, isSigner: false, isWritable: false },
    { pubkey: userCollateralAccount, isSigner: false, isWritable: true },
    { pubkey: feeVaultPda, isSigner: false, isWritable: true },
    { pubkey: collateralVaultPda, isSigner: false, isWritable: true },
    { pubkey: ecosystemTokenProgram, isSigner: false, isWritable: false },
    { pubkey: collateralTokenProgram, isSigner: false, isWritable: false },
  ];

  const instruction = {
    programId: new PublicKey(PROGRAM_CONFIG.PROGRAM_ID),
    keys: accounts,
    data,
  };

  const transaction = new Transaction()
    .add(modifyComputeUnits)
    .add(instruction);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;

  transaction.sign(payer);

  // const signature = await connection.sendRawTransaction(
  //   transaction.serialize(),
  //   {
  //     skipPreflight: false,
  //     preflightCommitment: "confirmed",
  //     maxRetries: 5,
  //   }
  // );

  const signature = await sendAndConfirmTransactionWithRetry(
    connection,
    transaction.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    }
  );

  console.log(`Tx sent: ${signature}`);
  await waitForConfirmation(connection, signature);

  try {
    const tokenBalance = await connection.getTokenAccountBalance(
      userEcosystemTokenAccount
    );
    console.log(
      `Updated ecosystem token balance: ${tokenBalance.value.uiAmountString}`
    );
  } catch (error) {
    console.log("Error fetching balance ", (error as Error).message);
  }

  return { signature };
}

async function findUserEcosystemTokenAccount(
  connection: Connection,
  userPublicKey: PublicKey,
  ecosystemMint: PublicKey
): Promise<PublicKey> {
  const tokenAccounts = await connection.getTokenAccountsByOwner(
    userPublicKey,
    { mint: ecosystemMint }
  );

  if (tokenAccounts.value.length === 0) {
    throw new Error("No ecosystem token account");
  }

  const tokenAccount = tokenAccounts.value[0].pubkey;
  console.log(`User ecosystem token account: ${tokenAccount.toString()}`);
  return tokenAccount;
}

async function getCollateralTokenMint(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(tokenAccount);
  if (!accountInfo) {
    throw new Error("Token account was not found");
  }
  return new PublicKey(accountInfo.data.slice(0, 32));
}

function buildDepositEcosystemData(amount: string): Buffer {
  const discriminator = Buffer.from(
    INSTRUCTION_DISCRIMINATORS.DEPOSIT_ECOSYSTEM
  );
  const amountBN = new BN(amount);
  const amountBuffer = Buffer.alloc(8);
  amountBN.toArrayLike(Buffer, "le", 8).copy(amountBuffer);

  return Buffer.concat([discriminator, amountBuffer]);
}
