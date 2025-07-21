import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  PROGRAM_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
} from "../config/constants.js";
import {
  findConfigPda,
  findMintAuthorityPda,
  findEcosystemConfigPda,
  findFeeVaultAuthorityPda,
  findFeeVaultPda,
  findCollateralVaultPda,
} from "../utils/pda.js";
import {
  writeUint32LE,
  writeBigUint64LE,
  writeUint16LE,
  waitForConfirmation,
  sendAndConfirmTransactionWithRetry,
} from "../utils/helpers.js";
import { getTokenProgram } from "../utils/connection.js";
import { EcosystemConfig, CreateEcosystemResult } from "../types/index.js";

export async function createEcosystem(
  connection: Connection,
  payer: Keypair,
  config: EcosystemConfig
): Promise<CreateEcosystemResult> {
  console.log("\nCreating new ecosystem");
  console.log(`Using payer: ${payer.publicKey.toString()}`);

  validateEcosystemConfig(config);

  const [configPda] = findConfigPda();
  const mintKeypair = Keypair.generate();

  console.log(`New mint: ${mintKeypair.publicKey.toString()}`);

  const [mintAuthorityPda] = findMintAuthorityPda(mintKeypair.publicKey);
  const [ecosystemConfigPda] = findEcosystemConfigPda(mintKeypair.publicKey);
  const [feeVaultAuthorityPda] = findFeeVaultAuthorityPda(
    mintKeypair.publicKey
  );
  const [feeVaultPda] = findFeeVaultPda(mintKeypair.publicKey);
  const [collateralVaultPda] = findCollateralVaultPda(mintKeypair.publicKey);

  console.log(`Mint Authority PDA: ${mintAuthorityPda.toString()}`);
  console.log(`Ecosystem Config PDA: ${ecosystemConfigPda.toString()}`);
  console.log(`Fee Vault PDA: ${feeVaultPda.toString()}`);
  console.log(`Collateral Vault PDA: ${collateralVaultPda.toString()}`);

  const collateralTokenMint = new PublicKey(config.collateralTokenMint);
  const collateralTokenProgram = await getTokenProgram(
    connection,
    collateralTokenMint
  );

  const partnerWallet = config.ecosystemPartnerWallet
    ? new PublicKey(config.ecosystemPartnerWallet)
    : payer.publicKey;

  const data = buildCreateEcosystemData(config, partnerWallet);

  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: config.computeUnits || 400000,
  });

  const accounts = [
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: ecosystemConfigPda, isSigner: false, isWritable: true },
    { pubkey: feeVaultAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: collateralTokenMint, isSigner: false, isWritable: false },
    { pubkey: feeVaultPda, isSigner: false, isWritable: true },
    { pubkey: collateralVaultPda, isSigner: false, isWritable: true },
    {
      pubkey: new PublicKey(PROGRAM_CONFIG.TOKEN_2022_PROGRAM_ID),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: collateralTokenProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const instruction = {
    programId: new PublicKey(PROGRAM_CONFIG.PROGRAM_ID),
    keys: accounts,
    data,
  };

  const transaction = new Transaction()
    .add(modifyComputeUnits)
    .add(instruction);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;

  transaction.sign(payer, mintKeypair);

  // const signature = await connection.sendRawTransaction(
  //   transaction.serialize(),
  //   {
  //     skipPreflight: false,
  //     preflightCommitment: "confirmed",
  //     maxRetries: 5,
  //   }
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

  console.log(`Ecosystem created`);
  console.log(`Mint: ${mintKeypair.publicKey.toString()}`);
  console.log(`Ecosystem Config: ${ecosystemConfigPda.toString()}`);
  console.log(`Fee Vault: ${feeVaultPda.toString()}`);
  console.log(`Collateral Vault: ${collateralVaultPda.toString()}`);

  return {
    mint: mintKeypair.publicKey,
    ecosystemConfig: ecosystemConfigPda,
    feeVault: feeVaultPda,
    collateralVault: collateralVaultPda,
    signature,
  };
}

function validateEcosystemConfig(config: EcosystemConfig): void {
  const required: (keyof EcosystemConfig)[] = ["collateralTokenMint"];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function buildCreateEcosystemData(
  config: EcosystemConfig,
  partnerWallet: PublicKey
): Buffer {
  const discriminator = Buffer.from(
    INSTRUCTION_DISCRIMINATORS.CREATE_ECOSYSTEM
  );
  const decimals = Buffer.from([parseInt(config.decimals || "5")]);

  const nameBytes = Buffer.from(config.name || "Test Ecosystem uSP");
  const nameLen = writeUint32LE(nameBytes.length);

  const symbolBytes = Buffer.from(config.symbol || "uSP");
  const symbolLen = writeUint32LE(symbolBytes.length);

  const uriBytes = Buffer.from(config.uri || "");
  const uriLen = writeUint32LE(uriBytes.length);

  const transferHookProgramId = new PublicKey(
    config.transferHookProgramId || PROGRAM_CONFIG.TRANSFER_HOOK
  );

  const maxMintingCapBuf = writeBigUint64LE(
    config.maxMintingCap || "1000000000000"
  );
  const withdrawalFeeBuf = writeUint16LE(
    parseInt(config.withdrawalFeeBasisPoints || "50")
  );
  const depositFeeBuf = writeUint16LE(
    parseInt(config.depositFeeBasisPoints || "25")
  );
  const collateralMint = new PublicKey(config.collateralTokenMint);

  return Buffer.concat([
    discriminator,
    decimals,
    nameLen,
    nameBytes,
    symbolLen,
    symbolBytes,
    uriLen,
    uriBytes,
    transferHookProgramId.toBuffer(),
    partnerWallet.toBuffer(),
    maxMintingCapBuf,
    withdrawalFeeBuf,
    depositFeeBuf,
    collateralMint.toBuffer(),
  ]);
}
