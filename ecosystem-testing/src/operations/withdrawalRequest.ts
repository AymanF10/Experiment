import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  PROGRAM_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
} from "../config/constants.js";
import { findEcosystemConfigPda } from "../utils/pda.js";
import { sendAndConfirmTransactionWithRetry } from "../utils/helpers.js";
import {
  WithdrawalConfig,
  OperationResult,
  GlobalOptions,
} from "../types/index.js";

export async function createWithdrawalRequest(
  connection: Connection,
  payer: Keypair,
  config: WithdrawalConfig,
  options: GlobalOptions = { maxRetries: 3, fastMode: false, verbose: false }
): Promise<OperationResult> {
  console.log("\nCreating withdrawal req");

  const ecosystemMint = new PublicKey(config.ecosystemMint);
  const merchantWallet = config.merchantWallet
    ? new PublicKey(config.merchantWallet)
    : payer.publicKey;

  const [ecosystemConfigPda] = findEcosystemConfigPda(ecosystemMint);

  const [merchantBalancePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("merchant_balance"),
      merchantWallet.toBuffer(),
      ecosystemMint.toBuffer(),
    ],
    new PublicKey(PROGRAM_CONFIG.PROGRAM_ID)
  );

  const [withdrawalRequestPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("withdrawal_request"),
      merchantWallet.toBuffer(),
      ecosystemConfigPda.toBuffer(),
    ],
    new PublicKey(PROGRAM_CONFIG.PROGRAM_ID)
  );

  console.log(`Merchant balance PDA: ${merchantBalancePda.toString()}`);
  console.log(`Withdrawal req PDA: ${withdrawalRequestPda.toString()}`);

  const data = Buffer.from(
    INSTRUCTION_DISCRIMINATORS.CREATE_WITHDRAWAL_REQUEST
  );

  const accounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: merchantBalancePda, isSigner: false, isWritable: false },
    { pubkey: ecosystemConfigPda, isSigner: false, isWritable: false },
    { pubkey: ecosystemMint, isSigner: false, isWritable: false },
    { pubkey: withdrawalRequestPda, isSigner: false, isWritable: true },
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

  console.log(`Withdrawal req created`);
  console.log(`Withdrawal request PDA ${withdrawalRequestPda.toString()}`);
  return { signature };
}
