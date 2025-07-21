use anchor_lang::prelude::*;

#[error_code]
pub enum SpreeTokenError {
    #[msg("Unauthorized access: Caller does not have the required permissions.")]
    Unauthorized, // 6000

    #[msg("Invalid Data: There is an error in the data provided.")]
    InvalidData, // 6001

    #[msg("This operation is currently not allowed.")]
    OperationNotAllowed, // 6002

    #[msg("Insufficient Balance")]
    InsufficientBalance, // 6003

    #[msg("Bps out of range: Bps must be between 0 and 10000.")]
    BpsOutOfRange, // 6004

    #[msg("Recipient is not whitelisted.")]
    RecipientNotWhitelisted, // 6005

    #[msg("The token is not currently transferring")]
    IsNotCurrentlyTransferring, // 6006

    #[msg("All operations are currently frozen.")]
    GlobalFrozen, // 6007

    #[msg("Minting operations are currently frozen.")]
    MintFrozen, // 6008

    #[msg("Transferring operations are currently frozen.")]
    TransferFrozen, // 6009
    
    #[msg("Burning operations are currently frozen.")]
    BurnFrozen, // 6010
}
