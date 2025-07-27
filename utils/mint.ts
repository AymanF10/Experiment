import * as anchor from '@coral-xyz/anchor';
import { sendAndConfirmTransaction, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as utils from '../utils/utils';
import type { SpreePoints } from "../target/types/spree_points";

/**
 * General-purpose function to mint tokens.
 *
 * @param {anchor.Program<any>} program - The Anchor program instance.
 * @param {anchor.Wallet} wallet - The wallet signing the transaction.
 * @param {anchor.BN} mintAmount - Amount of tokens to mint.
 * @param {PublicKey} payerATA - Associated token account of the payer.
 * @param {Record<string, PublicKey>} pdaMap - Contains various PDAs related to minting.
 * @param {PublicKey} usdcMint - The USDC mint address.
 * @returns {Promise<string>} - The transaction signature.
 */
export async function mintTokens(
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    mintAmount: anchor.BN,
    payerATA: PublicKey,
    pdaMap: Record<string, PublicKey>,
    usdcMint: PublicKey
): Promise<string> {
    const connection = program.provider.connection;

    const usdcFromAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: wallet.publicKey,
    })

    const feesAccount = await program.account.fees.fetch(pdaMap.fees);

    const mintWhitelistStatus = utils.findPDAs(program, {
      mintWhitelistStatus: [Buffer.from(utils.MINT_WHITELIST_SEED), wallet.publicKey.toBuffer()],
    }).mintWhitelistStatus;

    const tx = new Transaction().add(
        await program.methods
            .mintTokens(mintAmount)
            .accountsStrict({
                signer: wallet.publicKey,
                mint: pdaMap.mint,
                usdcMint,
                usdcKeeper: pdaMap.usdcKeeper,
                toAta: payerATA,
                usdcFromAta: usdcFromAta,
                fees: pdaMap.fees,
                feeCollector: feesAccount.feeCollector,
                freezeState: pdaMap.freezeState,
                whiteListStatus: mintWhitelistStatus,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenProgram2022: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .instruction()
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    return sig;
}
