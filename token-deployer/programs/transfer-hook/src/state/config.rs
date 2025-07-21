use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub whitelist_authority: Pubkey,
    pub freeze_authority: Pubkey,
    pub freeze_transfer: bool,
}