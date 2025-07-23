use anchor_lang::prelude::*;
use anchor_spl::token_2022::{Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use std::str::FromStr;
use jupiter_aggregator::program::Jupiter;

declare_program!(jupiter_aggregator);
declare_id!("CEzsTf7eM9ac1kGx7DuZHdXv8b4mLPQBbRzrQcMJmJBh");

const VAULT_SEED: &[u8] = b"vault";
const JUP_PROGRAM_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const USDC_MINT_STR: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022_PROGRAM: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SP_MINT_STR: &str = "SPooKYFSh7SnZUMGKGYU9EbAGXLKkH4gSZyJRcLcfC";
const SP_PER_USDC: u64 = 100;

pub fn jupiter_program_id() -> Pubkey {
    Pubkey::from_str(JUP_PROGRAM_ID).unwrap_or_else(|_| panic!("Invalid Jupiter program ID"))
}

pub fn usdc_mint_id() -> Pubkey {
    Pubkey::from_str(USDC_MINT_STR).unwrap_or_else(|_| panic!("Invalid USDC mint"))
}

pub fn token_program_id() -> Pubkey {
    Pubkey::from_str(TOKEN_PROGRAM).unwrap_or_else(|_| panic!("Invalid token program"))
}

pub fn token2022_program_id() -> Pubkey {
    Pubkey::from_str(TOKEN2022_PROGRAM).unwrap_or_else(|_| panic!("Invalid token2022 program"))
}

pub fn sp_mint_id() -> Pubkey {
    Pubkey::from_str(SP_MINT_STR).unwrap_or_else(|_| panic!("Invalid SP mint"))
}

// Helper functions
fn validate_deposit(ctx: &Context<DepositEcosystem>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    require!(
        !ctx.accounts.config.global_freeze && !ctx.accounts.ecosystem_config.ecosystem_freeze,
        ErrorCode::FreezeStateActive
    );

    require!(
        ctx.accounts.to_ata.owner == ctx.accounts.payer.key(),
        ErrorCode::Unauthorized
    );
    require!(
        ctx.accounts.to_ata.mint == ctx.accounts.mint.key(),
        ErrorCode::InvalidToken
    );
    
    let current_supply = ctx.accounts.mint.supply;
    let max_minting_cap = ctx.accounts.ecosystem_config.max_minting_cap;
    
    require!(
        current_supply.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)? <= max_minting_cap,
        ErrorCode::ExceedsMaximumCap
    );
    
    Ok(())
}

fn validate_swap(ctx: &Context<Swap>, amount: u64, purchase_reference: &str) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    require!(
        !ctx.accounts.config.global_freeze && !ctx.accounts.ecosystem_config.ecosystem_freeze,
        ErrorCode::FreezeStateActive
    );

    require!(
        ctx.accounts.user_token_account.owner == ctx.accounts.payer.key(),
        ErrorCode::Unauthorized
    );
    require!(
        ctx.accounts.user_token_account.mint == ctx.accounts.mint.key(),
        ErrorCode::InvalidToken
    );

    require!(
        purchase_reference.len() <= 64,
        ErrorCode::InvalidPurchaseReference
    );
    
    require_keys_eq!(*ctx.accounts.jupiter_program.key, jupiter_program_id());

    require_keys_eq!(
        ctx.accounts.input_mint.key(),
        ctx.accounts.ecosystem_config.collateral_token_mint,
        ErrorCode::InvalidCollateralToken
    );
    
    require_keys_eq!(
        ctx.accounts.output_mint.key(),
        usdc_mint_id(),
        ErrorCode::InvalidOutputMint
    );
    
    Ok(())
}

fn calculate_fee(amount: u64, fee_basis_points: u16) -> Result<u64> {
    amount
        .checked_mul(fee_basis_points as u64)
        .ok_or(ErrorCode::ArithmeticOverflow.into())?
        .checked_div(10000)
        .ok_or(ErrorCode::ArithmeticOverflow.into())
}

