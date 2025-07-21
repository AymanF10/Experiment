import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  PROGRAM_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
} from "../config/constants.js";
import { findConfigPda } from "../utils/pda.js";
import {
  waitForConfirmation,
  sendAndConfirmTransactionWithRetry,
} from "../utils/helpers.js";
import { InitializeResult } from "../types/index.js";

export async function initializeConfig(
  connection: Connection,
  payer: Keypair
): Promise<InitializeResult> {
  console.log("\nInitializing config");
  console.log(`\nPayer: ${payer.publicKey.toString()}`);

  const [configPda] = findConfigPda();
  console.log(`Config PDA: ${configPda.toString()}`);

  try {
    const configInfo = await connection.getAccountInfo(configPda);
    if (configInfo) {
      console.log("Config already exists");
      return { configPda, signature: null };
    }
  } catch (error) {
    console.log("Checking if config exists:", (error as Error).message);
  }

  const data = Buffer.from(INSTRUCTION_DISCRIMINATORS.INITIALIZE);

  const accounts = [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const instruction = {
    programId: new PublicKey(PROGRAM_CONFIG.PROGRAM_ID),
    keys: accounts,
    data,
  };

  const transaction = new Transaction().add(instruction);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;

  transaction.partialSign(payer);

  // const signature = await connection.sendRawTransaction(
  //   transaction.serialize()
  // );
  // console.log(`Tx sent: ${signature}`);

  // await waitForConfirmation(connection, signature);

  const signature = await sendAndConfirmTransactionWithRetry(
    connection,
    transaction.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    }
  );

  console.log(
    `Config init successful with owner ${payer.publicKey.toString()}`
  );
  return { configPda, signature };
}
