
use anchor_lang::prelude::*;
use anchor_lang::prelude::Pubkey;
use anchor_lang::pubkey;
use anchor_lang::solana_program::{instruction::Instruction, program::{invoke_signed, invoke}};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::{
    set_authority, mint_to, Token2022,
    SetAuthority, MintTo,
};
use anchor_spl::{token_interface::{
    transfer_checked, TransferChecked,
    Mint, TokenAccount, burn, Burn, TokenInterface
},
    /*token::{
        Mint,
        Token,
        TokenAccount
    }*/};

use std::str::FromStr;

use jupiter_aggregator::program::Jupiter;
use spree_points::{
    accounts::*,
    cpi::{
        self,
        accounts::*,
    },
    constants::*,
    program::SpreePoints
};


declare_program!(spree_points);
declare_program!(jupiter_aggregator);

declare_id!("CEzsTf7eM9ac1kGx7DuZHdXv8b4mLPQBbRzrQcMJmJBh");


pub fn sp_program_id() -> Pubkey {
    spree_points::ID
}

const VAULT_SEED: &[u8] = b"vault";
pub static USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const JUP_PROGRAM_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
//const SP_PROGRAM_ID: &str = "3pVZ5as41wf864VxTiWXrMAuZYKsB7p4jGKgQ7e6WMwp";
const USDC_MINT_STR: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022_PROGRAM: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

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

#[program]
pub mod token_deployer {
    use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.config.owner = ctx.accounts.payer.key();
        ctx.accounts.config.global_freeze = false;
        ctx.accounts.config.approvers = Vec::new();
        
