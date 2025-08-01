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
  const jupiterId = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

  // Set Up Actors In The System
  const ecosystemPartner = provider.wallet as anchor.Wallet;
  const deployer = anchor.web3.Keypair.generate();
  const configOwner = anchor.web3.Keypair.generate();
  
  const ecosystemPartnerAta = new PublicKey("Dt1xGJ1mhuSPcVXgBx1EZtWWHTbEVq24wVcroWF1ib8c");

 
  const mintAccount = anchor.web3.Keypair.generate();
  
  const collateralToken = anchor.web3.Keypair.generate();
 
  const usdcKeeper = anchor.web3.Keypair.generate();
  const fees = anchor.web3.Keypair.generate();
  const feesCollector = anchor.web3.Keypair.generate();
  //const payer_sp_ata = anchor.web3.Keypair.generate();


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
    await airdropSol(provider, deployer.publicKey, 5);
    //await airdropSol(provider, userAlice.publicKey, 5);
    await airdropSol(provider, configOwner.publicKey, 5);
  })


  before("Trying BeforeEach Works on Successful Ecosystem Creation", async () => {
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
        .rpc({ commitment: "confirmed"});

      // Bring Ecosystem Creation
      // Create Mints
    await createMint(
      provider.connection,
      deployer,
      deployer.publicKey,
      deployer.publicKey,
      9,
      collateralToken,
      null,
      TOKEN_2022_PROGRAM_ID,
    );

    //console.log("CREATED COLLATERAL TOKEN: ", collateralToken);

    await utils.initializeMint(spreePointsProgram, ecosystemPartner, usdcMint, pdaMap);


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
/*
    const [splAuthorityPda, splAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("spl_authority"), pdaMap.mint.toBuffer()],
      tokenDeployerProgram.programId
    );*/

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
        spMint: pdaMap.mint,
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

  it("Initialize SP Token Mint Keeper", async () => {

    // Initialize Mint Keeper
    await utils.initializeMintKeeper(spreePointsProgram, ecosystemPartner, pdaMap);
  })

  it("Initialize Config", async () => {

    // Init Config
    await utils.initializeConfig(spreePointsProgram, ecosystemPartner, pdaMap);
  })

  it("Add Deployer To Whitelist", async () => {

    // Create deployer’s SP-token ATA
    const deployerAta = await createAssociatedTokenAccount(
      provider.connection,
      deployer,                       // payer & signer
      pdaMap.mint,                    // SP mint PDA
      deployer.publicKey,             // owner of the ATA
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false
    );
  
    // Add Deployer to Whitelist
    await utils.addToMintWhitelist(
      spreePointsProgram,
      ecosystemPartner,
      deployerAta,
      pdaMap
    );
  });

  it("Initialize Freeze Account", async () => {

    //
    await utils.initializeFreeze(spreePointsProgram, ecosystemPartner, pdaMap);
  })

  it("Initialize Fees and Fee Collector", async () => {

    const feeCollectorAta = await createAssociatedTokenAccount(
      provider.connection,
      deployer,
      pdaMap.mint,
      feesCollector.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false
    );
    await utils.initializeFees(
      spreePointsProgram, 
      ecosystemPartner, 
      pdaMap.mint, 
      {
        mintFeeBps: 0,
        transferFeeBps: 0, // 0.5%
        redemptionFeeBps: 0, // 2%
        feeCollector: feeCollectorAta
      },
      pdaMap
    );
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
    const [swapMintAuthorityPda, MintAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("jupiter-mint-auth")],
      jupiterId
    );

    await utils.initializeMint(spreePointsProgram, ecosystemPartner, usdcMint, pdaMap);
    //console.log("PDA MINT INITIALIZATION DONE: ", pdaMap.mint);

    // MINT COLLATERAL DEPOSITS TO ECOSYSTEM PARTNER FOR DEPOSIT
    const ecosystemPartnerCollateralAta = await createAssociatedTokenAccount(
      provider.connection,
      ecosystemPartner.payer,
      collateralToken.publicKey,
      ecosystemPartner.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false,
    );
    await mintTo(
      provider.connection,
      deployer,
      collateralToken.publicKey,
      ecosystemPartnerCollateralAta,
      deployer.publicKey,
      1000 * 10 ** 9,
      [],
      null,
      TOKEN_2022_PROGRAM_ID
    );

// Create the SP ATA manually with the correct program (legacy)
const payerSpTempAta = await createAssociatedTokenAccount(
  provider.connection,
  ecosystemPartner.payer, // payer
  pdaMap.mint,      // SP mint (legacy)
  ecosystemPartner.publicKey, // owner
  null,
  TOKEN_2022_PROGRAM_ID, // Use legacy since SP mint is legacy ////! Might Change
  ASSOCIATED_TOKEN_PROGRAM_ID,
  false
);

    
    const ecosystemPartnerUspTokenAta = await getAssociatedTokenAddressSync(
      mintAccount.publicKey,
      ecosystemPartner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
     /*const ecosystemPartnerUspTokenAta = await createAssociatedTokenAccount(
      provider.connection,
      ecosystemPartner,
      mintAccount.publicKey,
      ecosystemPartner.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false
    );*/
/*
    const usdcFeeSwapReceiverAta = await createAssociatedTokenAccount(
      provider.connection,
      ecosystemPartner,
      usdcMint,
      ecosystemPartner.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false
    );*/

    //ERROR IS NOT FROM usdcFeeSwapReceiverAta
    const usdcFeeSwapReceiverAta = await createAssociatedTokenAccount(
      provider.connection,
      ecosystemPartner.payer,
      usdcMint,
      ecosystemPartner.publicKey,// should be ecosystemPartner
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false,
    );
/* ERROR IS NOT FROM payerUsdcKeeperAta alone
    const payerUsdcKeeperAta = await createAssociatedTokenAccount(
      provider.connection,
      ecosystemPartner,
      usdcMint,
      ecosystemPartner.publicKey,///! changing this from usdcKeeper
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      false,
    );
  
    const payerUsdcKeeperAta = await getAssociatedTokenAddressSync(
      usdcMint,
      ecosystemPartner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );*/

    //await utils.addToMintWhitelist(spreePointsProgram, ecosystemPartner, payerUsdcKeeperAta, pdaMap);

    await setAuthority(
      provider.connection,
      ecosystemPartner.payer,
      usdcMint,
      ecosystemPartner.publicKey,
      AuthorityType.MintTokens,
      swapMintAuthorityPda,
    );
//
    // Constants
    const depositAmount = 500;
    const feeAmount = 100;
    const platformFeeAddress = anchor.web3.Keypair.generate();
    const dataForFeeSwapReceiver = await getAccount(provider.connection, usdcFeeSwapReceiverAta);
    console.log("USDC Account Balance of Fee Swap Receiver Is: ", Number(dataForFeeSwapReceiver.amount));
    const usdcMintInfo = await provider.connection.getAccountInfo(usdcMint);
    console.log("USDC mint owner is: ", usdcMintInfo?.owner);

    // Let USDC Minter Mints Some Tokens To USDCFEERECeiver
    await mintTo(
      provider.connection,
      ecosystemPartner.payer,
      usdcMint,
      usdcFeeSwapReceiverAta,
      ecosystemPartner.payer,
      100 * 10 ** 6,
      [],

    );

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
        destinationMint: usdcMint,// Legacy Token
        sourceMint: collateralToken.publicKey,// Collateral Token
        mintAuthority: swapMintAuthorityPda,
        eventAuthority: deployer.publicKey,
        burnTokenProgram: TOKEN_2022_PROGRAM_ID,// Collateral Token is a 2022
        tokenProgram: TOKEN_PROGRAM_ID,// Keep This As USDC is Legacy Token
        platformFeeAccount: platformFeeAddress.publicKey,
        program: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      })
      .instruction();

    const routeData = Buffer.from(routeTx.data);
    const routeMetas = routeTx.keys.map(meta => {
      
      if (meta.pubkey.equals(ecosystemPartner.publicKey)) {
          return { ...meta, isSigner: false };
      }
      return meta;
    });

    const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
    const messagev0 = new TransactionMessage({
        payerKey: ecosystemPartner.publicKey,
        recentBlockhash: blockhash,
        instructions: [routeTx],
    }).compileToV0Message([]);
    const routeFTx = new VersionedTransaction(messagev0);

    // Send The Versioned Transaction
    routeFTx.sign([ecosystemPartner.payer]);
    const sig = await provider.connection.sendTransaction(routeFTx);
    /*await provider.connection.confirmTransaction({
      sig,
      blockhash,
      lastValidBlockHeight,
    }, "confirmed");*/

    const [whitelistStatusPda, whitelistStatusBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(utils.MINT_WHITELIST_SEED), usdcFeeSwapReceiverAta.toBuffer()],
      spreePointsProgram.programId
    );

    const [freezeStatePda, freezeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(utils.FREEZE_SEED)],
      spreePointsProgram.programId
    );

    
    const [spMintAuthorityPda, spMintAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_mint_authority"), pdaMap.mint.toBuffer()],
      tokenDeployerProgram.programId
    );

    const [usdcKeeperPda, usdcKeeperBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(utils.USDC_SEED)],
      spreePointsProgram.programId
    );

    const pdaInfo = await provider.connection.getAccountInfo(usdcKeeperPda);
    console.log("USDC Keeper PDA exists:", !!pdaInfo);

    if (pdaInfo) {
      console.log("PDA owner:", pdaInfo.owner.toString());
      console.log("PDA data length:", pdaInfo.data.length);
      try {
        const tokenAccount = await getAccount(provider.connection, usdcKeeperPda);
        console.log("PDA is valid token account");
        console.log("PDA mint:", tokenAccount.mint.toString());
        console.log("PDA authority:", tokenAccount.owner.toString());
    } catch (error) {
        console.log("PDA is NOT a valid token account:", error);
    }
} else {
    console.log("PDA does not exist - needs to be created first");
}

  // Debug the usdc_from_ata account
