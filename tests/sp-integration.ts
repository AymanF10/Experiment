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
  const deployerAta = new PublicKey("Dt1xGJ1mhuSPcVXgBx1EZtWWHTbEVq24wVcroWF1ib8c");

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
  })


  it("Initialize Config", async () => {
    // Get The Config PDA
    const [configPDA, configBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        tokenDeployerProgram.programId
    );

    // Call instruction
    await tokenDeployerProgram.methods
        .initialize()
        .accounts({
            payer: configOwner.publicKey,
            //ts-ignore
            config: configPDA,
            systemProgram: SystemProgram.programId
        })
        .signers([configOwner])
        .rpc();
  })

  it("Create Ecosystem ", async () => {

    // Create Mints
    await createMint(
      provider.connection,
      deployer.payer,
      deployer.publicKey,
      deployer.publicKey,
      9,
      collateralToken,
      null,
      TOKEN_2022_PROGRAM_ID,
    );

    await createMint(
      provider.connection,
      deployer.payer,
      deployer.publicKey,
      deployer.publicKey,
      9,
      spToken,
      null,
      TOKEN_2022_PROGRAM_ID
    );

    // Get The PDAs
    const [configPDA, configBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        tokenDeployerProgram.programId
    );
    const [mintAuthorityPda, mintAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    const [ecosystemConfigPda, ecosystemConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("ecosystem_config"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
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

    const [splAuthorityPda, splAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("spl_authority"), spToken.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );

    // Get Instruction Arguments
    const decimals = 9;
    const name = "Bonk";
    const symbol = "BONK";
    const uri = "https://example.com/metadata.json"; // ToDo - test with correct JSON metadata format
    const transferHookProgramId = transferHookProgram.programId;
    const maxMintingCap = new anchor.BN(1000 * 10 ** decimals);
    const withdrawalFee = 2000; // 20% fee (2000 basis points)
    const depositFee = 2000; // 20% fee (2000 basis points)

    // Call Instruction
    await tokenDeployerProgram.methods
      .createEcosystem({
        decimals,
        name,
        symbol,
        uri,
        transferHookProgramId,
        ecosystemPartnerWallet: ecosystemPartner.publicKey,
        maxMintingCap,
        withdrawalFeeBasisPoints: withdrawalFee,
        depositFeeBasisPoints: depositFee,
        collateralTokenMint: collateralToken.publicKey, 
      })
      .accounts({
        config: configPDA,
        payer: configOwner.publicKey,
        mintAccount: mintAccount.publicKey,
        mintAuthority: mintAuthorityPda,
        ecosystemConfig: ecosystemConfigPda,
        spMint: spToken.publicKey,
        feeVaultAuthority: feeVaultAuthorityPda,
        collateralTokenMint: collateralToken.publicKey,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId, 
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([configOwner, mintAccount])
      .rpc({ commitment: "confirmed"});

  })

  it("Initialize SP Token From The SP Program", async () => {

    // Initialize Mint
    await utils.initializeMint(spreePointsProgram, deployer, usdcMint, pdaMap);
  })

  it("Initialize SP Token Mint Keeper", async () => {

    // Initialize Mint Keeper
    await utils.initializeMintKeeper(spreePointsProgram, deployer, pdaMap);
  })

  it("Initialize Config", async () => {

    // Init Config
    await utils.initializeConfig(spreePointsProgram, deployer, pdaMap);
  })

  it("Add Deployer To Whitelist", async () => {

    // Add Deployer to Whitelist
    await utils.addToMintWhitelist(spreePointsProgram, deployer, deployerAta, pdaMap);
  })

  it("Initialize Freeze Account", async () => {

    //
    await utils.initializeFreeze(spreePointsProgram, deployer, pdaMap);
  })

  it("Deposit Into Ecosystem", async () => {
    // Get The PDAs
    const [configPDA, configBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        tokenDeployerProgram.programId
    );
    const [mintAuthorityPda, mintAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    const [ecosystemConfigPda, ecosystemConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("ecosystem_config"), mintAccount.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
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

    /*const [splAuthorityPda, splAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("spl_authority"), spToken.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    

    const [feesPda, feesBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("FEES_SEED")],
      spreePointsProgram.programId
    );
    const [freezePDA, freezeBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("FREEZE_SEED")],
      spreePointsProgram.programId
    );
    const [whitelistStatusPda, whitelistStatusBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("MINT_WHITELIST_SEED"), splMintAuthority.publicKey.toBuffer()],
      spreePointsProgram.programId
    );*/

    // SET UP INSTRUCTIONS FOR THE SP TOKEN
    

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

    // Create USDC Mint ::: Already Created
    /*await createMint(
      provider.connection,
      deployer.payer,
      swapMintAuthorityPda,
      swapMintAuthorityPda,
      9,
      usdcMint,
      null,
      TOKEN_2022_PROGRAM_ID
    );*/

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
      //.signers([ecosystemPartner])
      .instruction();

    const routeData = Buffer.from(routeTx.data);
    /*const routeMetas = routeTx.keys.map(k => ({
      pubkey: k.pubkey,
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    }));*/

    const routeMetas = routeTx.keys.map(meta => {
    // This is the fix. The payer is already signing the transaction, so we
    // explicitly mark it as not a signer in the remainingAccounts list
    // to prevent the conflict. The CPI will still see the signature.
    if (meta.pubkey.equals(ecosystemPartner.publicKey)) {
        return { ...meta, isSigner: false };
    }
    return meta;
});


    // Build Deposit Tx
    const anchorDepositIx = await tokenDeployerProgram.methods
      .depositEcosystem(new BN(depositAmount), routeData)
      .accounts({
        payer: ecosystemPartner,
        config: configPDA,
        mintAccount: mintAccount.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerUspTokenAta,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralToken.publicKey,
        userCollateralAccount: ecosystemPartnerCollateralAta,
        feeVault: feeVaultPda,
        spMint: pdaMap.mint,
        spMintAuthority: deployer.publicKey,
        usdcReceiveSwapAta: usdcFeeSwapReceiverAta,
        usdcMint: usdcMint,
        usdcKeeper: usdcKeeperAta,
        fees: fees.publicKey,
        feesCollector: feesCollector.publicKey,
        freezeState: deployer.publicKey,
        whitelistStatus: deployer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        tokenProgramInterface: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        spProgram: spreePointsProgram.programId,
        jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      })
      //.signers([ecosystemPartner])
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
    console.log("Deposit suceeded: ", signature);
  })
})