fn process_fee(ctx: &mut Context<DepositEcosystem>, fee_amount: u64, swap_data: &[u8]) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let mint_key_ref = mint_key.as_ref();
    let fee_vault_authority_seeds = &[
        b"fee_vault_authority".as_ref(),
        mint_key_ref,
        &[ctx.bumps.fee_vault_authority],
    ];
    let fee_vault_authority_signer_seeds = &[&fee_vault_authority_seeds[..]];
    
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.collateral_token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.user_collateral_account.to_account_info(),
                to: ctx.accounts.vault_input_token_account.to_account_info(),
                authority: ctx.accounts.fee_vault_authority.to_account_info(),
                mint: ctx.accounts.collateral_token_mint.to_account_info(),
            },
            fee_vault_authority_signer_seeds,
        ),
        fee_amount,
        ctx.accounts.collateral_token_mint.decimals,
    )?;
    
    let out_token_balance_before = ctx.accounts.vault_output_token_account.amount;
    
    require_keys_eq!(*ctx.accounts.jupiter_program.key, jupiter_program_id());
    
    let accounts: Box<Vec<AccountMeta>> = Box::new(
        ctx.remaining_accounts
            .iter()
            .map(|acc| AccountMeta {
                pubkey: *acc.key,
                is_signer: acc.key == &ctx.accounts.vault.key(),
                is_writable: acc.is_writable,
            })
            .collect()
    );
    
    anchor_lang::solana_program::program::invoke_signed(
        &anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: accounts.to_vec(),
            data: swap_data.to_vec(),
        },
        ctx.remaining_accounts,
        &[&[VAULT_SEED, &[ctx.bumps.vault]]],
    )?;
    
    ctx.accounts.vault_output_token_account.reload()?;
    let usdc_received = ctx.accounts.vault_output_token_account.amount
        .checked_sub(out_token_balance_before)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
        
    process_sp_tokens(ctx, usdc_received)?;
    
    Ok(())
}

fn process_sp_tokens(ctx: &mut Context<DepositEcosystem>, usdc_amount: u64) -> Result<()> {
    let sp_amount = usdc_amount
        .checked_mul(SP_PER_USDC)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
        
    let sp_bump = ctx.bumps.sp_mint_authority;
    let sp_signer_seeds = [
        b"sp_mint_authority".as_ref(),
        &[sp_bump][..],
    ];
    let sp_signers = [&sp_signer_seeds[..]];
    
    anchor_spl::token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.sp_token_program.to_account_info(),
            anchor_spl::token_2022::MintTo {
                mint: ctx.accounts.sp_token_mint.to_account_info(),
                to: ctx.accounts.sp_vault.to_account_info(),
                authority: ctx.accounts.sp_mint_authority.to_account_info(),
            },
            &sp_signers,
        ),
        sp_amount,
    )?;
    
    ctx.accounts.ecosystem_config.collected_fees_sp = ctx.accounts.ecosystem_config.collected_fees_sp
        .checked_add(sp_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    
    Ok(())
}

fn process_remaining_amount(ctx: &mut Context<DepositEcosystem>, amount: u64, fee_amount: u64) -> Result<()> {
    let remaining_amount = amount.checked_sub(fee_amount).ok_or(ErrorCode::ArithmeticOverflow)?;
    
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.collateral_token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.user_collateral_account.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
                mint: ctx.accounts.collateral_token_mint.to_account_info(),
            },
        ),
        remaining_amount,
        ctx.accounts.collateral_token_mint.decimals,
    )?;
    
    let mint_key = ctx.accounts.mint.key();
    let mint_authority_seeds = [
        b"mint_authority".as_ref(),
        mint_key.as_ref(),
        &[ctx.bumps.mint_authority][..],
    ];
    let mint_authority_signers = [&mint_authority_seeds[..]];
    
    anchor_spl::token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_2022::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.to_ata.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &mint_authority_signers,
        ),
        remaining_amount,
    )?;
    
    Ok(())
}

fn process_swap_transfer(ctx: &Context<Swap>, amount: u64) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let mint_key_ref = mint_key.as_ref();
    let fee_vault_authority_seeds = &[
        b"fee_vault_authority".as_ref(),
        mint_key_ref,
        &[ctx.bumps.fee_vault_authority],
    ];
    let fee_vault_authority_signer_seeds = &[&fee_vault_authority_seeds[..]];
    
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.collateral_token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx.accounts.vault_input_token_account.to_account_info(),
                authority: ctx.accounts.fee_vault_authority.to_account_info(),
                mint: ctx.accounts.input_mint.to_account_info(),
            },
            fee_vault_authority_signer_seeds,
        ),
        amount,
        ctx.accounts.input_mint.decimals,
    )?;
    
    Ok(())
}