        emit!(ProgramInitialized {
            owner: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn add_approver(ctx: Context<ManageApprover>, approver: Pubkey) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
        
        require!(!ctx.accounts.config.approvers.contains(&approver), ErrorCode::ApproverAlreadyExists);
        
        ctx.accounts.config.approvers.push(approver);
        
        emit!(ApproverAdded {
            approver,
            added_by: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn remove_approver(ctx: Context<ManageApprover>, approver: Pubkey) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
        
        let position = ctx.accounts.config.approvers.iter().position(|&x| x == approver);
        require!(position.is_some(), ErrorCode::ApproverNotFound);
        
        ctx.accounts.config.approvers.remove(position.unwrap());
        
        emit!(ApproverRemoved {
            approver,
            removed_by: ctx.accounts.payer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn get_approvers(ctx: Context<GetApprovers>) -> Result<Vec<Pubkey>> {
        Ok(ctx.accounts.config.approvers.clone())
    }

    pub fn create_ecosystem(ctx: Context<CreateEcosystem>, args: TokenMetadataArgs) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
    
        let TokenMetadataArgs {
            decimals: _,
            name: _,
            symbol: _,
            uri: _,
            transfer_hook_program_id: _,
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
        
        set_authority(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint_account.to_account_info(),
                    current_authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            AuthorityType::MintTokens,
            Some(ctx.accounts.mint_authority.key()),
        )?;
    
        let ecosystem_config = &mut ctx.accounts.ecosystem_config;
        ecosystem_config.ecosystem_partner_wallet = ecosystem_partner_wallet;
        ecosystem_config.max_minting_cap = max_minting_cap;
        ecosystem_config.withdrawal_fee_basis_points = withdrawal_fee_basis_points;
        ecosystem_config.deposit_fee_basis_points = deposit_fee_basis_points;
        ecosystem_config.collateral_token_mint = ctx.accounts.collateral_token_mint.key();
        ecosystem_config.ecosystem_freeze = false;
        ecosystem_config.collected_fees = 0;
        
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

    pub fn deposit_ecosystem(ctx: Context<DepositEcosystem>, amount: u64, swap_data: Vec<u8>) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        require!(
            !ctx.accounts.config.global_freeze && !ctx.accounts.ecosystem_config.ecosystem_freeze,
            ErrorCode::FreezeStateActive
        );

        require_keys_eq!(*ctx.accounts.jupiter_program.key, jupiter_program_id());
        require_keys_eq!(*ctx.accounts.sp_program.key, sp_program_id());

        require!(
            ctx.accounts.to_ata.owner == ctx.accounts.payer.key(),
            ErrorCode::Unauthorized
        );
        require!(
            ctx.accounts.to_ata.mint == ctx.accounts.mint_account.key(),
            ErrorCode::InvalidToken
        );
        
        let current_supply = ctx.accounts.mint_account.supply;
        let max_minting_cap = ctx.accounts.ecosystem_config.max_minting_cap;
        let deposit_fee_basis_points = ctx.accounts.ecosystem_config.deposit_fee_basis_points;
        
        require!(
            current_supply.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)? <= max_minting_cap,
            ErrorCode::ExceedsMaximumCap
        );
        
        let fee_amount = amount
            .checked_mul(deposit_fee_basis_points as u64)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        let remaining_amount = amount.checked_sub(fee_amount).ok_or(ErrorCode::ArithmeticOverflow)?;
        
        if remaining_amount > 0 {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.collateral_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_collateral_account.to_account_info(),
                        to: ctx.accounts.collateral_vault.to_account_info(),
                        authority: ctx.accounts.payer.to_account_info(),
                        mint: ctx.accounts.collateral_token_mint.to_account_info(),
                    },
                ),
                remaining_amount,
                ctx.accounts.collateral_token_mint.decimals,
            )?;
        }
        
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint_account.to_account_info(),
            to: ctx.accounts.to_ata.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        
        let mint_key = ctx.accounts.mint_account.key();
        let bump = ctx.bumps.mint_authority;
        
        let signer_seeds = [
            b"mint_authority".as_ref(), 
            mint_key.as_ref(),
            &[bump][..],
        ];
        
        let signers = [&signer_seeds[..]];
        
        let cpi_context = CpiContext::new_with_signer(
            cpi_program, 
            cpi_accounts,
            &signers,
        );
//Bug fix: collateralisation 1:1
        mint_to(cpi_context, remaining_amount)?;

         // PUT SWAP FUNCTIONALITY HERE
        ///@dev: 
        /// The fee amount to be swapped will be the exact amount we will get Jupiter Quote for
        /// Will be Done Client-side, during off-chain quote fetching
        let usdc_fee_account_balance_before = ctx.accounts.usdc_receive_swap_ata.amount;
        let jupiter_accounts: Vec<AccountMeta> = ctx.remaining_accounts
            .iter()
            .map(|acc|{
                let is_signer = acc.key == &ctx.accounts.payer.key();
                AccountMeta {
                    pubkey: *acc.key,
                    is_signer,
                    is_writable: acc.is_writable
                }
            }).collect();

        let account_infos: Vec<AccountInfo> = ctx.remaining_accounts
            .iter()
            .map(|acc| {
                AccountInfo {..acc.clone()}
            })
            .collect();
        
        let jupiter_instruction_data = Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: jupiter_accounts,
            data: swap_data
        };
        // Actual cpi call via invoke, not invoke_signed because user is signing
        invoke(
            &jupiter_instruction_data,
            &account_infos
        )?;

        let fee_in_usdc_after_swap = ctx.accounts.usdc_receive_swap_ata.amount
            .checked_sub(usdc_fee_account_balance_before).unwrap();

        // @dev: Now USDC fee is in usdc_receive_swap_ata
        // CPI into the SP mint_tokens instruction
        let sp_mint = &ctx.accounts.sp_mint;
        let sp_mint_accounts = MintTokens{
            signer: ctx.accounts.sp_mint_authority.to_account_info(),
            usdc_mint: todo!(),
            usdc_keeper: todo!(),
            mint: sp_mint.to_account_info(),
            to_ata: ctx.accounts.fee_vault.to_account_info(),
            usdc_from_ata: ctx.accounts.usdc_receive_swap_ata.to_account_info(),
            fees: todo!(),
            fee_collector: todo!(),
            freeze_state: todo!(),
            white_list_status: todo!(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program_interface.to_account_info(),
            token_program2022: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info()
        };
        // Get Mint CPI context
        // SP Minting Authority
        let sp_mint_authority_seeds = &[
            b"sp_mint_authority", sp_mint.key().as_ref(),
            &[ctx.bumps.collateral_vault]
        ];
        let sp_mint_signing_seeds = &[&sp_mint_authority_seeds[..]];
        let mint_cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.sp_program.to_account_info(),// SP TOKEN program
            sp_mint_accounts,
            sp_mint_signing_seeds
        );
        // Call mint_tokens instruction on the SP Token Program
        cpi::mint_tokens(mint_cpi_ctx, fee_in_usdc_after_swap)?;
            
        
        ctx.accounts.ecosystem_config.collected_fees = ctx.accounts.ecosystem_config.collected_fees
            .checked_add(fee_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
                
        msg!("Updated collected fees to: {}", ctx.accounts.ecosystem_config.collected_fees);

        emit!(EcosystemDeposited {
        ecosystem_mint: ctx.accounts.mint_account.key(),
        depositor: ctx.accounts.payer.key(),
        amount,
        fee: fee_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
        
    Ok(())
    }

    
    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        require!(ctx.accounts.payer.key() == ctx.accounts.config.owner, ErrorCode::Unauthorized);
        
        let collected_fees = ctx.accounts.ecosystem_config.collected_fees;
        
        require!(collected_fees > 0, ErrorCode::NoFeesToCollect);
        
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.collateral_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.fee_vault.to_account_info(),
                    to: ctx.accounts.destination_account.to_account_info(),
                    authority: ctx.accounts.fee_vault_authority.to_account_info(),
                    mint: ctx.accounts.collateral_token_mint.to_account_info(),
                },
                &[&[
                    b"fee_vault_authority".as_ref(),
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.bumps.fee_vault_authority],
                ]],
            ),
            collected_fees,
            ctx.accounts.collateral_token_mint.decimals,
        )?;
        