console.log("=== USDC FROM ATA DEBUG ===");
console.log("usdc_receive_swap_ata:", usdcFeeSwapReceiverAta.toString());

try {
    const usdcFromAccount = await getAccount(provider.connection, usdcFeeSwapReceiverAta);
    console.log("usdc_from_ata is valid token account");
    console.log("usdc_from_ata mint:", usdcFromAccount.mint.toString());
    console.log("usdc_from_ata owner:", usdcFromAccount.owner.toString());
    console.log("usdc_from_ata balance:", usdcFromAccount.amount.toString());
    console.log("ecosystemPartner pubkey:", ecosystemPartner.publicKey.toString());
    console.log("USDC balance in from_ata:", usdcFromAccount.amount.toString());
    
    // Check if the authority matches what SP program expects
    if (usdcFromAccount.owner.toString() === ecosystemPartner.publicKey.toString()) {
        console.log("✅ Authority matches signer");
    } else {
        console.log("❌ Authority mismatch!");
    }
    
    // Check if it has the correct mint
    if (usdcFromAccount.mint.toString() === usdcMint.toString()) {
        console.log("✅ Mint matches");
    } else {
        console.log("❌ Mint mismatch!");
        console.log("Expected mint:", usdcMint.toString());
    }
    
} catch (error) {
    console.log("❌ usdc_from_ata is NOT a valid token account:", error);
}

