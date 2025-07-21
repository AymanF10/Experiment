use anchor_lang::solana_program::{instruction::*, pubkey::Pubkey};
use anchor_spl::token_2022::ID as TOKEN2022_ID;
use anyhow::Result;
use jup_swap::{quote::QuoteRequest, swap::SwapRequest, transaction_config::*, JupiterSwapApiClient};
use lazy_static::lazy_static;
use sha2::{Digest, Sha256};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    address_lookup_table::{state::AddressLookupTable, AddressLookupTableAccount},
    commitment_config::CommitmentConfig,
    compute_budget::ComputeBudgetInstruction,
    message::{v0::Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
    transaction::VersionedTransaction,
};
use spl_associated_token_account::get_associated_token_address;
use std::{env, str::FromStr, sync::Arc, thread, time::Duration};
use spl_associated_token_account::instruction::create_associated_token_account_idempotent;
use solana_sdk::transaction::Transaction;
    
const PROGRAM_ID: &str = "DuFkXZLHxnuKpz9QzS128kEbs7e1bvmC91EGywP74n4U";
const JUP_PROGRAM_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const VAULT_SEED: &[u8] = b"vault";
const RPC_URL: &str = "https://api.mainnet-beta.solana.com";
const MAX_RETRIES: usize = 25;
// const SWAP_AMOUNT: u64 = 400_00;
const SWAP_AMOUNT: u64 = 1_000_00;
const PURCHASE_AMOUNT: u64 = 1_000_00;
const PURCHASE_REF: &str = "REF12345";
const EXCLUDED_DEXES: &str = "Obric V2,Moonit";

lazy_static! {
    static ref MERCHANT_WALLET: Pubkey = Pubkey::from_str("FsTgpYsHg7vi4tNv1aST6vCLYPH98DsxzhApqCReiXB6").unwrap();
}

fn load_keypair() -> Result<Keypair> {
    if let Ok(bs58_key) = env::var("BS58_KEYPAIR") {
        Ok(Keypair::from_bytes(&bs58::decode(bs58_key).into_vec()?)?)
    } else {
        let key_str = env::var("KEYPAIR")?;
        let bytes: Vec<u8> = key_str
            .trim_start_matches('[').trim_end_matches(']')
            .split(',').map(|s| s.trim().parse::<u8>())
            .collect::<Result<_, _>>()?;
        Ok(Keypair::from_bytes(&bytes)?)
    }
}

async fn ensure_vault_token_accounts(
    rpc: &Arc<RpcClient>,
    keypair: &Keypair,
    program_id: &Pubkey,
    input_token: &Pubkey,
    output_token: &Pubkey
) -> Result<()> {
    let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED], program_id);
    
    let input_mint_account = match rpc.get_account(input_token) {
        Ok(acc) => acc,
        Err(e) => return Err(anyhow::anyhow!("Failed to get input token account: {}", e)),
    };
    
    let input_token_program_id = if input_mint_account.owner == TOKEN2022_ID { 
        TOKEN2022_ID 
    } else { 
        spl_token::id() 
    };
    
    let output_mint_account = match rpc.get_account(output_token) {
        Ok(acc) => acc,
        Err(e) => return Err(anyhow::anyhow!("Failed to get output token account: {}", e)),
    };
    
    let output_token_program_id = if output_mint_account.owner == TOKEN2022_ID { 
        TOKEN2022_ID 
    } else { 
        spl_token::id() 
    };
    
    let input_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &vault, input_token, &input_token_program_id
    );
    
    let output_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &vault, output_token, &output_token_program_id
    );
    
    let input_account_exists = rpc.get_account_with_commitment(&input_ata, CommitmentConfig::confirmed())
        .map(|resp| resp.value.is_some())
        .unwrap_or(false);
        
    let output_account_exists = rpc.get_account_with_commitment(&output_ata, CommitmentConfig::confirmed())
        .map(|resp| resp.value.is_some())
        .unwrap_or(false);
    
    if input_account_exists && output_account_exists {
        println!("Vault token accounts already exist");
        return Ok(());
    }
    
    let mut instructions = Vec::new();
    
    if !input_account_exists {
        println!("Creating input token account for vault");
        instructions.push(create_associated_token_account_idempotent(
            &keypair.pubkey(),
            &vault,
            input_token,
            &input_token_program_id
        ));
    }
    
    if !output_account_exists {
        println!("Creating output token account for vault");
        instructions.push(create_associated_token_account_idempotent(
            &keypair.pubkey(),
            &vault,
            output_token,
            &output_token_program_id
        ));
    }
    
    if instructions.is_empty() {
        return Ok(());
    }
    
    let blockhash = match rpc.get_latest_blockhash() {
        Ok(bh) => bh,
        Err(e) => return Err(anyhow::anyhow!("Failed to get blockhash: {}", e)),
    };
    
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&keypair.pubkey()),
        &[keypair],
        blockhash
    );
    
    println!("Sending tx to create vault token accounts");
    match rpc.send_and_confirm_transaction(&tx) {
        Ok(sig) => println!("Created vault token accounts. Signature: {}", sig),
        Err(e) => {
            if e.to_string().contains("already in use") {
                println!("Vault token accounts already exist (concurrent creation)");
                return Ok(());
            }
            return Err(anyhow::anyhow!("Failed to create vault token accounts: {}", e));
        }
    }
    
    Ok(())
}

