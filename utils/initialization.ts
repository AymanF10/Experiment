import assert from "assert";
import path from "path";
import { readFileSync } from "fs";
import * as toml from "toml";
import * as anchor from "@coral-xyz/anchor";
import { sendAndConfirmTransaction, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import { SP_DECIMALS } from "../utils/constants";
import type { SpreePoints } from "../target/types/spree_points";
import type { TransferHook } from "../target/types/transfer_hook";

// Parse Anchor.toml config to get tranfer hook program id
const anchorTomlPath = path.resolve(__dirname, '../Anchor.toml');
const anchorToml = readFileSync(anchorTomlPath, 'utf-8');
const parsedToml = toml.parse(anchorToml);

export const initializeMint = async (
    mint_program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    usdcMint: PublicKey,
    pdaMap: Record<string, PublicKey>
) => {
    const connection = mint_program.provider.connection;

    const mintInfo = await connection.getAccountInfo(pdaMap.mint);
    if (mintInfo) {
        console.log("Mint already exists, skipping initialization.");
        return;
    }

    const transferHookProgramId = parsedToml.programs.localnet.transfer_hook
    const metadata = {
        name: "Spree Points",
        symbol: "SP",
        uri: "https://arweave.net/J1_iovGsMwTBJcJOln_hSsNrikXmawXF3wHF0LhOZ4I",
        decimals: SP_DECIMALS,
        transferHookProgramId: new PublicKey(transferHookProgramId),
    }

    const tx = new Transaction().add(
        await mint_program.methods
            .initializeToken(metadata)
            .accountsStrict({
                signer: wallet.publicKey,
                mint: pdaMap.mint,
                usdcMint,
                usdcKeeper: pdaMap.usdcKeeper,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenProgram2022: TOKEN_2022_PROGRAM_ID,
            })
            .instruction()
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    console.log("Mint initialized:", sig);
};

export const initializeFees = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    feeCollectorPubkey: PublicKey,
    initFeesArgs: {
        mintFeeBps: number;
        transferFeeBps: number;
        redemptionFeeBps: number;
        feeCollector: PublicKey;
    },
    pdaMap: Record<string, PublicKey>
): Promise<boolean> => {
    const connection = program.provider.connection;
    const feesInfo = await connection.getAccountInfo(pdaMap.fees);

    if (feesInfo) {
        console.log("Fees account already already exists, skipping initialization.");
        return true;
    }

    const tx = new Transaction();

    const feeCollectorInfo = await connection.getAccountInfo(initFeesArgs.feeCollector);
    if (!feeCollectorInfo) {
        console.log("Fee collector account doesn't exist, creating...");
        tx.add(
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                initFeesArgs.feeCollector,
                feeCollectorPubkey,
                pdaMap.mint,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            )
        );
    }

    tx.add(
        await program.methods
            .initializeFees({
                mintFeeBps: initFeesArgs.mintFeeBps,
                transferFeeBps: initFeesArgs.transferFeeBps,
                redemptionFeeBps: initFeesArgs.redemptionFeeBps,
                feeCollector: initFeesArgs.feeCollector,
            })
            .accountsStrict({
                signer: wallet.publicKey,
                fees: pdaMap.fees,
                systemProgram: SystemProgram.programId,
            })
            .instruction()
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    console.log("Fees initialized:", sig);

    const newFeesData = await program.account.fees.fetch(pdaMap.fees);
    assert(newFeesData, "Fees account should be initialized.");
    return false;
};

export const initializeMintKeeper = async (
    mint_program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    pdaMap: Record<string, PublicKey>
) => {
    const connection = mint_program.provider.connection;

    const tx = new Transaction().add(
        await mint_program.methods
            .initializeMintKeeper()
            .accountsStrict({
                signer: wallet.publicKey,
                mint: pdaMap.mint,
                keeperPda: pdaMap.keeperPda,
                mintKeeper: pdaMap.mintKeeper,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
                tokenProgram2022: TOKEN_2022_PROGRAM_ID
            })
            .instruction()
    );

    await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
};

export const initializeFreeze = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    pdaMap: Record<string, PublicKey>
): Promise<boolean> => {
    const connection = program.provider.connection;
    const freezeStateInfo = await connection.getAccountInfo(pdaMap.freezeState);

    if (freezeStateInfo) {
        console.log("Freeze Account already already exists, skipping initialization.");
        return true;
    }

    const ix = await program.methods
        .intializeFreeze()
        .accountsStrict({
            signer: wallet.publicKey,
            systemProgram: SystemProgram.programId,
            freezeState: pdaMap.freezeState,
        })
        .instruction();

    const tx = new Transaction().add(ix);

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    console.log("Freeze Account initialized:", sig);
};

