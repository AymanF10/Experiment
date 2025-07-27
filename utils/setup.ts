import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";


export const getProvider = () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
};

/**
 * Finds multiple PDAs dynamically based on given seeds.
 * @param program The Anchor program instance.
 * @param seedsMap An object where keys are PDA names and values are seed arrays.
 * @returns An object containing PDAs.
 */
export const findPDAs = (program: anchor.Program<any>, seedsMap: Record<string, Buffer[]>) => {
  const pdas: Record<string, PublicKey> = {};
  for (const [key, seeds] of Object.entries(seedsMap)) {
    pdas[key] = PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  }
  return pdas;
};

export const findATAs = (mint: PublicKey, ownersMap: Record<string, PublicKey>) => {
  const ataMap: Record<string, PublicKey> = {};

  for (const [key, owner] of Object.entries(ownersMap)) {
    ataMap[key] = getAssociatedTokenAddressSync(
      mint,
      owner,
      false, // owner is NOT a PDA
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }

  return ataMap;
};

export const getOrCreateAssociatedTokenAddressPDA = async(connection: anchor.web3.Connection, payer: anchor.web3.Signer, mint: PublicKey, owner: PublicKey): Promise<anchor.web3.PublicKey> =>  {
  const walletATAInfo = await connection.getAccountInfo(payer.publicKey);
  if (!walletATAInfo) {
    await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner,
      {},
      TOKEN_2022_PROGRAM_ID,
    );
  }
  const addr = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return addr;
};

export const getOrCreateAssociatedTokenAddressATA = async(connection: anchor.web3.Connection, payer: anchor.web3.Signer, mint: PublicKey, owner: PublicKey): Promise<anchor.web3.PublicKey> =>  {
  const walletATAInfo = await connection.getAccountInfo(payer.publicKey);
  if (!walletATAInfo) {
    await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner,
      {},
      TOKEN_2022_PROGRAM_ID,
    );
  }
  const addr = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return addr
}

export const getTokenBalance = async (connection: Connection, account: PublicKey): Promise<anchor.BN> => {
  const balance = await connection.getTokenAccountBalance(account);
  return new anchor.BN(balance.value.amount);
};

export const getTokenBalanceMintToken = async (connection: Connection, mint, account: PublicKey): Promise<anchor.BN> => {
  const ata = anchor.utils.token.associatedAddress({
    mint: mint,
    owner: account,
  });
  return await getTokenBalance(connection, ata)
}

export const toBN = (amount: number, decimals: number): anchor.BN => {
  return new anchor.BN(amount).mul(new anchor.BN(10).pow(new anchor.BN(decimals)));
}

export const calcFee = (amount: anchor.BN, feeBps: number): anchor.BN => {
  return amount.mul(new anchor.BN(feeBps)).div(new anchor.BN(10000));
}
