use anchor_lang::prelude::*; 

#[constant]
pub const TOKEN_2022_SEED: &[u8] = b"token-2022";

#[constant]
pub const FEES_SEED: &[u8] = b"fees";

#[constant]
pub const USDC_SEED: &[u8] = b"usdc";

// Mainnet - EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
// Devnet - 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
#[constant]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[constant]
pub const SP_DECIMALS: u8 = 6;

#[constant]
pub const USDC_DECIMALS: u8 = 6;

// USDC - 6 decimals | SP - 6 decimals
#[constant]
pub const SP_PER_USDC: u64 = 100;

pub const DISCRIMINATOR: usize = 8;

#[constant]
pub const META_LIST_ACCOUNT_SEED: &[u8] = b"extra-account-metas";

#[constant]
pub const WHITELIST_SEED: &[u8] = b"whitelist";

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const FREEZE_SEED: &[u8] = b"freeze";

#[constant]
pub const SPREE_PROGRAM_ID: Pubkey = pubkey!("7YGe4NuGaVxR3xgmGguzyLNEQLV1uD4sEYsCaeNKGjdd");
