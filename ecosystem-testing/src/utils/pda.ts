import { PublicKey } from "@solana/web3.js";
import { PROGRAM_CONFIG, SEEDS } from "../config/constants.js";
import { PdaResult } from "../types/index.js";

const PROGRAM_PUBLIC_KEY = new PublicKey(PROGRAM_CONFIG.PROGRAM_ID);

export function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.CONFIG)],
    PROGRAM_PUBLIC_KEY
  );
}

export function findMintAuthorityPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.MINT_AUTHORITY), mint.toBuffer()],
    PROGRAM_PUBLIC_KEY
  );
}

export function findEcosystemConfigPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.ECOSYSTEM_CONFIG), mint.toBuffer()],
    PROGRAM_PUBLIC_KEY
  );
}

export function findFeeVaultAuthorityPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.FEE_VAULT_AUTHORITY), mint.toBuffer()],
    PROGRAM_PUBLIC_KEY
  );
}

export function findFeeVaultPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.FEE_VAULT), mint.toBuffer()],
    PROGRAM_PUBLIC_KEY
  );
}

export function findCollateralVaultPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.COLLATERAL_VAULT), mint.toBuffer()],
    PROGRAM_PUBLIC_KEY
  );
}
