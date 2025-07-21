use anchor_lang::prelude::*;
use crate::error::*;
use crate::{FreezeStateChangedEvent, Config, ConfigInfo, UpdateConfigInfo};

pub fn _update_freeze_authority(ctx: Context<UpdateConfigInfo>) -> Result<()> {
    let config: &mut Account<'_, Config> = &mut ctx.accounts.config;
    let new_authority = &mut ctx.accounts.new_authority;

    if config.freeze_authority != ctx.accounts.signer.key() {
        msg!("Only the authority can modify freeze state!");
        return Err(SpreeTokenError::Unauthorized.into())
    }

    if config.freeze_authority == new_authority.key() {
        msg!("New authority is the same as the current one.");
        return Err(SpreeTokenError::InvalidData.into());
    }

    config.freeze_authority = new_authority.key();
    msg!("Freeze authority updated to {}", new_authority.key());

    emit!(FreezeStateChangedEvent {
        authority: new_authority.key(),
        is_frozen: config.freeze_transfer,
        target: FreezeTarget::None,
    });

    Ok(())
}

pub fn _toggle_freeze(ctx: Context<ConfigInfo>, freeze: bool) -> Result<()> {
    if ctx.accounts.config.freeze_authority != ctx.accounts.signer.key() {
        msg!("Only the authority can modify freeze state!");
        return Err(SpreeTokenError::Unauthorized.into());
    }

    let config: &mut Account<'_, Config> = &mut ctx.accounts.config;

    config.freeze_transfer = freeze;

    msg!("Transfering is now {}.", if freeze { "frozen" } else { "unfrozen" });

    emit!(FreezeStateChangedEvent {
        authority: ctx.accounts.signer.key(),
        is_frozen: freeze,
        target: FreezeTarget::Transfer,
    });

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum FreezeTarget {
    All,
    Mint,
    Transfer,
    Burn,
    None,
}
