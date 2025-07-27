import * as anchor from "@coral-xyz/anchor";
import { sendAndConfirmTransaction, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as utils from "../utils/utils";
import { SpreePoints } from "../target/types/spree_points"
import { getOrCreateAssociatedTokenAddressATA } from "../utils/utils";

/**
 * Burns a specified amount of tokens from the sender's account.
 *
 * @param {anchor.Program} program - The Anchor program instance.
 * @param {anchor.Wallet} wallet - The user's wallet.
 * @param {anchor.BN} amount - The amount of tokens to burn.
 * @param {PublicKey} payerATA - The user's token account (from which tokens are burned).
 * @param {PublicKey} escrowATA - The escrow's associated token account.
 * @param {Record<string, PublicKey>} pdaMap - PDA map containing relevant program addresses.
 * @param {PublicKey} usdcMint - The USDC mint address.
 * @returns {Promise<string>} The transaction signature.
 */
export async function requestBurn(
    program: anchor.Program<SpreePoints>,
    burnFrom: anchor.Wallet,
    burnRecipient: PublicKey,
    amount: anchor.BN,
    pdaMap: Record<string, PublicKey>,
): Promise<string> {
    const connection = program.provider.connection;

    const burnWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), burnFrom.publicKey.toBuffer()],
    }).burnWhitelistStatus;

    const recipientWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), burnRecipient.toBuffer()],
    }).burnWhitelistStatus;

    const burnRequest = utils.findPDAs(program, {
        burnRequest: [Buffer.from(utils.BURN_REQUEST_SEED), burnFrom.publicKey.toBuffer()],
    }).burnRequest;

    const burnFromATA = await utils.getOrCreateAssociatedTokenAddressATA(connection, burnFrom.payer, pdaMap.mint, burnFrom.publicKey);

    let tx = new Transaction().add(
        await program.methods
        .requestBurn(amount)
        .accountsStrict({
            signer: burnFrom.publicKey,
            mint: pdaMap.mint,
            fees: pdaMap.fees,
            freezeState: pdaMap.freezeState,
            burnerWhitelistStatus: burnWhitelistStatus,
            recipientWhitelistStatus: recipientWhitelistStatus,
            burnRequest: burnRequest,
            fromAta: burnFromATA,
            mintKeeper: pdaMap.mintKeeper,
            recipient: burnRecipient,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            tokenProgram2022: TOKEN_2022_PROGRAM_ID,
            // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .instruction()
    );

    return await sendAndConfirmTransaction(connection, tx, [burnFrom.payer]);
}

export async function cancelBurnRequest(
    program: anchor.Program<SpreePoints>,
    burnFrom: anchor.Wallet,
    pdaMap: Record<string, PublicKey>,
): Promise<string> {
    const connection = program.provider.connection;

    const burnWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), burnFrom.publicKey.toBuffer()],
    }).burnWhitelistStatus;

    const burnRequest = utils.findPDAs(program, {
        burnRequest: [Buffer.from(utils.BURN_REQUEST_SEED), burnFrom.publicKey.toBuffer()],
    }).burnRequest;

    const burnFromATA = await utils.getOrCreateAssociatedTokenAddressATA(connection, burnFrom.payer, pdaMap.mint, burnFrom.publicKey);

    let tx = new Transaction().add(
        await program.methods
        .cancelBurnRequest()
        .accountsStrict({
            signer: burnFrom.publicKey,
            mint: pdaMap.mint,
            freezeState: pdaMap.freezeState,
            burnerWhitelistStatus: burnWhitelistStatus,
            burnRequest: burnRequest,
            keeperPda: pdaMap.keeperPda,
            mintKeeper: pdaMap.mintKeeper,
            toAta: burnFromATA,
            tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        })
        .instruction()
    );

    return await sendAndConfirmTransaction(connection, tx, [burnFrom.payer]);
}


export async function finalizeBurnRequest(
    program: anchor.Program<SpreePoints>,
    signer: anchor.Wallet,
    burnFrom: PublicKey,
    burnRecipient: anchor.Wallet,
    pdaMap: Record<string, PublicKey>,
    ataMap: Record<string, PublicKey>,
    usdcMint: anchor.web3.PublicKey,
    mintAuthority: anchor.Wallet,
): Promise<string> {
    const connection = program.provider.connection;

    const burnWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), burnFrom.toBuffer()],
    }).burnWhitelistStatus;

    const recipientWhitelistStatus = utils.findPDAs(program, {
        burnWhitelistStatus: [Buffer.from(utils.BURN_WHITELIST_SEED), burnRecipient.publicKey.toBuffer()],
    }).burnWhitelistStatus;

    const burnRequest = utils.findPDAs(program, {
        burnRequest: [Buffer.from(utils.BURN_REQUEST_SEED), burnFrom.toBuffer()],
    }).burnRequest;

    const usdcToAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: burnRecipient.publicKey,
    });

    const tx = new Transaction().add(
        await program.methods
        .finalizeBurnRequest()
        .accountsStrict({
            mintAuthority: mintAuthority.publicKey,
            executor: pdaMap.executor,
            signer: signer.publicKey,
            mint: pdaMap.mint,
            usdcMint: usdcMint,
            fees: pdaMap.fees,
            freezeState: pdaMap.freezeState,
            burnerWhitelistStatus: burnWhitelistStatus,
            recipientWhitelistStatus: recipientWhitelistStatus,
            feeCollector: ataMap.feeCollector2,
            burner: burnFrom,
            burnRequest: burnRequest,
            recipient: burnRecipient.publicKey,
            usdcToAta: usdcToAta,
            usdcKeeper: pdaMap.usdcKeeper,
            keeperPda: pdaMap.keeperPda,
            mintKeeper: pdaMap.mintKeeper,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            tokenProgram2022: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
        .instruction()
    );

    return await sendAndConfirmTransaction(connection, tx, [signer.payer, mintAuthority.payer]);
}