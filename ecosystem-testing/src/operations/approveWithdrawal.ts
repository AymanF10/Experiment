import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PROGRAM_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
} from "../config/constants.js";
import {
  findConfigPda,
  findEcosystemConfigPda,
  findFeeVaultPda,
} from "../utils/pda.js";
import { sendAndConfirmTransactionWithRetry } from "../utils/helpers.js";
import { getTokenProgram } from "../utils/connection.js";
import {
  ApprovalConfig,
  OperationResult,
  GlobalOptions,
} from "../types/index.js";

// TODO - Move to constants later after verifying if it works correctly
const VAULT_SEED = "vault";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function approveWithdrawalRequest(
  connection: Connection,
  approver: Keypair,
  config: ApprovalConfig,
  options: GlobalOptions = { maxRetries: 5, fastMode: false, verbose: false }
): Promise<OperationResult> {
  console.log("Approving withdrawal");

  const ecosystemMint = new PublicKey(config.ecosystemMint);
  const merchantWallet = new PublicKey(config.merchantWallet);
  const merchantTokenAccount = new PublicKey(config.merchantTokenAccount);
  const outputMint = new PublicKey(USDC_MINT);

  const [configPda] = findConfigPda();
  const [ecosystemConfigPda] = findEcosystemConfigPda(ecosystemMint);
  const [feeVaultPda] = findFeeVaultPda(ecosystemMint);

  const [withdrawalRequestPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("withdrawal_request"),
      merchantWallet.toBuffer(),
      ecosystemConfigPda.toBuffer(),
    ],
    new PublicKey(PROGRAM_CONFIG.PROGRAM_ID)
  );

  const [merchantBalancePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("merchant_balance"),
      merchantWallet.toBuffer(),
      ecosystemMint.toBuffer(),
    ],
    new PublicKey(PROGRAM_CONFIG.PROGRAM_ID)
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED)],
    new PublicKey(PROGRAM_CONFIG.PROGRAM_ID)
  );

  const outputMintProgram = await getTokenProgram(connection, outputMint);

  const vaultOutputTokenAccount = await getAssociatedTokenAddress(
    outputMint,
    vaultPda,
    true,
    outputMintProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log(`Withdrawal req PDA ${withdrawalRequestPda.toString()}`);
  console.log(`Balance PDA ${merchantBalancePda.toString()}`);
  console.log(`Vault PDA ${vaultPda.toString()}`);
  console.log(`Vault output token acc ${vaultOutputTokenAccount.toString()}`);

  const data = Buffer.from(
    INSTRUCTION_DISCRIMINATORS.APPROVE_WITHDRAWAL_REQUEST
  );

  const accounts = [
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: approver.publicKey, isSigner: true, isWritable: true },
    { pubkey: withdrawalRequestPda, isSigner: false, isWritable: true },
    { pubkey: merchantBalancePda, isSigner: false, isWritable: true },
    { pubkey: ecosystemConfigPda, isSigner: false, isWritable: true },
    { pubkey: ecosystemMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: outputMintProgram, isSigner: false, isWritable: false },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: vaultOutputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: merchantTokenAccount, isSigner: false, isWritable: true },
    { pubkey: feeVaultPda, isSigner: false, isWritable: true },
  ];

  const instruction = {
    programId: new PublicKey(PROGRAM_CONFIG.PROGRAM_ID),
    keys: accounts,
    data,
  };

  const transaction = new Transaction().add(instruction);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = approver.publicKey;

  console.log("Signing tx");
  transaction.sign(approver);

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

  console.log(`Req approved for ${config.merchantWallet}`);
  return { signature };
}
