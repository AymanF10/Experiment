import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getTokenProgram } from "../utils/connection.js";
import {
  waitForConfirmation,
  sendAndConfirmTransactionWithRetry,
} from "../utils/helpers.js";
import { CreateTokenAccountResult } from "../types/index.js";

export async function createTokenAccount(
  connection: Connection,
  payer: Keypair,
  mintAddress: PublicKey
): Promise<CreateTokenAccountResult> {
  console.log("\nCreating Token Account");
  console.log(`For mint: ${mintAddress.toString()}`);

  const tokenProgram = await getTokenProgram(connection, mintAddress);

  const ata = await getAssociatedTokenAddress(
    mintAddress,
    payer.publicKey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log(`Token account: ${ata.toString()}`);

  const accountInfo = await connection.getAccountInfo(ata);
  if (accountInfo) {
    console.log("Token account already exists");
    return { tokenAccount: ata, signature: null };
  }

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    payer.publicKey,
    mintAddress,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const transaction = new Transaction().add(ix);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;

  transaction.sign(payer);

  // const signature = await connection.sendRawTransaction(
  //   transaction.serialize()
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

  console.log(`Token account: ${ata.toString()}`);
  return { tokenAccount: ata, signature };
}