export const initializeConfig = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    pdaMap: Record<string, PublicKey>
): Promise<boolean> => {
    const connection = program.provider.connection;
    const configInfo = await connection.getAccountInfo(pdaMap.config);

    if (configInfo) {
        console.log("Config Account already exists, skipping initialization.");
        return true;
    }

    const ix = await program.methods
        .initializeConfig()
        .accountsStrict({
            signer: wallet.publicKey,
            systemProgram: SystemProgram.programId,
            config: pdaMap.config,
        })
        .instruction();

    const tx = new Transaction().add(ix);

    await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
};

export const initializeExecutor = async (
    program: anchor.Program<SpreePoints>,
    wallet: anchor.Wallet,
    pdaMap: Record<string, PublicKey>,
    initExecutorArgs: {
        executorAccount: PublicKey;
    }
): Promise<boolean> => {
    const connection = program.provider.connection;

    const executorInfo = await connection.getAccountInfo(pdaMap.executor);
    if (executorInfo) {
        console.log("Executor Account already exists, skipping initialization.");
        return true;
    }

    const ix = await program.methods
        .initializeExecutor(initExecutorArgs)
        .accountsStrict({
            signer: wallet.publicKey,
            systemProgram: SystemProgram.programId,
            executor: pdaMap.executor,
        })
        .instruction();

    const tx = new Transaction().add(ix);

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    console.log("Executor Account initialized:", sig);
};

export const initializeExtraAccountMetaList = async (
    program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet,
    pdaMap: Record<string, PublicKey>
) => {
    const connection = program.provider.connection;

    const metaListInfo = await connection.getAccountInfo(pdaMap.extraAccountMetaList);
    if (metaListInfo) {
        console.log("ExtraAccountMetaList already exists, skipping initialization.");
        return;
    }

    const ix = await program.methods
        .initializeExtraAccountMetaList()
        .accountsStrict({
            mint: pdaMap.mint,
            extraAccountMetaList: pdaMap.extraAccountMetaList,
            signer: wallet.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            config: pdaMap.th_config,
        })
        .instruction();

    const tx = new Transaction().add(ix);

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    console.log("ExtraAccountMetaList initialized:", sig);
};

/**
 * Initialize all necessary accounts (Mint, Fees, etc.); useful to just quick init
 */
export const initializeAll = async (
    mint_program: anchor.Program<SpreePoints>,
    transfer_program: anchor.Program<TransferHook>,
    wallet: anchor.Wallet,
    usdcMint: PublicKey,
    feeCollectorPubkey: PublicKey,
    initFeesArgs: {
        mintFeeBps: number;
        transferFeeBps: number;
        redemptionFeeBps: number;
        feeCollector: PublicKey;
    },
    pdaMap: Record<string, PublicKey>) => {

    await initializeMint(mint_program, wallet, usdcMint, pdaMap);
    await initializeFreeze(mint_program, wallet, pdaMap);
    await initializeFees(mint_program, wallet, feeCollectorPubkey, initFeesArgs, pdaMap);
    await initializeConfig(mint_program, wallet, pdaMap)
    await initializeExtraAccountMetaList(transfer_program, wallet, pdaMap);
};
