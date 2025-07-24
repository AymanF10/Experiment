use anchor_lang::prelude::*;

use crate::FreezeTarget;

#[event]
pub struct TransferEvent {
    pub source: Pubkey,
    pub destination: Pubkey,
    pub fee_amount: u64,
    pub amount: u64,
}

#[event]
pub struct WhitelistAddEvent {
    pub authority: Pubkey,
    pub account_added: Pubkey,
}

#[event]
pub struct WhitelistUpdateEvent {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct WhitelistRemoveEvent {
    pub authority: Pubkey,
    pub account_removed: Pubkey,
}

#[event]
pub struct FreezeStateChangedEvent {
    pub authority: Pubkey,
    pub target: FreezeTarget,
    pub is_frozen: bool,
}
