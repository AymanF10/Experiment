import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_CONFIG } from "../config/constants.js";
import { findEcosystemConfigPda } from "../utils/pda.js";

export async function checkMerchantBalance(
  connection: Connection,
  ecosystemMint: string,
  merchantWallet: string
): Promise<void> {
  console.log("merchant balance checks");

  const ecosystemMintPubkey = new PublicKey(ecosystemMint);
  const merchantWalletPubkey = new PublicKey(merchantWallet);

  const [merchantBalancePdaWithMint] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("merchant_balance"),
      merchantWalletPubkey.toBuffer(),
      ecosystemMintPubkey.toBuffer(),
    ],
    new PublicKey(PROGRAM_CONFIG.PROGRAM_ID)
  );

  const [ecosystemConfigPda] = findEcosystemConfigPda(ecosystemMintPubkey);

  console.log(`Ecosystem Mint ${ecosystemMint}`);
  console.log(`Merchant Wallet ${merchantWallet}`);
  console.log(`Ecosystem Config PDA ${ecosystemConfigPda.toString()}`);

  console.log("PDA");
  console.log(`MINT seeds ${merchantBalancePdaWithMint.toString()}`);

  await checkAccountExists(connection, "Balance", merchantBalancePdaWithMint);
}

async function checkAccountExists(
  connection: Connection,
  name: string,
  pubkey: PublicKey
): Promise<void> {
  try {
    const accountInfo = await connection.getAccountInfo(pubkey);
    if (accountInfo) {
      console.log(`${name} already initialized`);
      console.log(`Address ${pubkey.toString()}`);
      console.log(`Owner ${accountInfo.owner.toString()}`);
      console.log(`Data length ${accountInfo.data.length} bytes`);

      if (accountInfo.data.length >= 72) {
        try {
          const merchant = new PublicKey(accountInfo.data.slice(8, 40));
          const balance = accountInfo.data.readBigUInt64LE(40);
          const ecosystemMint = new PublicKey(accountInfo.data.slice(48, 80));

          console.log(`merchant: ${merchant.toString()}`);
          console.log(`balance: ${balance.toString()}`);
          console.log(`ecosystem Mint: ${ecosystemMint.toString()}`);
        } catch (decodeError) {
          console.log(`${decodeError}`);
        }
      } else {
        console.log(
          `Account data too short (${accountInfo.data.length} bytes)`
        );
        console.log(`Raw data: ${accountInfo.data.toString("hex")}`);
      }
    } else {
      console.log(`${name}: does not exist`);
      console.log(` Address: ${pubkey.toString()}`);
    }
  } catch (error) {
    console.log(` ${name}: Error ${(error as Error).message}`);
  }
  console.log("");
}
