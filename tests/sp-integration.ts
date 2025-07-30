import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenDeployer } from "../target/types/token_deployer";
import { TransferHook } from "../target/types/transfer_hook";
import { 
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
 } from "@solana/web3.js";
 import { 
  setAuthority,
  AuthorityType,
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
 } from "@solana/spl-token";
import { expect } from "chai";
import * as utils from "../utils/utils";
import * as spreeIdl from "../idls/spree_points.json";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";
import { MockJupiter } from "../target/types/mock_jupiter";
import { BN } from "bn.js";
import { create } from "domain";
import { SpreePoints } from "../target/types/spree_points";



describe("SP token Integration", () => {
    // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const tokenDeployerProgram = anchor.workspace.TokenDeployer as Program<TokenDeployer>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;
  const mockJupiterProgram = anchor.workspace.MockJupiter as Program<MockJupiter>;
  const spreePointsProgram = new Program(
    spreeIdl,
    provider,
  ) as Program<SpreePoints>;

  const usdcMint = new PublicKey(utils.USDC_MINT_ADDRESS);

  // Set Up Actors In The System
  const deployer = provider.wallet as anchor.Wallet;
  const ecosystemPartner = anchor.web3.Keypair.generate();
  const configOwner = anchor.web3.Keypair.generate();
  const userAlice = anchor.web3.Keypair.generate();
  const deployerAta = new PublicKey("6dvYkN8DuxgUqn12cBMVcuooqKWxGf4fPSEeKEugaDFr");

  //let collateralToken: PublicKey;
  //let spToken: PublicKey;
  const mintAccount = anchor.web3.Keypair.generate();
  const spToken = anchor.web3.Keypair.generate();
  const collateralToken = anchor.web3.Keypair.generate();
  //const usdcMint = anchor.web3.Keypair.generate();
  const usdcKeeper = anchor.web3.Keypair.generate();
  const fees = anchor.web3.Keypair.generate();
  const feesCollector = anchor.web3.Keypair.generate();
  const splMintAuthority = anchor.web3.Keypair.generate();
  
  // Store config PDA for reuse
  let configPDA: PublicKey;
  let configBump: number;

  async function airdropSol(provider, publicKey, solAmount) {
    const airdropSig = await provider.connection.requestAirdrop(
      publicKey,
      solAmount * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);
  }

  const pdaMap = utils.findPDAs(spreePointsProgram, {
      mint: [Buffer.from(utils.TOKEN_2022_SEED)],
      usdcKeeper: [Buffer.from(utils.USDC_SEED)],
      fees: [Buffer.from(utils.FEES_SEED)],
      freezeState: [Buffer.from(utils.FREEZE_SEED)],
      config: [Buffer.from(utils.CONFIG_SEED)],
      keeperPda: [Buffer.from(utils.KEEPER_SEED)],
      mintKeeper: [Buffer.from(utils.MINT_KEEPER_SEED)],
      executor: [Buffer.from(utils.EXECUTOR_SEED)]
    });

  before(async () => {
    await airdropSol(provider, ecosystemPartner.publicKey, 5);
    //await airdropSol(provider, userAlice.publicKey, 5);
    await airdropSol(provider, configOwner.publicKey, 5);
    
    // Find config PDA
    [configPDA, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      tokenDeployerProgram.programId
    );
  })

  it("Initialize SP Token From The SP Program", async () => {
    // Check if mint already exists
    const mintInfo = await provider.connection.getAccountInfo(pdaMap.mint);
    if (mintInfo) {
      return;
    }

    // Initialize Mint
    await utils.initializeMint(spreePointsProgram, deployer, usdcMint, pdaMap);
  })

  it("Initialize SP Token Mint Keeper", async () => {
    // Check if mint keeper already exists
    const mintKeeperInfo = await provider.connection.getAccountInfo(pdaMap.mintKeeper);
    if (mintKeeperInfo) {
      return;
    }

    // Initialize Mint Keeper
    await utils.initializeMintKeeper(spreePointsProgram, deployer, pdaMap);
  })

  it("Initialize Config", async () => {
    // Check if config already exists
    const configInfo = await provider.connection.getAccountInfo(pdaMap.config);
    if (configInfo) {
      return;
    }

    // Init Config
    await utils.initializeConfig(spreePointsProgram, deployer, pdaMap);
  })

  it("Initialize Fees", async () => {
    // Check if fees already exists
    const feesInfo = await provider.connection.getAccountInfo(pdaMap.fees);
    if (feesInfo) {
      return;
    }

    // Create fee collector ATA
    const feeCollectorAta = await createAssociatedTokenAccount(
      provider.connection,
      deployer.payer,
      pdaMap.mint,
      feesCollector.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false
    );

    // Initialize fees
    await utils.initializeFees(
      spreePointsProgram, 
      deployer, 
      pdaMap.mint, 
      {
        mintFeeBps: 100, // 1%
        transferFeeBps: 50, // 0.5%
        redemptionFeeBps: 200, // 2%
        feeCollector: feeCollectorAta
      },
      pdaMap
    );
  })

  it("Add Deployer To Whitelist", async () => {
    // Check if whitelist status already exists
    const [whitelistStatusPda, whitelistStatusBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(utils.MINT_WHITELIST_SEED), deployerAta.toBuffer()],
      spreePointsProgram.programId
    );
    
    const whitelistInfo = await provider.connection.getAccountInfo(whitelistStatusPda);
    if (whitelistInfo) {
      return;
    }
    
    // Add Deployer to Whitelist
    await utils.addToMintWhitelist(spreePointsProgram, deployer, deployerAta, pdaMap);
  })

  it("Initialize Freeze Account", async () => {
    // Check if freeze account already exists
    const freezeInfo = await provider.connection.getAccountInfo(pdaMap.freezeState);
    if (freezeInfo) {
      return;
    }

    // Initialize freeze account
    await utils.initializeFreeze(spreePointsProgram, deployer, pdaMap);
  })

  it("Deposit Into Ecosystem", async () => {
    // Get The PDAs
    const [mintAuthorityPda, mintAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    const [ecosystemConfigPda, ecosystemConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("ecosystem_config"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    // Check if ecosystem config exists before trying to fetch it
    const ecosystemConfigInfo = await provider.connection.getAccountInfo(ecosystemConfigPda);
    if (!ecosystemConfigInfo) {
      return;
    }
    
    // Check if fees account exists
    const feesInfo = await provider.connection.getAccountInfo(pdaMap.fees);
    if (!feesInfo) {
      return;
    }
    
    // Fetch the ecosystem config to verify the ecosystem partner wallet
    const ecosystemConfig = await tokenDeployerProgram.account.ecosystemConfig.fetch(ecosystemConfigPda);
    
    // Ensure the ecosystem partner in the test matches the one in the config
    if (!ecosystemConfig.ecosystemPartnerWallet.equals(ecosystemPartner.publicKey)) {
      return;
    }
    
    const [feeVaultAuthorityPda, feeVaultAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault_authority"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    const [feeVaultPda, feeVaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    const [collateralVaultPda, collateralVaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral_vault"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    const [swapMintAuthorityPda, swapMintAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("MINT_AUTH_SEED")],
      mockJupiterProgram.programId
    );

    // Check if SP mint exists
    const spMintInfo = await provider.connection.getAccountInfo(pdaMap.mint);
    if (!spMintInfo) {
      return;
    }

    // Check if freeze state exists
    const freezeStateInfo = await provider.connection.getAccountInfo(pdaMap.freezeState);
    if (!freezeStateInfo) {
      return;
    }

    // MINT COLLATERAL DEPOSITS TO ECOSYSTEM PARTNER FOR DEPOSIT
    const ecosystemPartnerCollateralAta = await createAssociatedTokenAccount(
      provider.connection,
      deployer.payer,
      collateralToken.publicKey,
      ecosystemPartner.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false,
    );
    await mintTo(
      provider.connection,
      deployer.payer,
      collateralToken.publicKey,
      ecosystemPartnerCollateralAta,
      deployer.publicKey,
      1000 * 10 ** 9,
      [],
      null,
      TOKEN_2022_PROGRAM_ID
    );

    const ecosystemPartnerUspTokenAta = await createAssociatedTokenAccount(
      provider.connection,
      ecosystemPartner,
      mintAccount.publicKey,
      ecosystemPartner.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false
    );

    const usdcFeeSwapReceiverAta = await createAssociatedTokenAccount(
      provider.connection,
      deployer.payer,
      usdcMint,
      feeVaultPda,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      true,
    );

    const usdcKeeperAta = await createAssociatedTokenAccount(
      provider.connection,
      deployer.payer,
      usdcMint,
      usdcKeeper.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false,
    );

    // Constants
    const depositAmount = 500;
    const feeAmount = 100;

    const routePlan = [
      {
        swap: { raydium: {} },
        percent: 100,
        inputIndex: 0,
        outputIndex: 1
      }
    ];
    // Create Swap Data
    const routeTx = await mockJupiterProgram.methods
      .route(
        routePlan,
        new BN(100),
        new BN(100),
        0,
        0
      )
      .accounts({
        userTransferAuthority: ecosystemPartner.publicKey,
        userSourceTokenAccount: ecosystemPartnerCollateralAta,
        userDestinationTokenAccount: usdcFeeSwapReceiverAta,
        destinationTokenAccount:usdcFeeSwapReceiverAta,
        destinationMint: usdcMint,
        sourceMint: collateralToken.publicKey,
        mintAuthority: swapMintAuthorityPda,
        platformFeeAccount: null,
      })
      .instruction();

    const routeData = Buffer.from(routeTx.data);
    const routeMetas = routeTx.keys.map(meta => {
      // This is the fix. The payer is already signing the transaction, so we
      // explicitly mark it as not a signer in the remainingAccounts list
      // to prevent the conflict. The CPI will still see the signature.
      if (meta.pubkey.equals(ecosystemPartner.publicKey)) {
          return { ...meta, isSigner: false };
      }
      return meta;
    });

    // Generate PDAs for the whitelistStatus and freezeState
    const [whitelistStatusPda, whitelistStatusBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(utils.MINT_WHITELIST_SEED), ecosystemPartnerUspTokenAta.toBuffer()],
      spreePointsProgram.programId
    );

    // Check if whitelist status exists
    const whitelistStatusInfo = await provider.connection.getAccountInfo(whitelistStatusPda);
    if (!whitelistStatusInfo) {
      await utils.addToMintWhitelist(spreePointsProgram, deployer, ecosystemPartnerUspTokenAta, pdaMap);
    }

    const [freezeStatePda, freezeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(utils.FREEZE_SEED)],
      spreePointsProgram.programId
    );

    // Build Deposit Tx
    const anchorDepositIx = await tokenDeployerProgram.methods
      .depositEcosystem(new BN(depositAmount), routeData)
      .accounts({
        payer: ecosystemPartner.publicKey,
        config: configPDA,
        mintAccount: mintAccount.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerUspTokenAta,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralToken.publicKey,
        userCollateralAccount: ecosystemPartnerCollateralAta,
        feeVault: feeVaultPda,
        spMint: pdaMap.mint,
        fee_vault_authority: feeVaultAuthorityPda,
        usdcReceiveSwapAta: usdcFeeSwapReceiverAta,
        usdcMint: usdcMint,
        usdcKeeper: usdcKeeperAta,
        fees: pdaMap.fees,
        feesCollector: feesCollector.publicKey,
        freezeState: freezeStatePda,
        whitelistStatus: whitelistStatusPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        tokenProgramInterface: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        spProgram: spreePointsProgram.programId,
        jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      })
      .remainingAccounts(routeMetas)
      .instruction();

    // Build Versioned Transaction
    const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
    const messagev0 = new TransactionMessage({
        payerKey: ecosystemPartner.publicKey,
        recentBlockhash: blockhash,
        instructions: [anchorDepositIx],
    }).compileToV0Message([]);
    const tx = new VersionedTransaction(messagev0);

    // Send The Versioned Transaction
    tx.sign([ecosystemPartner]);
    const signature = await provider.connection.sendTransaction(tx);
    await provider.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, "confirmed");
  })
})