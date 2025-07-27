import * as anchor from "@coral-xyz/anchor";
import * as utils from '../utils/utils';
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram } from "@solana/web3.js";
import { SpreePoints } from "../target/types/spree_points";

export const addToBurnWhitelist = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    userAta: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const burnWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), userAta.toBuffer()],
    }).burnWhitelistStatus;

    const ix = await program.methods.addToBurnWhitelist()
      .accountsStrict({
          signer: wallet.publicKey,
          user: userAta,
          whiteListStatus: burnWhitelistStatus,
          systemProgram: SystemProgram.programId,
          config: pdaMap.config,
      })
      .instruction();
    const tx = new Transaction().add(ix)
    
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

export const removeFromBurnWhitelist = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    userAta: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const burnWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), userAta.toBuffer()],
    }).burnWhitelistStatus;

    const ix = await program.methods.removeFromBurnWhitelist()
      .accountsStrict({
          signer: wallet.publicKey,
          user: userAta,
          whiteListStatus: burnWhitelistStatus,
          systemProgram: SystemProgram.programId,
          config: pdaMap.config,
      })
      .instruction();
    const tx = new Transaction().add(ix)

    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

export const updateBurnWhitelistAuthority = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    newAuthority: Keypair,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    const connection = program.provider.connection;

    const tx = new Transaction().add(
        await program.methods.updateBurnWhitelistAuthority()
        .accountsStrict({
            signer: wallet.publicKey,
            newAuthority: newAuthority.publicKey,
            config: pdaMap.config,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(connection, tx, [signer, newAuthority]);
};

export const isBurnWhitelisted = async (
    program: anchor.Program<SpreePoints>,
    userAta: PublicKey
): Promise<boolean> => {
    const burnWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), userAta.toBuffer()],
    }).burnWhitelistStatus;

    const statusInfo = await program.account.burnWhiteListStatus.fetch(burnWhitelistStatus);
    if (statusInfo) {
        return statusInfo.isActive;
    }
    return false;
};