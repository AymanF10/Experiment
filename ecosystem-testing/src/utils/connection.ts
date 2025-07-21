import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import { PROGRAM_CONFIG } from "../config/constants.js";

export function createConnection(
  url: string,
  commitment: Commitment = "confirmed"
): Connection {
  console.log(`Connecting to: ${url}`);
  return new Connection(url, commitment);
}

export async function getTokenProgram(
  connection: Connection,
  mintAddress: PublicKey
): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mintAddress);
  if (!mintInfo) {
    throw new Error(`Mint not found: ${mintAddress.toString()}`);
  }

  if (mintInfo.owner.toString() === PROGRAM_CONFIG.TOKEN_2022_PROGRAM_ID) {
    console.log("Using Token-2022 program");
    return mintInfo.owner;
  } else if (
    mintInfo.owner.toString() === PROGRAM_CONFIG.SPL_TOKEN_PROGRAM_ID
  ) {
    console.log("Using Legacy Token program");
    return mintInfo.owner;
  } else {
    throw new Error("Mint owner is not a recognized token program");
  }
}
