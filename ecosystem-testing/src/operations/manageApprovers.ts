import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  PROGRAM_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
} from "../config/constants.js";
import { findConfigPda } from "../utils/pda.js";
import { sendAndConfirmTransactionWithRetry } from "../utils/helpers.js";
import {
  ApproverConfig,
  OperationResult,
  GlobalOptions,
} from "../types/index.js";

export async function addApprover(
  connection: Connection,
  payer: Keypair,
  config: ApproverConfig,
  options: GlobalOptions = { maxRetries: 3, fastMode: false, verbose: false }
): Promise<OperationResult> {
  console.log("\nAdding approver");
  console.log(`\nPayer: ${payer.publicKey.toString()}`);
  console.log(`Adding approver: ${config.approverAddress}`);

  const [configPda] = findConfigPda();
  const approverPubkey = new PublicKey(config.approverAddress);

  const data = Buffer.concat([
    Buffer.from(INSTRUCTION_DISCRIMINATORS.ADD_APPROVER),
    approverPubkey.toBuffer(),
  ]);

  const accounts = [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
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

  console.log("Signing tx");
  transaction.sign(payer);

  const signature = await sendAndConfirmTransactionWithRetry(
    connection,
    transaction.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: options.maxRetries,
      commitment: "confirmed",
      fastMode: options.fastMode,
    }
  );

  console.log(`Approver added with addr ${config.approverAddress}`);
  return { signature };
}

export async function removeApprover(
  connection: Connection,
  payer: Keypair,
  config: ApproverConfig,
  options: GlobalOptions = { maxRetries: 3, fastMode: false, verbose: false }
): Promise<OperationResult> {
  console.log("Removing Approver");
  console.log(`\nPayer: ${payer.publicKey.toString()}`);
  console.log(`Removing approver: ${config.approverAddress}`);

  const [configPda] = findConfigPda();
  const approverPubkey = new PublicKey(config.approverAddress);

  const data = Buffer.concat([
    Buffer.from(INSTRUCTION_DISCRIMINATORS.REMOVE_APPROVER),
    approverPubkey.toBuffer(),
  ]);

  const accounts = [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
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

  console.log("Signing tx");
  transaction.sign(payer);

  const signature = await sendAndConfirmTransactionWithRetry(
    connection,
    transaction.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: options.maxRetries,
      commitment: "confirmed",
      fastMode: options.fastMode,
    }
  );

  console.log(`Approver  ${config.approverAddress} removed`);
  return { signature };
}