fn get_disc(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name).as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hasher.finalize()[..8]);
    disc
}

async fn get_alt_accounts(rpc: &Arc<RpcClient>, keys: Vec<Pubkey>) -> Result<Vec<AddressLookupTableAccount>> {
    let mut accounts = Vec::new();
    for key in keys {
        if let Ok(account) = rpc.get_account(&key) {
            if let Ok(table) = AddressLookupTable::deserialize(&account.data) {
                accounts.push(AddressLookupTableAccount { key, addresses: table.addresses.to_vec() });
            }
        }
    }
    Ok(accounts)
}

#[tokio::main]
async fn main() -> Result<()> {
    let rpc = Arc::new(RpcClient::new_with_commitment(
        env::var("RPC_URL").unwrap_or_else(|_| RPC_URL.to_string()),
        CommitmentConfig::confirmed()
    ));
    let keypair = load_keypair()?;
    let wallet = keypair.pubkey();
    println!("Wallet: {}", wallet);
    
    let input_token = Pubkey::from_str("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")?;
    let output_token = Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?;
    let ecosystem_token = Pubkey::from_str("HSy62G7UW1HZLS7RtKvQAuUbLSop5qn9TRfRo5qSsJDC")?;
    
    let api_url = env::var("API_BASE_URL").unwrap_or_else(|_| "https://quote-api.jup.ag/v6".to_string());
    
    let jup_api = JupiterSwapApiClient::new(api_url);
    
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED], &program_id);
    let vault_input = get_associated_token_address(&vault, &input_token);
    let vault_output = get_associated_token_address(&vault, &output_token);

    ensure_vault_token_accounts(
        &rpc, 
        &keypair,
        &program_id,
        &input_token, 
        &output_token
    ).await?;
    
    
    println!("Getting quote");
    
    let quote_request = QuoteRequest {
        amount: SWAP_AMOUNT,
        input_mint: input_token,
        output_mint: output_token,
        excluded_dexes: Some(EXCLUDED_DEXES.to_string()),
        only_direct_routes: Some(true), 
        ..Default::default()
    };
    
    println!("Quote req res");
    println!("  - amount: {}", quote_request.amount);
    println!("  - input_mint: {}", quote_request.input_mint);
    println!("  - output_mint: {}", quote_request.output_mint);
    println!("  - excluded_dexes: {:?}", quote_request.excluded_dexes);
    
    let quote = jup_api.quote(&quote_request).await?;
    
    println!("Quote : {} -> {}", quote.in_amount, quote.out_amount);
    println!("Price impact: {}%", quote.price_impact_pct);
    println!("Route size: {}", quote.route_plan.len());
    
    for (i, route) in quote.route_plan.iter().enumerate() {
        println!("Route {}: {} ({}%)", i, route.swap_info.label, route.percent);
    }
    
    let swap_resp = jup_api.swap_instructions(&SwapRequest {
        user_public_key: vault,
        quote_response: quote,
        config: TransactionConfig {
            skip_user_accounts_rpc_calls: false,
            wrap_and_unwrap_sol: true,
            dynamic_compute_unit_limit: true,
            dynamic_slippage: Some(DynamicSlippageSettings {
                min_bps: Some(100),
                max_bps: Some(1500),
            }),
            ..Default::default()
        },
    }).await?;
        
    let mint_account = rpc.get_account(&ecosystem_token)?;
    let token_program_id = if mint_account.owner == TOKEN2022_ID { TOKEN2022_ID } else { spl_token::id() };
    let user_token_account = spl_associated_token_account::get_associated_token_address_with_program_id(
        &wallet, &ecosystem_token, &token_program_id
    );
    
    let (ecosystem_config, _) = Pubkey::find_program_address(
        &[b"ecosystem_config", ecosystem_token.as_ref()], &program_id
    );
    let (fee_vault_authority, _) = Pubkey::find_program_address(
        &[b"fee_vault_authority", ecosystem_token.as_ref()], &program_id
    );
    let (collateral_vault, _) = Pubkey::find_program_address(
        &[b"collateral_vault", ecosystem_token.as_ref()], &program_id
    );
    let (merchant_balance, _) = Pubkey::find_program_address(
        &[b"merchant_balance", MERCHANT_WALLET.as_ref(), ecosystem_token.as_ref()], &program_id
    );
    
    let mut ix_data = get_disc("swap").to_vec();
    ix_data.extend_from_slice(&PURCHASE_AMOUNT.to_le_bytes());
    ix_data.extend_from_slice(&(PURCHASE_REF.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(PURCHASE_REF.as_bytes());
    ix_data.extend_from_slice(&(swap_resp.swap_instruction.data.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&swap_resp.swap_instruction.data);
    
    let mut accounts = vec![
        AccountMeta::new(wallet, true),
        AccountMeta::new_readonly(input_token, false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new_readonly(output_token, false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new(vault, false),
        AccountMeta::new(vault_input, false),
        AccountMeta::new(vault_output, false),
        AccountMeta::new_readonly(Pubkey::from_str(JUP_PROGRAM_ID)?, false),
        AccountMeta::new(ecosystem_token, false),
        AccountMeta::new_readonly(ecosystem_config, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new_readonly(token_program_id, false),
        AccountMeta::new_readonly(fee_vault_authority, false),
        AccountMeta::new(collateral_vault, false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new(merchant_balance, false),
        AccountMeta::new_readonly(*MERCHANT_WALLET, false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
    ];
    
    for acc in &swap_resp.swap_instruction.accounts {
        accounts.push(AccountMeta {
            pubkey: acc.pubkey,
            is_signer: false,
            is_writable: acc.is_writable,
        });
    }
    
    let instruction = Instruction {
        program_id,
        accounts,
        data: ix_data,
    };
    let alt_accounts = get_alt_accounts(&rpc, swap_resp.address_lookup_table_addresses).await?;
    
    println!("Sending swap tx");
    let cu_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);
    let cup_ix = ComputeBudgetInstruction::set_compute_unit_price(200_000);
    
    for attempt in 1..=MAX_RETRIES {
        let blockhash = match rpc.get_latest_blockhash() {
            Ok(bh) => bh,
            Err(e) => {
                println!("Blockhash error (try {}): {}", attempt, e);
                thread::sleep(Duration::from_millis(500));
                continue;
            }
        };
        
        let message = match Message::try_compile(&wallet, &[cu_ix.clone(), cup_ix.clone(), instruction.clone()], 
                                              &alt_accounts, blockhash) {
            Ok(msg) => msg,
            Err(e) => {
                println!("Message error (try {}): {}", attempt, e);
                thread::sleep(Duration::from_millis(500));
                continue;
            }
        };
        
        let tx = match VersionedTransaction::try_new(VersionedMessage::V0(message), &[&keypair]) {
            Ok(tx) => tx,
            Err(e) => {
                println!("Tx error (try {}): {}", attempt, e);
                thread::sleep(Duration::from_millis(500));
                continue;
            }
        };
        
        match rpc.send_and_confirm_transaction(&tx) {
            Ok(sig) => {
                println!("Tx:  https://explorer.solana.com/tx/{}", sig);
                return Ok(());
            },
            Err(e) => {
                println!("Tx failed (try {}): {}", attempt, e);
                thread::sleep(Duration::from_millis(1000));
            }
        }
    }
    
    anyhow::bail!("Failed after {} tries", MAX_RETRIES)
}