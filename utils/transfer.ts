import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  transferCheckedWithTransferHook,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { SP_DECIMALS } from "./constants";
import { TransferHook } from "../target/types/transfer_hook";

/**
 * Transfers tokens using the transfer hook mechanism.
 * @param program - The Anchor program instance.
 * @param wallet - The wallet initiating the transfer.
 * @param amount - The amount of tokens to transfer.
 * @param sourceTokenAccount - The sender's token account.
 * @param destinationTokenAccount - The recipient's token account.
 * @param pdaMap - PDA mapping containing program-related addresses.
 * @returns The transaction signature of the transfer.
 */
export async function transferTokens(
  program: anchor.Program<TransferHook>,
  wallet: anchor.Wallet,
  amount: anchor.BN,
  sourceTokenAccount: PublicKey,
  destinationTokenAccount: PublicKey,
  pdaMap: Record<string, PublicKey>,
): Promise<string> {

  const connection = program.provider.connection;

  const sig = await transferCheckedWithTransferHook(
    connection,
    wallet.payer,
    sourceTokenAccount,
    pdaMap.mint,
    destinationTokenAccount,
    wallet.publicKey,
    BigInt(amount.toString()),
    SP_DECIMALS,
    [],
    null,
    TOKEN_2022_PROGRAM_ID
  );
  
  return sig;
}