fn execute_jupiter_swap(ctx: &mut Context<Swap>, data: &[u8]) -> Result<u64> {
    let out_token_balance_before = ctx.accounts.vault_output_token_account.amount;
    
    let accounts: Box<Vec<AccountMeta>> = Box::new(
        ctx.remaining_accounts
            .iter()
            .map(|acc| AccountMeta {
                pubkey: *acc.key,
                is_signer: acc.key == &ctx.accounts.vault.key(),
                is_writable: acc.is_writable,
            })
            .collect()
    );
    
    anchor_lang::solana_program::program::invoke_signed(
        &anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: accounts.to_vec(),
            data: data.to_vec(),
        },
        ctx.remaining_accounts,
        &[&[VAULT_SEED, &[ctx.bumps.vault]]],
    )?;
    
    ctx.accounts.vault_output_token_account.reload()?;
    let usdc_received = ctx.accounts.vault_output_token_account.amount
        .checked_sub(out_token_balance_before)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
        
    Ok(usdc_received)
}

fn process_swap_fees(ctx: &mut Context<Swap>, usdc_received: u64) -> Result<()> {
    let withdrawal_fee_basis_points = ctx.accounts.ecosystem_config.withdrawal_fee_basis_points;
    let fee_amount = calculate_fee(usdc_received, withdrawal_fee_basis_points)?;
    let fee_amount = if withdrawal_fee_basis_points > 0 && fee_amount == 0 { 1 } else { fee_amount };
    let amount_to_transfer = usdc_received.checked_sub(fee_amount).ok_or(ErrorCode::ArithmeticOverflow)?;
    
    let sp_amount = fee_amount
        .checked_mul(SP_PER_USDC)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    
    let sp_bump = ctx.bumps.sp_mint_authority;
    let sp_signer_seeds = [
        b"sp_mint_authority".as_ref(),
        &[sp_bump][..],
    ];
    let sp_signers = [&sp_signer_seeds[..]];
    
    anchor_spl::token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.sp_token_program.to_account_info(),
            anchor_spl::token_2022::MintTo {
                mint: ctx.accounts.sp_token_mint.to_account_info(),
                to: ctx.accounts.sp_vault.to_account_info(),
                authority: ctx.accounts.sp_mint_authority.to_account_info(),
            },
            &sp_signers,
        ),
        sp_amount,
    )?;
    
    ctx.accounts.ecosystem_config.collected_fees_sp = ctx.accounts.ecosystem_config.collected_fees_sp
        .checked_add(sp_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.output_mint_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.vault_output_token_account.to_account_info(),
                to: ctx.accounts.merchant_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.output_mint.to_account_info(),
            },
            &[&[VAULT_SEED, &[ctx.bumps.vault]]],
        ),
        amount_to_transfer,
        ctx.accounts.output_mint.decimals,
    )?;
    
    Ok(())
}

