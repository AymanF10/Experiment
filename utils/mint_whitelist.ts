import * as anchor from "@coral-xyz/anchor";
import * as utils from '../utils/utils';
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram } from "@solana/web3.js";
import { SpreePoints } from "../target/types/spree_points";

export const addToMintWhitelist = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    userAta: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const whitelistStatus = utils.findPDAs(program, {
        whitelistReceiverStatus: [Buffer.from(utils.MINT_WHITELIST_SEED), userAta.toBuffer()],
    }).whitelistReceiverStatus;

    const ix = await program.methods.addToMintWhitelist()
      .accountsStrict({
          signer: wallet.publicKey,
          user: userAta,
          whiteListStatus: whitelistStatus,
          systemProgram: SystemProgram.programId,
          config: pdaMap.config,
      })
      .instruction();
    const tx = new Transaction().add(ix)
    
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

export const removeFromMintWhitelist = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    userAta: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const whitelistStatus = utils.findPDAs(program, {
        whitelistReceiverStatus: [Buffer.from(utils.MINT_WHITELIST_SEED), userAta.toBuffer()],
    }).whitelistReceiverStatus;

    const ix = await program.methods.removeFromMintWhitelist()
      .accountsStrict({
          signer: wallet.publicKey,
          user: userAta,
          whiteListStatus: whitelistStatus,
          systemProgram: SystemProgram.programId,
          config: pdaMap.config,
      })
      .instruction();
    const tx = new Transaction().add(ix)

    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

export const updateMintWhitelistAuthority = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    newAuthority: Keypair,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    const connection = program.provider.connection;

    const tx = new Transaction().add( 
        await program.methods.updateMintWhitelistAuthority()
        .accountsStrict({
            signer: wallet.publicKey,
            newAuthority: newAuthority.publicKey,
            config: pdaMap.config,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(connection, tx, [signer, newAuthority]);
};

export const isMintWhitelisted = async (
    program: anchor.Program<SpreePoints>,
    userAta: PublicKey,
): Promise<boolean> => {
    const whitelistStatus = utils.findPDAs(program, {
        whitelistStatus: [Buffer.from(utils.MINT_WHITELIST_SEED), userAta.toBuffer()],
    }).whitelistStatus;

    const statusInfo = await program.account.mintWhiteListStatus.fetchNullable(whitelistStatus);
    if (statusInfo) {
        return statusInfo.isActive;
    }
    return false;
}