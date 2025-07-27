import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram } from "@solana/web3.js";

import { TransferHook } from "../target/types/transfer_hook";

export const addToWhitelist = async (
    program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet | Keypair,
    userAta: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;

    const tx = new Transaction().add(
        await program.methods.addToWhitelist()
        .accountsStrict({
            signer: wallet.publicKey,
            user: userAta,
            config: pdaMap.th_config,
            whiteListStatus: pdaMap.whitelistReceiverStatus,
            systemProgram: SystemProgram.programId,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

export const removeFromWhitelist = async (
    program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet | Keypair,
    userAta: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;

    const tx = new Transaction().add(
        await program.methods.removeFromWhitelist()
        .accountsStrict({
            signer: wallet.publicKey,
            user: userAta,
            config: pdaMap.th_config,
            whiteListStatus: pdaMap.whitelistReceiverStatus,
            systemProgram: SystemProgram.programId,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

export const updateWhitelistAuthority = async (
    program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet | Keypair,
    newAuthority: Keypair,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    const connection = program.provider.connection;

    const tx = new Transaction().add( 
        await program.methods.updateWhitelistAuthority()
        .accountsStrict({
            signer: wallet.publicKey,
            newAuthority: newAuthority.publicKey,
            config: pdaMap.th_config,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(connection, tx, [signer, newAuthority]);
};
