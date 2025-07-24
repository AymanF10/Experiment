import * as anchor from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import type { TransferHook } from '../target/types/transfer_hook';

describe('transfer-hook', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TransferHook as Program<TransferHook>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const mint = new Keypair();
  const decimals = 9;

  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const recipient = Keypair.generate();
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  let whitelistAuthority = wallet.payer;
  let freezeAuthority = wallet.payer;

  const [configAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const [extraAccountMetaListAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    program.programId
  );

  const [whitelistStatusAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), destinationTokenAccount.toBuffer()],
    program.programId
  );

  it('Create Mint Account with Transfer Hook Extension', async () => {
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        wallet.publicKey,
        program.programId,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(mint.publicKey, decimals, wallet.publicKey, null, TOKEN_2022_PROGRAM_ID),
    );

    const txSig = await sendAndConfirmTransaction(provider.connection, transaction, [wallet.payer, mint]);
    console.log(`Transaction Signature: ${txSig}`);
  });

  it('Create Token Accounts and Mint Tokens', async () => {
    const amount = 100 * 10 ** decimals;

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        sourceTokenAccount,
        wallet.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        destinationTokenAccount,
        recipient.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToInstruction(mint.publicKey, sourceTokenAccount, wallet.publicKey, amount, [], TOKEN_2022_PROGRAM_ID),
    );

    const txSig = await sendAndConfirmTransaction(connection, transaction, [wallet.payer], { skipPreflight: true });

    console.log(`Transaction Signature: ${txSig}`);
  });

  it('Create ExtraAccountMetaList Account', async () => {
    const initializeExtraAccountMetaListInstruction = await program.methods
      .initializeExtraAccountMetaList()
      .accounts({
        signer: wallet.publicKey,
        mint: mint.publicKey,
        extraAccountMetaList: extraAccountMetaListAddress,
        config: configAddress,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const transaction = new Transaction().add(initializeExtraAccountMetaListInstruction);

    const txSig = await sendAndConfirmTransaction(provider.connection, transaction, [wallet.payer], { 
      skipPreflight: true, 
      commitment: 'confirmed' 
    });

    console.log('Transaction Signature:', txSig);
  });

  it('Add account to white list', async () => {
    const addToWhitelistInstruction = await program.methods
      .addToWhitelist()
      .accounts({
        signer: wallet.publicKey,
        user: destinationTokenAccount,
        config: configAddress,
        whiteListStatus: whitelistStatusAddress,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const transaction = new Transaction().add(addToWhitelistInstruction);

    const txSig = await sendAndConfirmTransaction(connection, transaction, [wallet.payer], { skipPreflight: true });
    console.log('Whitelisted tx: ', txSig);
  });

  it('Transfer Hook with Extra Account Meta', async () => {
    const amount = 1 * 10 ** decimals;
    const bigIntAmount = BigInt(amount);

    const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
      connection,
      sourceTokenAccount,
      mint.publicKey,
      destinationTokenAccount,
      wallet.publicKey,
      bigIntAmount,
      decimals,
      [],
      'confirmed',
      TOKEN_2022_PROGRAM_ID,
    );

    const transaction = new Transaction().add(transferInstruction);

    const txSig = await sendAndConfirmTransaction(connection, transaction, [wallet.payer], { skipPreflight: true });
    console.log('Transfer Checked:', txSig);
  });

  it('Wl authority upgrade', async () => {
    const newAuthority = Keypair.generate();
    
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: newAuthority.publicKey,
        lamports: 1000000000,
      })
    );
    
    await sendAndConfirmTransaction(connection, fundTx, [wallet.payer], { skipPreflight: true });
    
    const updateWhitelistAuthorityInstruction = await program.methods
      .updateWhitelistAuthority()
      .accounts({
        signer: wallet.publicKey,
        newAuthority: newAuthority.publicKey,
        config: configAddress,
      })
      .instruction();

    const transaction = new Transaction().add(updateWhitelistAuthorityInstruction);

    const txSig = await sendAndConfirmTransaction(connection, transaction, [wallet.payer, newAuthority], { skipPreflight: true });
    console.log('Signature ', txSig);
    
    whitelistAuthority = newAuthority;
  });

  it('Remove from wl', async () => {
    const removeFromWhitelistInstruction = await program.methods
      .removeFromWhitelist()
      .accounts({
        signer: whitelistAuthority.publicKey,
        user: destinationTokenAccount,
        config: configAddress,
        whiteListStatus: whitelistStatusAddress,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    let transaction = new Transaction().add(removeFromWhitelistInstruction);

    const txSig = await sendAndConfirmTransaction(connection, transaction, [whitelistAuthority], { skipPreflight: true });

    try {
      const amount = 1 * 10 ** decimals;
      const bigIntAmount = BigInt(amount);

      const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
        connection,
        sourceTokenAccount,
        mint.publicKey,
        destinationTokenAccount,
        wallet.publicKey,
        bigIntAmount,
        decimals,
        [],
        'confirmed',
        TOKEN_2022_PROGRAM_ID,
      );

       transaction = new Transaction().add(transferInstruction);
      await sendAndConfirmTransaction(connection, transaction, [wallet.payer], { skipPreflight: true });
      
      console.error("Transfer succeess");
    } catch (error) {
      console.log("Transfer failed as it should ", error.message);
    }
  });
});