#[program]
pub mod token_deployer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.config.owner = ctx.accounts.payer.key();
        ctx.accounts.config.global_freeze = false;
        
        emit!(ProgramInitialized {
            owner: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn create_ecosystem(ctx: Context<CreateEcosystem>, args: TokenMetadataArgs) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
    
        let TokenMetadataArgs {
            decimals: _decimals,
            name: _,
            symbol: _,
            uri: _,
            transfer_hook_program_id: _transfer_hook_program_id,
            ecosystem_partner_wallet,
            max_minting_cap,
            withdrawal_fee_basis_points,
            deposit_fee_basis_points,
            collateral_token_mint: _,
        } = args;
        
        require!(
            deposit_fee_basis_points <= 10000 && withdrawal_fee_basis_points <= 10000,
            ErrorCode::InvalidFeePercentage
        );
        
        let cpi_accounts = anchor_spl::token_2022::MintTo {
            mint: ctx.accounts.mint_account.to_account_info(),
            to: ctx.accounts.mint_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        anchor_spl::token_2022::mint_to(CpiContext::new(cpi_program, cpi_accounts), 0)?; // Initialize mint
        
        let ecosystem_config = &mut ctx.accounts.ecosystem_config;
        ecosystem_config.ecosystem_partner_wallet = ecosystem_partner_wallet;
        ecosystem_config.max_minting_cap = max_minting_cap;
        ecosystem_config.withdrawal_fee_basis_points = withdrawal_fee_basis_points;
        ecosystem_config.deposit_fee_basis_points = deposit_fee_basis_points;
        ecosystem_config.collateral_token_mint = ctx.accounts.collateral_token_mint.key();
        ecosystem_config.ecosystem_freeze = false;
        ecosystem_config.collected_fees = 0;
        ecosystem_config.collected_fees_sp = 0;
        
        ecosystem_config.collateral_token_program = ctx.accounts.collateral_token_program.key();

        emit!(EcosystemCreated {
            mint: ctx.accounts.mint_account.key(),
            ecosystem_partner: ecosystem_partner_wallet,
            collateral_mint: ctx.accounts.collateral_token_mint.key(),
            max_minting_cap,
            deposit_fee_bps: deposit_fee_basis_points,
            withdrawal_fee_bps: withdrawal_fee_basis_points,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn deposit_ecosystem<'info>(ctx: Context<DepositEcosystem>, amount: u64, swap_data: Vec<u8>) -> Result<()> {
        let mut ctx = Box::new(ctx); // Box the Context to reduce stack usage
        validate_deposit(&ctx, amount)?;
        
        let deposit_fee_basis_points = ctx.accounts.ecosystem_config.deposit_fee_basis_points;
        let fee_amount = calculate_fee(amount, deposit_fee_basis_points)?;
        
        if fee_amount > 0 {
            process_fee(&mut ctx, fee_amount, &swap_data)?;
        }
        
        process_remaining_amount(&mut ctx, amount, fee_amount)?;
        
        emit!(EcosystemDeposited {
            ecosystem_mint: ctx.accounts.mint.key(),
            depositor: ctx.accounts.payer.key(),
            amount,
            fee: fee_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        let collected_fees_sp = ctx.accounts.ecosystem_config.collected_fees_sp;
        require!(collected_fees_sp > 0, ErrorCode::NoFeesToCollect);
        
        let mint_key = ctx.accounts.mint.key();
        let fee_vault_authority_seeds = &[
            b"fee_vault_authority".as_ref(),
            mint_key.as_ref(),
            &[ctx.bumps.fee_vault_authority]
        ];
        let fee_vault_authority_signer_seeds = &[&fee_vault_authority_seeds[..]];
        
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.sp_token_program.to_account_info(),
                anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.sp_vault.to_account_info(),
                    to: ctx.accounts.sp_destination_account.to_account_info(),
                    authority: ctx.accounts.fee_vault_authority.to_account_info(),
                    mint: ctx.accounts.sp_token_mint.to_account_info(),
                },
                fee_vault_authority_signer_seeds,
            ),
            collected_fees_sp,
            ctx.accounts.sp_token_mint.decimals,
        )?;
        
        ctx.accounts.ecosystem_config.collected_fees_sp = 0;
        
        emit!(FeesCollected {
            ecosystem_mint: ctx.accounts.mint.key(),
            collector: ctx.accounts.payer.key(),
            amount_sp: collected_fees_sp,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
    
    pub fn toggle_global_freeze(ctx: Context<ToggleGlobalFreeze>) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
        
        ctx.accounts.config.global_freeze = !ctx.accounts.config.global_freeze;
        
        emit!(GlobalFreezeToggled {
            new_state: ctx.accounts.config.global_freeze,
            toggled_by: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
    
    pub fn toggle_ecosystem_freeze(ctx: Context<ToggleEcosystemFreeze>) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
        
        ctx.accounts.ecosystem_config.ecosystem_freeze = !ctx.accounts.ecosystem_config.ecosystem_freeze;
        
        emit!(EcosystemFreezeToggled {
            ecosystem_mint: ctx.accounts.mint.key(),
            new_state: ctx.accounts.ecosystem_config.ecosystem_freeze,
            toggled_by: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn update_max_cap(ctx: Context<UpdateMaxCap>, new_max_cap: u64) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
        
        let current_supply = ctx.accounts.mint.supply;
        
        require!(
            new_max_cap >= current_supply,
            ErrorCode::InvalidMaxCap
        );
        
        let old_cap = ctx.accounts.ecosystem_config.max_minting_cap;
        ctx.accounts.ecosystem_config.max_minting_cap = new_max_cap;
        
        msg!("Updated max minting cap to: {}", new_max_cap);
        
        emit!(MaxCapUpdated {
            ecosystem_mint: ctx.accounts.mint.key(),
            old_cap,
            new_cap: new_max_cap,
            updated_by: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, amount: u64, purchase_reference: String, data: Vec<u8>) -> Result<()> {
        let mut ctx = Box::new(ctx); // Box the Context to reduce stack usage
        validate_swap(&ctx, amount, &purchase_reference)?;

        let merchant_wallet = ctx.accounts.merchant_wallet.key();

        msg!("amount: {}", amount);
        msg!("merchant_wallet: {}", merchant_wallet);
        msg!("purchase_reference: {}", purchase_reference);
        
        process_swap_transfer(&ctx, amount)?;
        
        anchor_spl::token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_interface::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
        )?;
        
        let usdc_received = execute_jupiter_swap(&mut ctx, &data)?;
        
        process_swap_fees(&mut ctx, usdc_received)?;
        
        ctx.accounts.merchant_balance.balance = ctx.accounts.merchant_balance.balance
            .checked_add(usdc_received)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        emit!(PurchaseProcessed {
            ecosystem_mint: ctx.accounts.mint.key(),
            user: ctx.accounts.payer.key(),
            merchant: merchant_wallet,
            amount: usdc_received,
            purchase_reference,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1, 
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: TokenMetadataArgs)]
pub struct CreateEcosystem<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        init,
        payer = payer,
        mint::decimals = args.decimals,
        mint::authority = payer,
        extensions::metadata_pointer::authority = payer,
        extensions::metadata_pointer::metadata_address = mint_account,
        extensions::transfer_hook::authority = payer,
        extensions::transfer_hook::program_id = args.transfer_hook_program_id,
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,
    
    /// CHECK: This is a PDA used as the mint authority, verified by seeds
    #[account(
        seeds = [b"mint_authority", mint_account.key().as_ref()],
        bump,
    )]
    pub mint_authority: AccountInfo<'info>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8 + 2 + 2 + 32 + 1 + 8 + 32 + 8,
        seeds = [b"ecosystem_config", mint_account.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    /// CHECK: This is a PDA that owns the fee vault
    #[account(
        seeds = [b"fee_vault_authority", mint_account.key().as_ref()],
        bump,
    )]
    pub fee_vault_authority: AccountInfo<'info>,
    
    pub collateral_token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        init,
        payer = payer,
        seeds = [b"fee_vault", mint_account.key().as_ref()],
        bump,
        token::mint = collateral_token_mint,
        token::authority = fee_vault_authority,
        token::token_program = collateral_token_program,
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init,
        payer = payer,
        seeds = [b"collateral_vault", mint_account.key().as_ref()],
        bump,
        token::mint = collateral_token_mint,
        token::authority = fee_vault_authority,
        token::token_program = collateral_token_program,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token2022>,
    
    /// CHECK: This is the token program for the collateral mint, verified by constraint to match Token or Token2022
    #[account(
        constraint = 
            collateral_token_program.key() == token_program_id() || 
            collateral_token_program.key() == token2022_program_id()
            @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,
    
    pub sp_token_mint: InterfaceAccount<'info, Mint>,
    
    /// CHECK: This is a PDA for SP mint authority, verified by seeds
    #[account(
        seeds = [b"sp_mint_authority"],
        bump,
    )]
    pub sp_mint_authority: AccountInfo<'info>,
    
    #[account(
        init,
        payer = payer,
        seeds = [b"sp_vault", mint_account.key().as_ref()],
        bump,
        token::mint = sp_token_mint,
        token::authority = fee_vault_authority,
        token::token_program = sp_token_program,
    )]
    pub sp_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub sp_token_program: Program<'info, Token2022>,
    
    pub system_program: Program<'info, System>,
    
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64, swap_data: Vec<u8>)]
pub struct DepositEcosystem<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    
    /// CHECK: This is a PDA used as the mint authority, verified by seeds
    #[account(
        seeds = [b"mint_authority", mint.key().as_ref()],
        bump,
    )]
    pub mint_authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub to_ata: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
        constraint = ecosystem_config.ecosystem_partner_wallet == payer.key() @ ErrorCode::Unauthorized
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    pub collateral_token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        mut,
        constraint = user_collateral_account.mint == collateral_token_mint.key() @ ErrorCode::InvalidCollateralToken,
        constraint = user_collateral_account.owner == payer.key() @ ErrorCode::Unauthorized
    )]
    pub user_collateral_account: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: This is a PDA that owns the fee vault
    #[account(
        seeds = [b"fee_vault_authority", mint.key().as_ref()],
        bump,
    )]
    pub fee_vault_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        seeds = [b"fee_vault", mint.key().as_ref()],
        bump,
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"collateral_vault", mint.key().as_ref()],
        bump,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token2022>,
    
    /// CHECK: This is the token program for the collateral mint, verified by constraint to match ecosystem_config.collateral_token_program
    #[account(
        constraint = collateral_token_program.key() == ecosystem_config.collateral_token_program
        @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,
    
    pub jupiter_program: Program<'info, Jupiter>,

    #[account(
        mut,
        seeds=[VAULT_SEED],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint=collateral_token_mint,
        associated_token::authority=vault,
        associated_token::token_program=collateral_token_program,
    )]
    pub vault_input_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint=usdc_mint,
        associated_token::authority=vault,
        associated_token::token_program=usdc_token_program,
    )]
    pub vault_output_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    
    pub usdc_token_program: Interface<'info, TokenInterface>,
    
    pub sp_token_mint: InterfaceAccount<'info, Mint>,
    
    pub sp_token_program: Program<'info, Token2022>,
    
    /// CHECK: This is a PDA for SP mint authority, verified by seeds
    #[account(
        seeds = [b"sp_mint_authority"],
        bump,
    )]
    pub sp_mint_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        seeds = [b"sp_vault", mint.key().as_ref()],
        bump,
        token::mint = sp_token_mint,
        token::authority = fee_vault_authority,
        token::token_program = sp_token_program,
    )]
    pub sp_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.owner == payer.key() @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        mut,
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    pub collateral_token_mint: InterfaceAccount<'info, Mint>,
    
    /// CHECK: This is a PDA that owns the fee vault
    #[account(
        seeds = [b"fee_vault_authority", mint.key().as_ref()],
        bump,
    )]
    pub fee_vault_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        seeds = [b"fee_vault", mint.key().as_ref()],
        bump,
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = destination_account.mint == collateral_token_mint.key() @ ErrorCode::InvalidCollateralToken,
        constraint = destination_account.owner == payer.key() @ ErrorCode::Unauthorized
    )]
    pub destination_account: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: This is the token program for the collateral mint, verified by constraint to match ecosystem_config.collateral_token_program
    #[account(
        constraint = collateral_token_program.key() == ecosystem_config.collateral_token_program
        @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,
    
    pub sp_token_mint: InterfaceAccount<'info, Mint>,
    
    pub sp_token_program: Program<'info, Token2022>,
    
    #[account(
        mut,
        seeds = [b"sp_vault", mint.key().as_ref()],
        bump,
    )]
    pub sp_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = sp_destination_account.mint == sp_token_mint.key() @ ErrorCode::InvalidToken,
        constraint = sp_destination_account.owner == payer.key() @ ErrorCode::Unauthorized
    )]
    pub sp_destination_account: InterfaceAccount<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct ToggleGlobalFreeze<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ToggleEcosystemFreeze<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    pub mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct UpdateMaxCap<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        mut,
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub input_mint: InterfaceAccount<'info, Mint>,
    pub input_mint_program: Interface<'info, TokenInterface>,
    pub output_mint: InterfaceAccount<'info, Mint>,
    pub output_mint_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        seeds=[VAULT_SEED],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint=input_mint,
        associated_token::authority=vault,
        associated_token::token_program=input_mint_program,
    )]
    pub vault_input_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint=output_mint,
        associated_token::authority=vault,
        associated_token::token_program=output_mint_program,
    )]
    pub vault_output_token_account: InterfaceAccount<'info, TokenAccount>,

    pub jupiter_program: Program<'info, Jupiter>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == mint.key() @ ErrorCode::InvalidToken,
        constraint = user_token_account.owner == payer.key() @ ErrorCode::Unauthorized
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token2022>,
    
    /// CHECK: This is a PDA that owns the fee vault
    #[account(
        seeds = [b"fee_vault_authority", mint.key().as_ref()],
        bump,
    )]
    pub fee_vault_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        seeds = [b"collateral_vault", mint.key().as_ref()],
        bump,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: This is the token program for the collateral mint, verified by constraint to match ecosystem_config.collateral_token_program
    #[account(
        constraint = collateral_token_program.key() == ecosystem_config.collateral_token_program
        @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 8 + 32,
        seeds = [b"merchant_balance", merchant_wallet.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub merchant_balance: Account<'info, MerchantBalance>,
    
    #[account(mut)]
    pub merchant_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: This is the merchant's wallet address
    pub merchant_wallet: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    pub sp_token_mint: InterfaceAccount<'info, Mint>,
    pub sp_token_program: Program<'info, Token2022>,
    
    /// CHECK: This is a PDA for SP mint authority, verified by seeds
    #[account(
        seeds = [b"sp_mint_authority"],
        bump,
    )]
    pub sp_mint_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        seeds = [b"sp_vault", mint.key().as_ref()],
        bump,
    )]
    pub sp_vault: InterfaceAccount<'info, TokenAccount>,
}

