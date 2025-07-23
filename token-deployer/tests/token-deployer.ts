import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenDeployer } from "../target/types/token_deployer";
import { TransferHook } from "../target/types/transfer_hook";
import { assert } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

describe("token-deployer with transfer hook", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const connection = provider.connection;
  const wallet = provider.wallet;

  const tokenDeployerProgram = anchor.workspace.TokenDeployer as Program<TokenDeployer>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  let mintKeypair, recipient;
  let sourceTokenAccount, destinationTokenAccount, ecosystemPartnerTokenAccount, unauthorizedTokenAccount;
  let decimals, transferAmount;
  let extraAccountMetas;
  
  let configPda, mintAuthorityPda, ecosystemConfigPda, feeVaultAuthorityPda, feeVaultPda, collateralVaultPda;
  
  let collateralMintKeypair;
  const collateralDecimal = 9;
  
  const ecosystemPartnerKeypair = Keypair.generate();
  const unauthorizedWalletKeypair = Keypair.generate();
  
  let walletCollateralAccount, partnerCollateralAccount, unauthorizedCollateralAccount;

  let transferHookConfigPda;
  let whitelistStatusPda;

  async function mintTokensWithPartner(amount) {
    // Create empty swap data for Jupiter
    const swap_data = Buffer.from([]);
    
    // Get Jupiter program ID
    const jupiterProgramId = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    
    // Get USDC mint
    const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    
    // Get vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      tokenDeployerProgram.programId
    );
    
    // Get vault input token account (for collateral)
    const vaultInputTokenAccount = getAssociatedTokenAddressSync(
      collateralMintKeypair.publicKey,
      vaultPda,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Get vault output token account (for USDC)
    const vaultOutputTokenAccount = getAssociatedTokenAddressSync(
      usdcMint,
      vaultPda,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Get SP token mint
    const spTokenMint = new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC");
    
    // Get SP mint authority PDA
    const [spMintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_mint_authority")],
      tokenDeployerProgram.programId
    );
    
    // Get SP vault PDA
    const [spVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    return tokenDeployerProgram.methods
      .depositEcosystem(new anchor.BN(amount), swap_data)
      .accounts({
        payer: ecosystemPartnerKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerTokenAccount,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        userCollateralAccount: partnerCollateralAccount,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        jupiterProgram: jupiterProgramId,
        vault: vaultPda,
        vaultInputTokenAccount: vaultInputTokenAccount,
        vaultOutputTokenAccount: vaultOutputTokenAccount,
        usdcMint: usdcMint,
        usdcTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: spTokenMint,
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spMintAuthority: spMintAuthorityPda,
        spVault: spVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([ecosystemPartnerKeypair])
      .rpc({ commitment: "confirmed" });
  }

  async function expectTxToFail(txPromise) {
    try {
      await txPromise;
      return false;
    } catch (error) {
      return true;
    }
  }

  before(async () => {
    await connection.confirmTransaction(
      await connection.requestAirdrop(ecosystemPartnerKeypair.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    
    await connection.confirmTransaction(
      await connection.requestAirdrop(unauthorizedWalletKeypair.publicKey, 2 * LAMPORTS_PER_SOL)
    );
        
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      tokenDeployerProgram.programId
    );

    await tokenDeployerProgram.methods
      .initialize()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
      
    collateralMintKeypair = Keypair.generate();
    
    walletCollateralAccount = getAssociatedTokenAddressSync(
      collateralMintKeypair.publicKey,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    partnerCollateralAccount = getAssociatedTokenAddressSync(
      collateralMintKeypair.publicKey,
      ecosystemPartnerKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    unauthorizedCollateralAccount = getAssociatedTokenAddressSync(
      collateralMintKeypair.publicKey,
      unauthorizedWalletKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    const createCollateralMintTx = new Transaction();
    
    createCollateralMintTx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: collateralMintKeypair.publicKey,
        space: 82,
        lamports: await connection.getMinimumBalanceForRentExemption(82),
        programId: TOKEN_2022_PROGRAM_ID,
      })
    );
    
    createCollateralMintTx.add(
      createInitializeMintInstruction(
        collateralMintKeypair.publicKey,
        collateralDecimal,
        wallet.publicKey,
        wallet.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    createCollateralMintTx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        walletCollateralAccount,
        wallet.publicKey,
        collateralMintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        partnerCollateralAccount,
        ecosystemPartnerKeypair.publicKey,
        collateralMintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        unauthorizedCollateralAccount,
        unauthorizedWalletKeypair.publicKey,
        collateralMintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    
    await sendAndConfirmTransaction(connection, createCollateralMintTx, [wallet.payer, collateralMintKeypair], {
      commitment: "confirmed",
    });
    
    const mintCollateralTx = new Transaction().add(
      createMintToInstruction(
        collateralMintKeypair.publicKey,
        partnerCollateralAccount,
        wallet.publicKey,
        1000 * 10 ** collateralDecimal,
        [],
        TOKEN_2022_PROGRAM_ID
      ),
      createMintToInstruction(
        collateralMintKeypair.publicKey,
        unauthorizedCollateralAccount,
        wallet.publicKey,
        1000 * 10 ** collateralDecimal,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    await sendAndConfirmTransaction(connection, mintCollateralTx, [wallet.payer], {
      commitment: "confirmed",
    });
  });

  beforeEach(async () => {
    mintKeypair = Keypair.generate();
    decimals = 9;
    transferAmount = 1 * 10 ** decimals;
    
    const name = "Bonk";
    const symbol = "BONK";
    const uri = "https://example.com/metadata.json"; // ToDo - test with correct JSON metadata format
    const transferHookProgramId = transferHookProgram.programId;
    const maxMintingCap = new anchor.BN(1000 * 10 ** decimals);
    const withdrawalFee = 2000; // 20% fee (2000 basis points)
    const depositFee = 2000; // 20% fee (2000 basis points)

    [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    [ecosystemConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ecosystem_config"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    [feeVaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault_authority"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    [feeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    [collateralVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral_vault"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );

    // Get SP token mint
    const spTokenMint = new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC");
    
    // Get SP mint authority PDA
    const [spMintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_mint_authority")],
      tokenDeployerProgram.programId
    );
    
    // Get SP vault PDA
    const [spVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );

    await tokenDeployerProgram.methods
      .createEcosystem({
        decimals,
        name,
        symbol,
        uri,
        transferHookProgramId,
        ecosystemPartnerWallet: ecosystemPartnerKeypair.publicKey,
        maxMintingCap,
        withdrawalFeeBasisPoints: withdrawalFee,
        depositFeeBasisPoints: depositFee,
        collateralTokenMint: collateralMintKeypair.publicKey, 
      })
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
        mintAccount: mintKeypair.publicKey,
        mintAuthority: mintAuthorityPda,
        ecosystemConfig: ecosystemConfigPda,
        feeVaultAuthority: feeVaultAuthorityPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: spTokenMint,
        spMintAuthority: spMintAuthorityPda,
        spVault: spVaultPda,
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc({ commitment: "confirmed" });
    console.log("Created ecosystem token");

    [extraAccountMetas] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
      transferHookProgramId
    );

    [transferHookConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      transferHookProgramId
    );

    const initExtraAccountMetasTx = await transferHookProgram.methods
      .initializeExtraAccountMetaList()
      .accounts({
        signer: wallet.publicKey,
        mint: mintKeypair.publicKey,
        extraAccountMetaList: extraAccountMetas,
        config: transferHookConfigPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await sendAndConfirmTransaction(connection, initExtraAccountMetasTx, [wallet.payer], {
      commitment: "confirmed",
    });

    sourceTokenAccount = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    ecosystemPartnerTokenAccount = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      ecosystemPartnerKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    unauthorizedTokenAccount = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      unauthorizedWalletKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    recipient = Keypair.generate();
    destinationTokenAccount = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        sourceTokenAccount,
        wallet.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        ecosystemPartnerTokenAccount,
        ecosystemPartnerKeypair.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        unauthorizedTokenAccount,
        unauthorizedWalletKeypair.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        destinationTokenAccount,
        recipient.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [wallet.payer], {
      commitment: "confirmed",
    });
  });

  it("Only allow ecosystem partner to deposit", async () => {
    const mintAmount = 100 * 10 ** decimals;

    const partnerTokenInfoBefore = await connection.getTokenAccountBalance(
      ecosystemPartnerTokenAccount, 
      "confirmed"
    );
    console.log("Partner token balance Before minting:", partnerTokenInfoBefore.value.uiAmount);
    assert.equal(
      Number(partnerTokenInfoBefore.value.amount),
      0,
      "Ecosystem partner tokens balance must be 0"
    );
    
    const unauthorizedMintTx = tokenDeployerProgram.methods
      .depositEcosystem(new anchor.BN(mintAmount), Buffer.from([]))
      .accounts({
        payer: unauthorizedWalletKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: unauthorizedTokenAccount,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        userCollateralAccount: unauthorizedCollateralAccount,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
        vault: PublicKey.findProgramAddressSync(
          [Buffer.from("vault")],
          tokenDeployerProgram.programId
        )[0],
        vaultInputTokenAccount: getAssociatedTokenAddressSync(
          collateralMintKeypair.publicKey,
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        vaultOutputTokenAccount: getAssociatedTokenAddressSync(
          new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        usdcTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC"),
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spMintAuthority: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_mint_authority")],
          tokenDeployerProgram.programId
        )[0],
        spVault: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
          tokenDeployerProgram.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([unauthorizedWalletKeypair]);
    
    const mintFailed = await expectTxToFail(unauthorizedMintTx.rpc({ commitment: "confirmed" }));
    assert(mintFailed, "Minting should fail with unauthorized wallet");

    const mintInfoBefore = await getMint(
      connection,
      mintKeypair.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    
    await mintTokensWithPartner(mintAmount);
    
    const partnerTokenInfo = await connection.getTokenAccountBalance(
      ecosystemPartnerTokenAccount, 
      "confirmed"
    );
    // Keep this important log to show the token balance after minting
    console.log("Partner token balance after minting:", partnerTokenInfo.value.uiAmount);
    const depositFee = 2000; // 20% fee (2000 basis points)
    const feeAmount = (mintAmount * depositFee) / 10000;
    const expectedMintedAmount = mintAmount - feeAmount;
    assert.equal(
      Number(partnerTokenInfo.value.amount),
      expectedMintedAmount,
      "Ecosystem partner should have received tokens minus the fee"
    );
    
    // Verify 1:1 collateralization - collateral in vault should equal minted tokens
    const collateralVaultInfo = await connection.getTokenAccountBalance(
      collateralVaultPda,
      "confirmed"
    );
    console.log("Collateral in vault:", collateralVaultInfo.value.uiAmount);
    
    assert.equal(
      Number(collateralVaultInfo.value.amount),
      Number(partnerTokenInfo.value.amount),
      "Collateral in vault should equal minted tokens (1:1 collateralization)"
    );
    
    const feeVaultInfo = await connection.getTokenAccountBalance(
      feeVaultPda,
      "confirmed"
    );;
    const exceedCapAmount = new anchor.BN(1000 * 10 ** decimals);
    const exceedCapTx = tokenDeployerProgram.methods
      .depositEcosystem(exceedCapAmount, Buffer.from([]))
      .accounts({
        payer: ecosystemPartnerKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerTokenAccount,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        userCollateralAccount: partnerCollateralAccount,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
        vault: PublicKey.findProgramAddressSync(
          [Buffer.from("vault")],
          tokenDeployerProgram.programId
        )[0],
        vaultInputTokenAccount: getAssociatedTokenAddressSync(
          collateralMintKeypair.publicKey,
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        vaultOutputTokenAccount: getAssociatedTokenAddressSync(
          new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        usdcTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC"),
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spMintAuthority: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_mint_authority")],
          tokenDeployerProgram.programId
        )[0],
        spVault: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
          tokenDeployerProgram.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([ecosystemPartnerKeypair]);
      
    const exceedCapFailed = await expectTxToFail(exceedCapTx.rpc({ commitment: "confirmed" }));
    assert(exceedCapFailed, "Minting more than the max cap should fail");
  });

  it("Allow owner to collect fees", async () => {
    const mintAmount = 200 * 10 ** decimals;
    
    const initialWalletBalance = await connection.getTokenAccountBalance(
      walletCollateralAccount,
      "confirmed"
    );
    console.log("Owner wallet collateral balance ", initialWalletBalance.value.uiAmount);

    await mintTokensWithPartner(mintAmount);
    
    // Get SP token mint
    const spTokenMint = new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC");
    
    // Get SP vault PDA
    const [spVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    // Create SP destination account for owner
    const spDestinationAccount = getAssociatedTokenAddressSync(
      spTokenMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    try {
      await connection.getTokenAccountBalance(spDestinationAccount);
    } catch (error) {
      const createSpDestTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          spDestinationAccount,
          wallet.publicKey,
          spTokenMint,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, createSpDestTx, [wallet.payer], {
        commitment: "confirmed",
      });
    }
    
    // Check SP vault balance before collection
    const spVaultBeforeCollection = await connection.getTokenAccountBalance(
      spVaultPda,
      "confirmed"
    );
    console.log("SP vault balance before ", spVaultBeforeCollection.value.uiAmount);
    
    try {
      await connection.getTokenAccountBalance(walletCollateralAccount);
    } catch (error) {
      const createDestTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          walletCollateralAccount,
          wallet.publicKey,
          collateralMintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, createDestTx, [wallet.payer], {
        commitment: "confirmed",
      });
    }
    
    await tokenDeployerProgram.methods
      .collectFees()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
        mint: mintKeypair.publicKey,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        feeVaultAuthority: feeVaultAuthorityPda,
        feeVault: feeVaultPda,
        destinationAccount: walletCollateralAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: spTokenMint,
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spVault: spVaultPda,
        spDestinationAccount: spDestinationAccount
      })
      .rpc({ commitment: "confirmed" });
    
    // Check SP vault balance after collection
    const spVaultAfterCollection = await connection.getTokenAccountBalance(
      spVaultPda,
      "confirmed"
    );
    console.log("SP vault balance after ", spVaultAfterCollection.value.uiAmount);
    assert.equal(
      Number(spVaultAfterCollection.value.amount),
      0,
      "SP vault should be empty after collection"
    );
    
    // Check SP destination account balance
    const spDestinationBalance = await connection.getTokenAccountBalance(
      spDestinationAccount,
      "confirmed"
    );
    console.log("SP tokens collected ", spDestinationBalance.value.uiAmount);
    assert(
      Number(spDestinationBalance.value.amount) > 0,
      "SP destination account should have received SP tokens"
    );
    
    console.log("Empty vault fee collection (should fail): ");
    const emptyCollectionTx = tokenDeployerProgram.methods
      .collectFees()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
        mint: mintKeypair.publicKey,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        feeVaultAuthority: feeVaultAuthorityPda,
        feeVault: feeVaultPda,
        destinationAccount: walletCollateralAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: spTokenMint,
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spVault: spVaultPda,
        spDestinationAccount: spDestinationAccount
      });
      
    const emptyCollectionFailed = await expectTxToFail(emptyCollectionTx.rpc({ commitment: "confirmed" }));
    assert(emptyCollectionFailed, "Should not be able to collect fees when vault is empty");
  });

  it("Collecting fees", async () => {
    await mintTokensWithPartner(150 * 10 ** decimals);
    
    // Get SP token mint
    const spTokenMint = new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC");
    
    // Get SP vault PDA
    const [spVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
      tokenDeployerProgram.programId
    );
    
    // Check SP vault balance
    const spVaultBalance = await connection.getTokenAccountBalance(
      spVaultPda,
      "confirmed"
    );
    console.log("SP vault balance: ", spVaultBalance.value.uiAmount);
    
    // Create SP destination account for unauthorized user
    const unauthorizedSpAccount = getAssociatedTokenAddressSync(
      spTokenMint,
      unauthorizedWalletKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    try {
      await connection.getTokenAccountBalance(unauthorizedSpAccount);
    } catch (error) {
      const createUnauthorizedSpTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          unauthorizedSpAccount,
          unauthorizedWalletKeypair.publicKey,
          spTokenMint,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, createUnauthorizedSpTx, [wallet.payer], {
        commitment: "confirmed",
      });
    }
    
    try {
      await connection.getTokenAccountBalance(unauthorizedCollateralAccount);
    } catch (error) {
      const createUnauthorizedTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          unauthorizedCollateralAccount,
          unauthorizedWalletKeypair.publicKey,
          collateralMintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, createUnauthorizedTx, [wallet.payer], {
        commitment: "confirmed",
      });
    }
    
    console.log("Trying non owner fee collection (it should fail)");
    const unauthorizedCollectionTx = tokenDeployerProgram.methods
      .collectFees()
      .accounts({
        config: configPda,
        payer: unauthorizedWalletKeypair.publicKey,
        mint: mintKeypair.publicKey,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        feeVaultAuthority: feeVaultAuthorityPda,
        feeVault: feeVaultPda,
        destinationAccount: unauthorizedCollateralAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: spTokenMint,
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spVault: spVaultPda,
        spDestinationAccount: unauthorizedSpAccount
      })
      .signers([unauthorizedWalletKeypair]);
    
    const unauthorizedCollectionFailed = await expectTxToFail(unauthorizedCollectionTx.rpc({ commitment: "confirmed" }));
    assert(unauthorizedCollectionFailed, "Unauthorized users should not be able to collect fees");
  });

  it("Tests transfer hook whitelist", async () => {
    await mintTokensWithPartner(100 * 10 ** decimals);
    
    [whitelistStatusPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), destinationTokenAccount.toBuffer()],
      transferHookProgram.programId
    );
    
    const addToWhitelistTx = await transferHookProgram.methods
      .addToWhitelist()
      .accounts({
        signer: wallet.publicKey,
        user: destinationTokenAccount,
        config: transferHookConfigPda,
        whiteListStatus: whitelistStatusPda,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await sendAndConfirmTransaction(connection, addToWhitelistTx, [wallet.payer], {
      commitment: "confirmed",
    });
    console.log("Destination account added to whitelist");

    const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
      connection,
      ecosystemPartnerTokenAccount,
      mintKeypair.publicKey,
      destinationTokenAccount,
      ecosystemPartnerKeypair.publicKey,
      BigInt(transferAmount),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const transferTx = new Transaction().add(transferInstruction);
    await sendAndConfirmTransaction(
      connection, 
      transferTx, 
      [ecosystemPartnerKeypair], 
      { skipPreflight: true, commitment: "confirmed" }
    );
    console.log("Transfer to whitelisted account successful");

    const destinationAccountInfo = await connection.getTokenAccountBalance(destinationTokenAccount, "confirmed");
    console.log("Destination account balance ", destinationAccountInfo.value.uiAmount);
    assert.equal(
      Number(destinationAccountInfo.value.amount),
      transferAmount,
      "Destination account should have received the transferred amount"
    );

    console.log("Removing account from whitelist");
    const removeFromWhitelistTx = await transferHookProgram.methods
      .removeFromWhitelist()
      .accounts({
        signer: wallet.publicKey,
        user: destinationTokenAccount,
        config: transferHookConfigPda,
        whiteListStatus: whitelistStatusPda,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await sendAndConfirmTransaction(connection, removeFromWhitelistTx, [wallet.payer], {
      commitment: "confirmed",
    });
    console.log("Account removed from whitelist");

    const transferInstruction2 = await createTransferCheckedWithTransferHookInstruction(
      connection,
      ecosystemPartnerTokenAccount,
      mintKeypair.publicKey,
      destinationTokenAccount,
      ecosystemPartnerKeypair.publicKey,
      BigInt(transferAmount),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const transferTx2 = new Transaction().add(transferInstruction2);
    
    const transferFailed = await expectTxToFail(
      sendAndConfirmTransaction(connection, transferTx2, [ecosystemPartnerKeypair], {
        skipPreflight: true,
        commitment: "confirmed",
      })
    );
    assert(transferFailed, "Transfer should fail after account is removed from whitelist");

    const destinationAccountInfoAfter = await connection.getTokenAccountBalance(destinationTokenAccount, "confirmed");
    assert.equal(
      Number(destinationAccountInfoAfter.value.amount),
      transferAmount,
      "Destination account balance should remain unchanged after failed transfer"
    );
  });
  
  it("global and ecosystem freeze functionality", async () => {
    const mintAmount = 50 * 10 ** decimals;
    
    await mintTokensWithPartner(mintAmount);
    
    const mintInfoBefore = await getMint(
      connection,
      mintKeypair.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const initialSupply = Number(mintInfoBefore.supply);
    console.log("Initial token supply:", initialSupply / (10 ** decimals));
    
    await tokenDeployerProgram.methods
      .toggleGlobalFreeze()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    
    console.log("Testing mint with global freeze (it should fail): ");
    const globalFreezeMintTx = tokenDeployerProgram.methods
      .depositEcosystem(new anchor.BN(mintAmount), Buffer.from([]))
      .accounts({
        payer: ecosystemPartnerKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerTokenAccount,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        userCollateralAccount: partnerCollateralAccount,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
        vault: PublicKey.findProgramAddressSync(
          [Buffer.from("vault")],
          tokenDeployerProgram.programId
        )[0],
        vaultInputTokenAccount: getAssociatedTokenAddressSync(
          collateralMintKeypair.publicKey,
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        vaultOutputTokenAccount: getAssociatedTokenAddressSync(
          new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        usdcTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC"),
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spMintAuthority: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_mint_authority")],
          tokenDeployerProgram.programId
        )[0],
        spVault: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
          tokenDeployerProgram.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([ecosystemPartnerKeypair]);
    
    const globalFreezeMintFailed = await expectTxToFail(globalFreezeMintTx.rpc({ commitment: "confirmed" }));
    assert(globalFreezeMintFailed, "Deposit should fail when global freeze is active");
    
    let mintInfoAfter = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(Number(mintInfoAfter.supply), initialSupply, "Supply should not change during freeze");
    
    console.log("Disabling global freeze and enabling ecosystem freeze: ");
    await tokenDeployerProgram.methods
      .toggleGlobalFreeze()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    
    await tokenDeployerProgram.methods
      .toggleEcosystemFreeze()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
        ecosystem_config: ecosystemConfigPda,
        mint: mintKeypair.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    
    console.log("Trying mint during ecosystem freeze (should fail): ");
    const ecosystemFreezeMintTx = tokenDeployerProgram.methods
      .depositEcosystem(new anchor.BN(mintAmount), Buffer.from([]))
      .accounts({
        payer: ecosystemPartnerKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthorityPda,
        toAta: ecosystemPartnerTokenAccount,
        ecosystemConfig: ecosystemConfigPda,
        collateralTokenMint: collateralMintKeypair.publicKey,
        userCollateralAccount: partnerCollateralAccount,
        feeVault: feeVaultPda,
        collateralVault: collateralVaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
        vault: PublicKey.findProgramAddressSync(
          [Buffer.from("vault")],
          tokenDeployerProgram.programId
        )[0],
        vaultInputTokenAccount: getAssociatedTokenAddressSync(
          collateralMintKeypair.publicKey,
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        vaultOutputTokenAccount: getAssociatedTokenAddressSync(
          new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          PublicKey.findProgramAddressSync(
            [Buffer.from("vault")],
            tokenDeployerProgram.programId
          )[0],
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        usdcTokenProgram: TOKEN_2022_PROGRAM_ID,
        spTokenMint: new PublicKey("SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC"),
        spTokenProgram: TOKEN_2022_PROGRAM_ID,
        spMintAuthority: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_mint_authority")],
          tokenDeployerProgram.programId
        )[0],
        spVault: PublicKey.findProgramAddressSync(
          [Buffer.from("sp_vault"), mintKeypair.publicKey.toBuffer()],
          tokenDeployerProgram.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([ecosystemPartnerKeypair]);
    
    const ecosystemFreezeMintFailed = await expectTxToFail(ecosystemFreezeMintTx.rpc({ commitment: "confirmed" }));
    assert(ecosystemFreezeMintFailed, "Deposit should fail when ecosystem freeze is active");
    
    console.log("Disabling ecosystem freeze");
    await tokenDeployerProgram.methods
      .toggleEcosystemFreeze()
      .accounts({
        config: configPda,
        payer: wallet.publicKey,
        ecosystem_config: ecosystemConfigPda,
        mint: mintKeypair.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    
    await mintTokensWithPartner(mintAmount);
    
    mintInfoAfter = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("Token supply after unfreezing:", Number(mintInfoAfter.supply) / (10 ** decimals));
    const depositFee = 2000; // 20% fee (2000 basis points)
    const feeAmount = (mintAmount * depositFee) / 10000;
    const expectedMintedAmount = mintAmount - feeAmount;
    assert.equal(
      Number(mintInfoAfter.supply),
      initialSupply + expectedMintedAmount,
      "Supply should increase by the amount minus fees after unfreezing"
    );
    
    console.log("Non owner trying to toggle global and ecosystem freeze");
    const unauthorizedToggleGlobalTx = tokenDeployerProgram.methods
      .toggleGlobalFreeze()
      .accounts({
        config: configPda,
        payer: unauthorizedWalletKeypair.publicKey,
      })
      .signers([unauthorizedWalletKeypair]);
    
    const unauthorizedToggleEcosystemTx = tokenDeployerProgram.methods
      .toggleEcosystemFreeze()
      .accounts({
        config: configPda,
        payer: unauthorizedWalletKeypair.publicKey,
        ecosystem_config: ecosystemConfigPda,
        mint: mintKeypair.publicKey,
      })
      .signers([unauthorizedWalletKeypair]);
    
    const unauthorizedGlobalFreezeFailed = await expectTxToFail(unauthorizedToggleGlobalTx.rpc({ commitment: "confirmed" }));
    const unauthorizedEcosystemFreezeFailed = await expectTxToFail(unauthorizedToggleEcosystemTx.rpc({ commitment: "confirmed" }));
    
    assert(unauthorizedGlobalFreezeFailed, "Non owner global freeze toggle");
    assert(unauthorizedEcosystemFreezeFailed, "Non owner ecosystem freeze toggle");
  });
});