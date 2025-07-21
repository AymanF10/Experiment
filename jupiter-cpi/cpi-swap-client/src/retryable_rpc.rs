use std::time::Duration;

use anyhow::bail;
use solana_client::{
    client_error::ClientError, nonblocking::rpc_client::RpcClient,
    rpc_client::SerializableTransaction, rpc_config::RpcSendTransactionConfig,
    rpc_request::RpcError,
};
use solana_sdk::{
    account::Account,
    commitment_config::{CommitmentConfig, CommitmentLevel},
    pubkey::Pubkey,
    signature::Signature,
    transaction::VersionedTransaction,
};
use tokio::time::sleep;

// Since a blockshash is only valid for 150 blocks, we can have a timeout based retry for tx sending
// for now lets do a 100 block timeout which is about 400ms * 100 = 40s
pub const MAX_RETRY_TIMEOUT_SECONDS: u64 = 40;
pub const MAX_RETRY_COUNT: u64 = 10;

pub struct RetryableRpcClient {
    pub rpc_client: RpcClient,
}

// Basic retry wrapper for RPC client
// If we require more control with retries, we can add a retry enum for different retry types
// or if we want to have custom retry interval, we can change up how we want to write the wrapper
/// Solana RPC client retry wrapper
impl RetryableRpcClient {
    #[allow(unused)]
    pub fn new(rpc_url: &str) -> Self {
        let rpc_client = RpcClient::new(rpc_url.to_string());
        Self { rpc_client }
    }

    #[allow(unused)]
    pub fn new_with_commitment(rpc_url: &str, commitment_config: CommitmentConfig) -> Self {
        let rpc_client = RpcClient::new_with_commitment(rpc_url.to_string(), commitment_config);
        Self { rpc_client }
    }

    #[allow(unused)]
    pub async fn get_multiple_accounts_with_retry(
        &self,
        pubkeys: &[Pubkey],
    ) -> anyhow::Result<Vec<Option<Account>>> {
        let mut retry_count = 0;

        loop {
            if retry_count > MAX_RETRY_COUNT {
                bail!(anyhow::anyhow!("Max retry count reached"));
            }

            match self.rpc_client.get_multiple_accounts(pubkeys).await {
                Ok(accounts) => return Ok(accounts),
                Err(_err) => {
                    retry_count += 1;
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                }
            }
        }
    }

    /// Extracted from RpcClient but changed to reasonable commitment
    pub async fn send_and_confirm_transaction(
        &self,
        transaction: &impl SerializableTransaction,
    ) -> Result<Signature, ClientError> {
        const SEND_RETRIES: usize = 100;
        const GET_STATUS_RETRIES: usize = usize::MAX;

        'sending: for _ in 0..SEND_RETRIES {
            let signature = self
                .rpc_client
                .send_transaction_with_config(
                    transaction,
                    RpcSendTransactionConfig {
                        max_retries: Some(0),
                        skip_preflight: true,
                        preflight_commitment: None,
                        ..RpcSendTransactionConfig::default()
                    },
                )
                .await?;

            let recent_blockhash = if transaction.uses_durable_nonce() {
                let (recent_blockhash, ..) = self
                    .rpc_client
                    .get_latest_blockhash_with_commitment(CommitmentConfig::processed())
                    .await?;
                recent_blockhash
            } else {
                *transaction.get_recent_blockhash()
            };

            for status_retry in 0..GET_STATUS_RETRIES {
                match self.rpc_client.get_signature_status(&signature).await? {
                    Some(Ok(_)) => return Ok(signature),
                    Some(Err(e)) => return Err(e.into()),
                    None => {
                        if !self
                            .rpc_client
                            .is_blockhash_valid(&recent_blockhash, CommitmentConfig::processed())
                            .await?
                        {
                            // Block hash is not found by some reason
                            break 'sending;
                        } else if cfg!(not(test))
                            // Ignore sleep at last step.
                            && status_retry < GET_STATUS_RETRIES
                        {
                            // Retry twice a second
                            sleep(Duration::from_millis(500)).await;
                            continue;
                        }
                    }
                }
            }
        }

        Err(RpcError::ForUser(
            "unable to confirm transaction. \
             This can happen in situations such as transaction expiration \
             and insufficient fee-payer funds"
                .to_string(),
        )
        .into())
    }

    /// Use [`send_transaction_with_config`] if you want to know the transaction status before any further processing
    /// Retryable send transaction with custom retry logic
    #[allow(unused)]
    pub async fn send_transaction_with_retry(
        &self,
        transaction: &VersionedTransaction,
    ) -> anyhow::Result<Signature> {
        // Start the timer
        let start_time = tokio::time::Instant::now();

        // Retry until timeout
        loop {
            if start_time.elapsed().as_secs() > MAX_RETRY_TIMEOUT_SECONDS {
                bail!(anyhow::anyhow!("Transaction send timeout"))
            }

            match self
                .rpc_client
                .send_transaction_with_config(
                    transaction,
                    RpcSendTransactionConfig {
                        preflight_commitment: Some(CommitmentLevel::Processed),
                        ..RpcSendTransactionConfig::default()
                    },
                )
                .await
            {
                Ok(signature) => return Ok(signature),
                Err(err) => {
                    // tracing::error!("Error sending transaction: {:?}", err);
                    // TODO: For now we just retry all, but we might want to select specific errors to retry so we don't retry all the time
                    // match err.kind {
                    //     solana_client::client_error::ClientErrorKind::Io(_) => todo!(),
                    //     solana_client::client_error::ClientErrorKind::Reqwest(_) => todo!(),
                    //     solana_client::client_error::ClientErrorKind::RpcError(_) => todo!(),
                    //     solana_client::client_error::ClientErrorKind::SerdeJson(_) => todo!(),
                    //     solana_client::client_error::ClientErrorKind::SigningError(_) => todo!(),
                    //     solana_client::client_error::ClientErrorKind::TransactionError(_) => {
                    //         todo!()
                    //     }
                    //     solana_client::client_error::ClientErrorKind::Custom(_) => todo!(),
                    // }
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                }
            }
        }
    }
}