#[event]
pub struct ProgramInitialized {
    pub owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EcosystemCreated {
    pub mint: Pubkey,
    pub ecosystem_partner: Pubkey,
    pub collateral_mint: Pubkey,
    pub max_minting_cap: u64,
    pub deposit_fee_bps: u16,
    pub withdrawal_fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct EcosystemDeposited {
    pub ecosystem_mint: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeesCollected {
    pub ecosystem_mint: Pubkey,
    pub collector: Pubkey,
    pub amount_sp: u64,
    pub timestamp: i64,
}

#[event]
pub struct GlobalFreezeToggled {
    pub new_state: bool,
    pub toggled_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EcosystemFreezeToggled {
    pub ecosystem_mint: Pubkey,
    pub new_state: bool,
    pub toggled_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MaxCapUpdated {
    pub ecosystem_mint: Pubkey,
    pub old_cap: u64,
    pub new_cap: u64,
    pub updated_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PurchaseProcessed {
    pub ecosystem_mint: Pubkey,
    pub user: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub purchase_reference: String,
    pub timestamp: i64,
}

#[account]
pub struct Config {
    pub owner: Pubkey,
    pub global_freeze: bool,
}

#[account]
pub struct EcosystemConfig {
    pub ecosystem_partner_wallet: Pubkey,
    pub max_minting_cap: u64,
    pub withdrawal_fee_basis_points: u16,
    pub deposit_fee_basis_points: u16,  
    pub collateral_token_mint: Pubkey,
    pub ecosystem_freeze: bool,
    pub collected_fees: u64,
    pub collateral_token_program: Pubkey,
    pub collected_fees_sp: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TokenMetadataArgs {
    pub decimals: u8,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub transfer_hook_program_id: Pubkey,
    pub ecosystem_partner_wallet: Pubkey,
    pub max_minting_cap: u64,
    pub withdrawal_fee_basis_points: u16,
    pub deposit_fee_basis_points: u16,
    pub collateral_token_mint: Pubkey,
}

#[account]
pub struct MerchantBalance {
    pub merchant: Pubkey,
    pub balance: u64,
    pub ecosystem_mint: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Exceeds maximum minting cap")]
    ExceedsMaximumCap,
    #[msg("Invalid collateral token")]
    InvalidCollateralToken,
    #[msg("Invalid token for this operation")]
    InvalidToken,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Invalid fee percentage - has to be <= 10000 (100%)")]
    InvalidFeePercentage,
    #[msg("Operation not allowed: freeze state is active")]
    FreezeStateActive,
    #[msg("No fees available to collect")]
    NoFeesToCollect,
    #[msg("Invalid max cap: new cap must be >= current supply")]
    InvalidMaxCap,
    #[msg("Invalid program ID")]
    InvalidProgramId,
    #[msg("Invalid purchase reference string")]
    InvalidPurchaseReference,
    #[msg("Output mint must be USDC")]
    InvalidOutputMint,
    #[msg("Invalid amount: can not zero")]
    InvalidAmount,
}