        emit!(FeesCollected {
            ecosystem_mint: ctx.accounts.mint.key(),
            collector: ctx.accounts.payer.key(),
            amount: collected_fees,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        ctx.accounts.ecosystem_config.collected_fees = 0;
        
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

    pub fn swap(ctx: Context<Swap>, amount: u64,
        purchase_reference: String, data: Vec<u8>) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

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

        let merchant_wallet = ctx.accounts.merchant_wallet.key();

        msg!("amount: {}", amount);
        msg!("merchant_wallet: {}", merchant_wallet);
        msg!("purchase_reference: {}", purchase_reference);
        
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.collateral_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.vault_input_token_account.to_account_info(),
                    authority: ctx.accounts.fee_vault_authority.to_account_info(),
                    mint: ctx.accounts.input_mint.to_account_info(),
                },
                &[&[
                    b"fee_vault_authority", 
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.bumps.fee_vault_authority],
                ]],
            ),
            amount,
            ctx.accounts.input_mint.decimals,
        )?;
        
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
        )?;
        
        let initial_usdc_balance = ctx.accounts.vault_output_token_account.amount;
        
        let accounts: Vec<AccountMeta> = ctx
            .remaining_accounts
            .iter()
            .map(|acc| {
                let is_signer = acc.key == &ctx.accounts.vault.key();
                AccountMeta {
                    pubkey: *acc.key,
                    is_signer,
                    is_writable: acc.is_writable,
                }
            })
            .collect();
    
        let accounts_infos: Vec<AccountInfo> = ctx
            .remaining_accounts
            .iter()
            .map(|acc| AccountInfo { ..acc.clone() })
            .collect();
    
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &[ctx.bumps.vault]]];
    
        invoke_signed(
            &Instruction {
                program_id: ctx.accounts.jupiter_program.key(),
                accounts,
                data,
            },
            &accounts_infos,
            signer_seeds,
        )?;

        ctx.accounts.vault_output_token_account.reload()?;
        
        let new_usdc_balance = ctx.accounts.vault_output_token_account.amount;
        
        let usdc_received = new_usdc_balance.checked_sub(initial_usdc_balance)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        msg!("USDC received from swap: {}", usdc_received);
        
        let merchant_balance = &mut ctx.accounts.merchant_balance;
        
        if merchant_balance.merchant == Pubkey::default() {
            merchant_balance.merchant = merchant_wallet;
            merchant_balance.ecosystem_mint = ctx.accounts.mint.key();
            merchant_balance.balance = 0;
        }
        
        merchant_balance.balance = merchant_balance.balance
            .checked_add(usdc_received)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        msg!("New merchant balance: {}", merchant_balance.balance);
        
        emit!(PurchaseProcessed {
            ecosystem_mint: ctx.accounts.mint.key(),
            user: ctx.accounts.payer.key(),
            merchant: merchant_wallet,
            amount,
            purchase_reference,
            timestamp: Clock::get()?.unix_timestamp,
        });
    
        Ok(())
    }

    pub fn create_withdrawal_request(ctx: Context<CreateWithdrawalRequest>) -> Result<()> {
        let merchant_balance = &ctx.accounts.merchant_balance;

        require!(
            merchant_balance.balance > 0, 
            ErrorCode::NoBalanceToWithdraw
        );

        let withdrawal_request = &mut ctx.accounts.withdrawal_request;
        
        if withdrawal_request.merchant != Pubkey::default() && !withdrawal_request.is_approved {
            return err!(ErrorCode::PendingWithdrawalExists);
        }
        
        withdrawal_request.merchant = ctx.accounts.payer.key();
        withdrawal_request.ecosystem_mint = ctx.accounts.ecosystem_config.key();
        withdrawal_request.amount = merchant_balance.balance;
        withdrawal_request.timestamp = Clock::get()?.unix_timestamp;
        withdrawal_request.is_approved = false;
        withdrawal_request.approved_by = None;
        
        emit!(WithdrawalRequestCreated {
            merchant: ctx.accounts.payer.key(),
            ecosystem_mint: ctx.accounts.ecosystem_config.key(),
            amount: merchant_balance.balance,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn approve_withdrawal_request(ctx: Context<ApproveWithdrawalRequest>) -> Result<()> {
        /* 
        require!(
            ctx.accounts.config.approvers.contains(&ctx.accounts.approver.key()),
            ErrorCode::NotAnApprover
        );*/

        let withdrawal_request = &mut ctx.accounts.withdrawal_request;
        
        require!(
            !withdrawal_request.is_approved,
            ErrorCode::WithdrawalAlreadyApproved
        );

        require_keys_eq!(
            ctx.accounts.output_mint.key(),
            usdc_mint_id(),
            ErrorCode::InvalidOutputMint
        );

        let merchant_balance = &mut ctx.accounts.merchant_balance;
        
        require!(
            merchant_balance.balance >= withdrawal_request.amount,
            ErrorCode::InsufficientBalance
        );
        
        let withdrawal_fee_basis_points = ctx.accounts.ecosystem_config.withdrawal_fee_basis_points;
        
        let fee_amount = withdrawal_request.amount
            .checked_mul(withdrawal_fee_basis_points as u64)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        let fee_amount = if withdrawal_fee_basis_points > 0 && fee_amount == 0 {
            1
        } else {
            fee_amount
        };
        
        msg!("Withdrawal fee: {}", fee_amount);
        
        let withdraw_amount = withdrawal_request.amount
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_mint_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault_output_token_account.to_account_info(),
                        to: ctx.accounts.fee_vault.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.output_mint.to_account_info(),
                    },
                    &[&[VAULT_SEED, &[ctx.bumps.vault]]],
                ),
                fee_amount,
                ctx.accounts.output_mint.decimals,
            )?;
            
            ctx.accounts.ecosystem_config.collected_fees = ctx.accounts.ecosystem_config.collected_fees
                .checked_add(fee_amount)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.output_mint_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_output_token_account.to_account_info(),
                    to: ctx.accounts.merchant_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.output_mint.to_account_info(),
                },
                &[&[VAULT_SEED, &[ctx.bumps.vault]]],
            ),
            withdraw_amount,
            ctx.accounts.output_mint.decimals,
        )?;
        
        merchant_balance.balance = merchant_balance.balance
            .checked_sub(withdrawal_request.amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        withdrawal_request.is_approved = true;
        withdrawal_request.approved_by = Some(ctx.accounts.approver.key());
        
        emit!(WithdrawalRequestApproved {
            merchant: withdrawal_request.merchant,
            ecosystem_mint: withdrawal_request.ecosystem_mint,
            approved_by: ctx.accounts.approver.key(),
            amount: withdraw_amount,
            fee: fee_amount,
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
        space = 8 + 32 + 1 + 4 + (32 * 10), 
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageApprover<'info> {
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
pub struct GetApprovers<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
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
    
    /// CHECK: This is a PDA used as the mint authority
    #[account(
        seeds = [b"mint_authority", mint_account.key().as_ref()],
        bump,
    )]
    pub mint_authority: AccountInfo<'info>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8 + 2 + 2 + 32 + 8 + 1 + 32,
        seeds = [b"ecosystem_config", mint_account.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,

    #[account()]
    pub sp_mint: InterfaceAccount<'info, Mint>,
    
    /// CHECK: PDA for fee vault authority
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
        token::mint = sp_mint,// Changing mint to SP Tokens instead
        token::authority = fee_vault_authority,
        token::token_program = token_program,// Changing from collateral token program to token program
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
    
    /// CHECK: This can be either legacy token or Token2022 program
    #[account(
        constraint = 
            collateral_token_program.key() == token_program_id() || 
            collateral_token_program.key() == token2022_program_id()
            @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositEcosystem<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]// Token For Collateralization
    pub mint_account: InterfaceAccount<'info, Mint>,
    
    /// CHECK: This is a PDA used as the mint authority
    #[account(
        seeds = [b"mint_authority", mint_account.key().as_ref()],
        bump,
    )]
    pub mint_authority: AccountInfo<'info>,
    
    #[account(mut)]// To Receive Ecosystem Mint
    pub to_ata: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"ecosystem_config", mint_account.key().as_ref()],
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
    
    #[account(
        mut,
        seeds = [b"fee_vault", mint_account.key().as_ref()],
        bump,
    )]// Created with SP as the mint in CreateEcosystem
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
 
    #[account()]
    pub sp_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Approved SP Mint Authority account.
    #[account(
        mut,
        seeds = [b"sp_mint_authority", sp_mint.key().as_ref()],
        bump,
    )]
    pub sp_mint_authority: AccountInfo<'info>,

    // Will receive the fees in usdc from the Jupiter Swap
    #[account(
        mut,
        associated_token::mint = usdc_mint_id(),
        associated_token::authority = mint_authority
    )]
    pub usdc_receive_swap_ata: InterfaceAccount<'info, TokenAccount>,
 /* 
    #[account(
        address = USDC_MINT,
    )]
    pub usdc_mint: Account<'info, Mint>,*/
    
    #[account(
        mut,
        seeds = [b"collateral_vault", mint_account.key().as_ref()],
        bump,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token2022>,

    pub token_program_interface: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
    
    /// CHECK: Will use the token program saved in ecosystem_config
    #[account(
        constraint = collateral_token_program.key() == ecosystem_config.collateral_token_program
        @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,

    pub jupiter_program: Program<'info, Jupiter>,

    pub sp_program: Program<'info, SpreePoints>,
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
    
    /// CHECK: Will use the token program saved in ecosystem_config
    #[account(
        constraint = collateral_token_program.key() == ecosystem_config.collateral_token_program
        @ ErrorCode::InvalidProgramId
    )]
    pub collateral_token_program: AccountInfo<'info>,
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
    
    /// CHECK: This is a PDA that owns the collateral vault
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
    
    /// CHECK: Will use the token program saved in ecosystem_config
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
    
    /// CHECK: This is just the public key of the merchant
    pub merchant_wallet: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateWithdrawalRequest<'info> {
    #[account(
        mut,
        constraint = payer.key() == merchant_balance.merchant @ ErrorCode::Unauthorized
    )]
    pub payer: Signer<'info>,
    
    #[account(
        seeds = [b"merchant_balance", payer.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub merchant_balance: Account<'info, MerchantBalance>,
    
    #[account(
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 32 + 8 + 8 + 1 + 33,
        seeds = [b"withdrawal_request", payer.key().as_ref(), ecosystem_config.key().as_ref()],
        bump,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveWithdrawalRequest<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub approver: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"withdrawal_request", withdrawal_request.merchant.as_ref(), ecosystem_config.key().as_ref()],
        bump,
        close = approver,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,
    
    #[account(
        mut,
        seeds = [b"merchant_balance", withdrawal_request.merchant.as_ref(), mint.key().as_ref()], 
        bump,
    )]
    pub merchant_balance: Account<'info, MerchantBalance>,
    
    #[account(
        mut,
        seeds = [b"ecosystem_config", mint.key().as_ref()],
        bump,
    )]
    pub ecosystem_config: Account<'info, EcosystemConfig>,
    
    pub mint: InterfaceAccount<'info, Mint>,
    
    pub output_mint: InterfaceAccount<'info, Mint>,
    pub output_mint_program: Interface<'info, TokenInterface>,
    
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    #[account(
        mut,
        associated_token::mint = output_mint,
        associated_token::authority = vault,
        associated_token::token_program = output_mint_program,
    )]
    pub vault_output_token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = merchant_token_account.mint == output_mint.key() @ ErrorCode::InvalidToken,
        constraint = merchant_token_account.owner == withdrawal_request.merchant @ ErrorCode::Unauthorized
    )]
    pub merchant_token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"fee_vault", mint.key().as_ref()],
        bump,
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
}

