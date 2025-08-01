use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, 
    Token, 
    TokenAccount, 
    Burn, 
    Mint, 
    MintTo
};

declare_id!("6VvzGBoX9nT4U6no4Yc8GwmN6h3ckvyRu24rCZzUfpsp");

const MINT_AUTH_SEED: &[u8] = b"jupiter-mint-auth";

#[program]
pub mod mock_jupiter {
    use super::*;

    pub fn route(
        ctx: Context<RouteAccounts>, 
        route_plan: Vec<RoutePlanStep>, 
        in_amount: u64, 
        quoted_out_amount: u64, 
        slippage_bps: u16, 
        platform_fee_bps: u8
    ) -> Result<u64> {
        msg!("Mock Jupiter: Route swap of {} tokens", in_amount);
        
        if route_plan.is_empty() {
            return err!(ErrorCode::EmptyRoute);
        }
        
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.source_mint.to_account_info(),
                    from: ctx.accounts.user_source_token_account.to_account_info(),
                    authority: ctx.accounts.user_transfer_authority.to_account_info(),
                },
            ),
            in_amount,
        )?;
        
        let out_amount = quoted_out_amount;
        
        let fee_amount = if platform_fee_bps > 0 && ctx.accounts.platform_fee_account.is_some() {
            let fee = (out_amount as u128 * platform_fee_bps as u128 / 10000) as u64;
            if fee > 0 {
                msg!("Platform fee would be {} tokens", fee);
            }
            fee
        } else {
            0
        };
        
        let bump = ctx.bumps.mint_authority;
        let seeds = &[MINT_AUTH_SEED, &[bump]];
        let signer_seeds = &[&seeds[..]];
        
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.destination_mint.to_account_info(),
                    to: ctx.accounts.user_destination_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            out_amount - fee_amount,
        )?;
        
        msg!("Route swap completed successfully");
        msg!("Swapped {} input tokens for {} output tokens", in_amount, out_amount - fee_amount);
        
        Ok(out_amount - fee_amount)
    }
}

#[derive(Accounts)]
pub struct RouteAccounts<'info> {
    pub token_program: Program<'info, Token>,
    
    #[account(mut)]
    pub user_transfer_authority: Signer<'info>,
    
    #[account(mut)]
    pub user_source_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_destination_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Optional account - ownership check is disabled for mock
    #[account(mut)]
    pub destination_token_account: Option<UncheckedAccount<'info>>,
    
    #[account(mut)]
    pub destination_mint: Account<'info, Mint>,
    
    /// CHECK: Optional account - ownership check is disabled for mock
    #[account(mut)]
    pub platform_fee_account: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Not used in mock
    pub event_authority: UncheckedAccount<'info>,
    
    /// CHECK: Not used in mock
    pub program: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub source_mint: Account<'info, Mint>,
    
    /// CHECK: PDA owned by this program that signs for mint
    #[account(
        seeds = [MINT_AUTH_SEED],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RoutePlanStep {
    pub swap: Swap,
    pub percent: u8,
    pub input_index: u8,
    pub output_index: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum Swap {
    Saber,
    Raydium,
    Orca,
    Whirlpool { a_to_b: bool },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum Side {
    Bid,
    Ask,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Empty route")]
    EmptyRoute,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageToleranceExceeded,
    
    #[msg("Invalid calculation")]
    InvalidCalculation,
    
    #[msg("Missing platform fee account")]
    MissingPlatformFeeAccount,
}