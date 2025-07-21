use anyhow::Result;
use sha2::{Digest, Sha256};
use solana_client::client_error::ClientError;
use solana_client::rpc_client::RpcClient;
use solana_sdk::address_lookup_table::state::AddressLookupTable;
use solana_sdk::address_lookup_table::AddressLookupTableAccount;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;

#[allow(dead_code)]
pub async fn get_address_lookup_table_accounts(
    rpc_client: &Arc<RpcClient>,
    addresses: Vec<Pubkey>,
) -> Result<Vec<AddressLookupTableAccount>, ClientError> {
    let mut accounts = Vec::new();
    for key in addresses {
        if let Ok(account) = rpc_client.get_account(&key) {
            if let Ok(address_lookup_table_account) = AddressLookupTable::deserialize(&account.data)
            {
                accounts.push(AddressLookupTableAccount {
                    key,
                    addresses: address_lookup_table_account.addresses.to_vec(),
                });
            }
        }
    }
    Ok(accounts)
}

// Function to generate Anchor's instruction discriminator
pub fn get_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    let result = hasher.finalize();
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&result[..8]);
    discriminator
}
