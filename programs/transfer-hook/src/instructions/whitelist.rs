use crate::constants::*;
use crate::error::*;
use crate::{
    Config, UpdateConfigInfo, WhitelistAddEvent, WhitelistRemoveEvent,
    WhitelistUpdateEvent,
};
use anchor_lang::prelude::*;

pub fn _update_whitelist_authority(ctx: Context<UpdateConfigInfo>) -> Result<()> {
    let config: &mut Account<'_, Config> = &mut ctx.accounts.config;
    let new_authority = &mut ctx.accounts.new_authority;

    if config.whitelist_authority != ctx.accounts.signer.key() {
        msg!("Only the authority can modify whitelist state!");
        return Err(SpreeTokenError::Unauthorized.into());
    }

    if config.whitelist_authority == new_authority.key() {
        msg!("New authority is the same as the current one.");
        return Err(SpreeTokenError::InvalidData.into());
    }

    config.whitelist_authority = new_authority.key();
    msg!("Whitelist authority updated to {}", new_authority.key());

    emit!(WhitelistUpdateEvent {
        old_authority: ctx.accounts.signer.key(),
        new_authority: new_authority.key(),
    });

    Ok(())
}

pub fn _add_to_whitelist(ctx: Context<WhiteListInfo>) -> Result<()> {
    if ctx.accounts.config.whitelist_authority != ctx.accounts.signer.key() {
        msg!("Only the authority can add to whitelist.");
        return Err(SpreeTokenError::Unauthorized.into());
    }

    let white_list_status: &mut Account<'_, WhiteListStatus> = &mut ctx.accounts.white_list_status;

    if white_list_status.is_active {
        msg!("Account already has required white list status.");
    } else {
        white_list_status.is_active = true;

        emit!(WhitelistAddEvent {
            authority: ctx.accounts.signer.key(),
            account_added: ctx.accounts.user.key(),
        });
    }

    Ok(())
}

pub fn _remove_from_whitelist(ctx: Context<WhiteListInfo>) -> Result<()> {
    if ctx.accounts.config.whitelist_authority != ctx.accounts.signer.key() {
        msg!("Only the authority can remove from the white list.");
        return Err(SpreeTokenError::Unauthorized.into());
    }

    let white_list_status: &mut Account<'_, WhiteListStatus> = &mut ctx.accounts.white_list_status;

    if !white_list_status.is_active {
        msg!("Account already has required white list status.");
    } else {
        white_list_status.is_active = false;

        emit!(WhitelistRemoveEvent {
            authority: ctx.accounts.signer.key(),
            account_removed: ctx.accounts.user.key(),
        });
    }

    Ok(())
}

#[derive(Accounts)]
pub struct WhiteListInfo<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: New account to add to white list
    #[account()]
    pub user: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = signer,
        seeds = [WHITELIST_SEED, user.key().as_ref()],
        bump,
        space = DISCRIMINATOR + WhiteListStatus::INIT_SPACE
    )]
    pub white_list_status: Account<'info, WhiteListStatus>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct WhiteListStatus {
    pub is_active: bool,
}
