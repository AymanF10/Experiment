use anchor_lang::prelude::*;
use std::cell::RefMut;

use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::spl_token_2022::{
        extension::{
            transfer_hook::TransferHookAccount,
            BaseStateWithExtensionsMut,
            PodStateWithExtensionsMut,
        },
        pod::PodAccount,
    },
    token_interface::{
        Mint as Mint2022,
        TokenAccount as TokenAccount2022,
        TokenInterface,
    },
};
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::constants::*;
use crate::error::*;
use crate::state::*;
use crate::{Config, WhiteListStatus};

#[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]
pub fn _initialize_extra_account_meta_list(ctx: Context<InitializeExtraAccountMetaList>,) -> Result<()> {

    ctx.accounts.config.whitelist_authority = ctx.accounts.signer.key();
    ctx.accounts.config.freeze_authority = ctx.accounts.signer.key();

    let extra_account_metas = InitializeExtraAccountMetaList::extra_account_metas()?;

    // initialize ExtraAccountMetaList account with extra accounts
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
        &extra_account_metas,
    )?;

    Ok(())
}

#[interface(spl_transfer_hook_interface::execute)]
pub fn _transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {

    if ctx.accounts.config.freeze_transfer {
        return Err(SpreeTokenError::TransferFrozen.into());
    }

    // Fail this instruction if it is not called from within a transfer hook
    check_is_transferring(&ctx)?;

    let white_list_status = &mut ctx.accounts.white_list_status;

    if !bool::from(white_list_status.is_active) {
        msg!("Recipient not whitelisted: {:?}", ctx.accounts.destination_token.key());
        return Err(SpreeTokenError::RecipientNotWhitelisted.into());
    }

    emit!(TransferEvent {
        source: ctx.accounts.source_token.key(),
        destination: ctx.accounts.destination_token.key(),
        fee_amount: 0, //TODO: add value when task complete
        amount,
    });

    Ok(())
}

fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    let mut account_data_ref: RefMut<&mut [u8]> = source_token_info.try_borrow_mut_data()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;

    if !bool::from(account_extension.transferring) {
        msg!("Transfer operation not allowed: the `transferring` flag is false.");
        return Err(SpreeTokenError::IsNotCurrentlyTransferring.into());
    }

    Ok(())
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(
            vec![
                ExtraAccountMeta::new_with_seeds(
                    &[
                        Seed::Literal {
                            bytes: CONFIG_SEED.to_vec(),
                        },
                    ],
                    false, // is_signer
                    true // is_writable
                )?,
                ExtraAccountMeta::new_with_seeds(
                    &[
                        Seed::Literal {
                            bytes: WHITELIST_SEED.to_vec(),
                        },
                        Seed::AccountKey { index: 2 },
                    ],
                    false, // is_signer
                    true // is_writable
                )?,
            ]
        )
    }
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint2022>,

    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        init_if_needed,
        payer = signer,
        seeds = [META_LIST_ACCOUNT_SEED, mint.key().as_ref()], 
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas()?.len()
        )?,
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        seeds = [CONFIG_SEED],
        bump,
        space = DISCRIMINATOR + Config::INIT_SPACE
    )]
    pub config: Account<'info, Config>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// Order of accounts matters for this struct.
// The first 4 accounts are the accounts required for token transfer (source, mint, destination, owner)
// Remaining accounts are the extra accounts required from the ExtraAccountMetaList account
// These accounts are provided via CPI to this program from the token2022 program
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(
        token::mint = mint, 
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount2022>,

    pub mint: InterfaceAccount<'info, Mint2022>,

    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount2022>,

    /// CHECK: source token account owner, can be SystemAccount or PDA owned by another program
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList account
    #[account(
        seeds = [META_LIST_ACCOUNT_SEED, mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [WHITELIST_SEED, destination_token.key().as_ref()],
        bump
    )]
    pub white_list_status: Account<'info, WhiteListStatus>,
}

#[derive(Accounts)]
pub struct ConfigInfo<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct UpdateConfigInfo<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut)]
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
}