#[event]
pub struct ProgramInitialized {
    pub owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ApproverAdded {
    pub approver: Pubkey,
    pub added_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ApproverRemoved {
    pub approver: Pubkey,
    pub removed_by: Pubkey,
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
    pub amount: u64,
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
pub struct WithdrawalRequestCreated {
    pub merchant: Pubkey,
    pub ecosystem_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalRequestApproved {
    pub merchant: Pubkey,
    pub ecosystem_mint: Pubkey,
    pub approved_by: Pubkey,
    pub amount: u64,
    pub fee: u64,
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
    pub approvers: Vec<Pubkey>,
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
pub struct WithdrawalRequest {
    pub merchant: Pubkey,
    pub ecosystem_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub is_approved: bool,
    pub approved_by: Option<Pubkey>,
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
    #[msg("No balance to withdraw")]
    NoBalanceToWithdraw,
    #[msg("Invalid amount: can not zero")]
    InvalidAmount,
    #[msg("Approver already exists")]
    ApproverAlreadyExists,
    #[msg("Approver not found")]
    ApproverNotFound,
    #[msg("Not an authorized approver")]
    NotAnApprover,
    #[msg("Withdrawal request already approved")]
    WithdrawalAlreadyApproved,
    #[msg("Insufficient balance for withdrawal")]
    InsufficientBalance,
    #[msg("Pending withdrawal request already exists")]
    PendingWithdrawalExists,
}