//
    // Build Deposit Tx
    const anchorDepositIx = await tokenDeployerProgram.methods
      .depositEcosystem(new BN(depositAmount), Buffer.alloc(0))
      .accounts({
        payer: ecosystemPartner.publicKey,
        config: configPDA,
        mintAccount: mintAccount.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerUspTokenAta,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralToken.publicKey,
        userCollateralAccount: ecosystemPartnerCollateralAta,
        collateralVault: collateralVaultPda,
        feeVault: feeVaultPda,
        spMint: pdaMap.mint,
        payerSpTempAta: payerSpTempAta,
        feeVaultAuthority: feeVaultAuthorityPda,// should be fee Vault Authority
        usdcReceiveSwapAta: usdcFeeSwapReceiverAta,
        usdcMint: usdcMint,
        //payerUsdcKeeperAta: usdcFeeSwapReceiverAta,
        usdcKeeper: usdcKeeperPda,
        fees: pdaMap.fees,
        feesCollector: feesCollector.publicKey,
        freezeState: freezeStatePda,
        whitelistStatus: whitelistStatusPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        tokenProgramInterface: TOKEN_PROGRAM_ID,
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
    //const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
    /*const messagev1 = new TransactionMessage({
        payerKey: ecosystemPartner.publicKey,
        recentBlockhash: blockhash,
        instructions: [routeTx, anchorDepositIx],
    }).compileToV0Message([]);
    const tx = new VersionedTransaction(messagev1);

    // Send The Versioned Transaction
    tx.sign([ecosystemPartner.payer]);
    const signature = await provider.connection.sendTransaction(tx);
    await provider.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,

    }, "confirmed");
    console.log("Deposit suceeded: ", signature);*/

    // Make Some Logging
    const dataForFeeSwapReceiverAfter = await getAccount(provider.connection, usdcFeeSwapReceiverAta);

    console.log("Fee Received After Swap Is: ", Number(dataForFeeSwapReceiverAfter.amount));
  })
})