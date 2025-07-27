import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

import type { SpreePoints } from "../target/types/spree_points";
import { TransferHook } from "../target/types/transfer_hook";

/**
 * **FREEZE an operation (All, Mint, Burn)**
 * @param {anchor.Program<SpreePoints>} program - The Anchor program instance.
 * @param {PublicKey} mint - The mint account whose freeze state is being modified.
 * @param {anchor.Wallet} wallet - The admin wallet signing the transaction.
 * @param {FreezeTarget} target - Which operation to freeze.
 * @returns {Promise<string>} - Transaction signature.
 */
export const freeze = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    target: any,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;

    const tx = new Transaction().add(
        await program.methods.freeze(target)
        .accountsStrict({
            freezeState: pdaMap.freezeState,
            signer: wallet.publicKey,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

/**
 * **FREEZE an operation Transfer**
 * @param {anchor.Program<SpreePoints>} program - The Anchor program instance.
 * @param {PublicKey} mint - The mint account whose freeze state is being modified.
 * @param {anchor.Wallet} wallet - The admin wallet signing the transaction.
 * @param {FreezeTarget} target - Which operation to freeze.
 * @returns {Promise<string>} - Transaction signature.
 */
export const freezeTransfer = async (
    program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet | Keypair,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;

    const tx = new Transaction().add(
        await program.methods.freeze()
        .accountsStrict({
            signer: wallet.publicKey,
            config: pdaMap.th_config,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

/**
 * **UNFREEZE an operation (All, Mint, Burn)**
 * @param {anchor.Program<SpreePoints>} program - The Anchor program instance.
 * @param {PublicKey} mint - The mint account whose freeze state is being modified.
 * @param {anchor.Wallet} wallet - The admin wallet signing the transaction.
 * @param {FreezeTarget} target - Which operation to unfreeze.
 * @param {Record<string, PublicKey>} pdaMap - The mint account whose freeze state is being checked.
 * @returns {Promise<string>} - Transaction signature.
 */
export const unfreeze = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet | Keypair,
    target: any,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;

    const tx = new Transaction().add(
        await program.methods.unfreeze(target)
        .accountsStrict({
            freezeState: pdaMap.freezeState,
            signer: wallet.publicKey,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};
/**
 * **UNFREEZE operation Transfer**
 * @param {anchor.Program<SpreePoints>} program - The Anchor program instance.
 * @param {PublicKey} mint - The mint account whose freeze state is being modified.
 * @param {anchor.Wallet} wallet - The admin wallet signing the transaction.
 * @param {FreezeTarget} target - Which operation to unfreeze.
 * @param {Record<string, PublicKey>} pdaMap - The mint account whose freeze state is being checked.
 * @returns {Promise<string>} - Transaction signature.
 */
export const unfreezeTransfer = async (
    program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet | Keypair,
    pdaMap: Record<string, PublicKey>,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;

    const tx = new Transaction().add(
        await program.methods.unfreeze()
        .accountsStrict({
            signer: wallet.publicKey,
            config: pdaMap.th_config,
        })
        .instruction()
    )

    return await sendAndConfirmTransaction(program.provider.connection, tx, [signer]);
};

/**
 * Updates freeze authority for Spree Points program or Transfer Hook.
 * @param {anchor.Program} program - The Anchor program instance.
 * @param {anchor.Wallet} wallet - The admin wallet signing the transaction.
 * @param {PublicKey} newAuthority - New freeze authority key.
 * @param {Record<string, PublicKey>} pdaMap - The mint account whose freeze state is being checked.
 * @param {boolean} isTransferHook - Points if it's a transfer hook program.
 * @returns {Promise<string>} - Transaction signature.
 */
export const updateFreezeAuthority = async (
    program: anchor.Program<SpreePoints> | anchor.Program<TransferHook>,
    wallet: anchor.Wallet | Keypair,
    newAuthority: Keypair,
    pdaMap: Record<string, PublicKey>,
    isTransferHook: boolean = false,
): Promise<string> => {
    const signer = wallet instanceof anchor.Wallet ? wallet.payer : wallet;
    const connection = program.provider.connection;

    let accounts
    if (isTransferHook) {
        accounts = {
            signer: wallet.publicKey,
            newAuthority: newAuthority.publicKey,
            config: pdaMap.th_config,
        }
    } else {
        accounts = {
            signer: wallet.publicKey,
            newAuthority: newAuthority.publicKey,
            freezeState: pdaMap.freezeState,
        }
    }
    const tx = new Transaction().add( 
        await program.methods.updateFreezeAuthority()
        .accountsStrict(accounts)
        .instruction()
    )

    return await sendAndConfirmTransaction(connection, tx, [signer, newAuthority]);
};

/**
 * Fetches the current freeze state from the on-chain PDA.
 * @param {anchor.Program} program - The Anchor program instance.
 * @param {Record<string, PublicKey>} pdaMap - The mint account whose freeze state is being checked.
 * @param {boolean} isTransferHook - Points if it's a transfer hook program.
 * @returns {Promise<any>} - Freeze state data.
 */
export const getFreezeState = async (
    program: anchor.Program<SpreePoints> | anchor.Program<TransferHook>,
    pdaMap: Record<string, PublicKey>,
    isTransferHook: boolean = false,
): Promise<any> => {
    try {
        let freezeState
        if (isTransferHook) {
            freezeState = await (program as anchor.Program<TransferHook>).account.config.fetch(pdaMap.th_config);
        } else {
            freezeState = await (program as anchor.Program<SpreePoints>).account.freezeState.fetch(pdaMap.freezeState);
        }
        return freezeState;
    } catch (error) {
        console.error("Error fetching freeze state:", error);
        return null;
    }
};
