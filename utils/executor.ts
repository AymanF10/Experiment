import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { SpreePoints } from "../target/types/spree_points";

export const updateExecutorAuthority = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    newAuthority: Keypair,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    const connection = program.provider.connection;

    const tx = new Transaction().add( 
        await program.methods.updateExecutorAuthority()
        .accountsStrict({
            signer: wallet.publicKey,
            newAuthority: newAuthority.publicKey,
            executor: pdaMap.executor,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(connection, tx, [signer, newAuthority]);
};

export const updateExecutorAccount = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    newExecutorAccount: PublicKey,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    const connection = program.provider.connection;

    const tx = new Transaction().add(
        await program.methods.updateExecutorAccount()
        .accountsStrict({
            signer: wallet.publicKey,
            executor: pdaMap.executor,
            newExecutorAccount: newExecutorAccount,
        })
        .instruction()
    );

    return await sendAndConfirmTransaction(connection, tx, [signer]);
};