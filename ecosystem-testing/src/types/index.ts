import {
  PublicKey,
  Keypair,
  Connection,
  TransactionSignature,
} from "@solana/web3.js";

export interface ProgramConfig {
  PROGRAM_ID: string;
  TOKEN_2022_PROGRAM_ID: string;
  SPL_TOKEN_PROGRAM_ID: string;
  TRANSFER_HOOK: string;
}

export interface Seeds {
  CONFIG: string;
  MINT_AUTHORITY: string;
  ECOSYSTEM_CONFIG: string;
  FEE_VAULT_AUTHORITY: string;
  FEE_VAULT: string;
  COLLATERAL_VAULT: string;
}

export interface InstructionDiscriminators {
  INITIALIZE: number[];
  CREATE_ECOSYSTEM: number[];
  DEPOSIT_ECOSYSTEM: number[];
  ADD_APPROVER: number[];
  REMOVE_APPROVER: number[];
  CREATE_WITHDRAWAL_REQUEST: number[];
  APPROVE_WITHDRAWAL_REQUEST: number[];
}

export interface DefaultConfig {
  keypair: string;
  url: string;
  commitment: string;
  computeUnits: number;
}

export interface EcosystemConfig {
  decimals?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  transferHookProgramId?: string;
  ecosystemPartnerWallet?: string;
  maxMintingCap?: string;
  withdrawalFeeBasisPoints?: string;
  depositFeeBasisPoints?: string;
  collateralTokenMint: string;
  computeUnits?: number;
}

export interface DepositConfig {
  ecosystemMint: string;
  userCollateralAccount: string;
  amount: string;
  computeUnits?: number;
}

export interface CliArgs {
  _: string[];
  keypair: string;
  url: string;
  decimals: string;
  name: string;
  symbol: string;
  uri: string;
  "transfer-hook-program-id": string;
  "ecosystem-partner-wallet": string;
  "max-minting-cap": string;
  "withdrawal-fee-basis-points": string;
  "deposit-fee-basis-points": string;
  "collateral-token-mint": string;
  "ecosystem-mint": string;
  "user-collateral-account": string;
  amount: string;
  "approver-address": string;
  "merchant-wallet": string;
  "merchant-token-account": string;
  verbose: boolean;
  help: boolean;
}

export interface WithdrawalConfig {
  ecosystemMint: string;
  merchantWallet?: string;
}

export interface ApprovalConfig {
  ecosystemMint: string;
  merchantWallet: string;
  merchantTokenAccount: string;
}

export interface ApproverConfig {
  approverAddress: string;
}

export interface OperationResult {
  signature: TransactionSignature | null;
}

export interface InitializeResult extends OperationResult {
  configPda: PublicKey;
}

export interface CreateEcosystemResult extends OperationResult {
  mint: PublicKey;
  ecosystemConfig: PublicKey;
  feeVault: PublicKey;
  collateralVault: PublicKey;
}

export interface CreateTokenAccountResult extends OperationResult {
  tokenAccount: PublicKey;
}

export interface PdaResult {
  pda: PublicKey;
  bump: number;
}

export interface GlobalOptions {
  maxRetries: number;
  fastMode: boolean;
  verbose: boolean;
}
