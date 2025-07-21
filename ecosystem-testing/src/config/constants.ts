import {
  ProgramConfig,
  Seeds,
  InstructionDiscriminators,
  DefaultConfig,
} from "../types/index.js";

export const PROGRAM_CONFIG: ProgramConfig = {
  PROGRAM_ID: "DuFkXZLHxnuKpz9QzS128kEbs7e1bvmC91EGywP74n4U",
  TOKEN_2022_PROGRAM_ID: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  SPL_TOKEN_PROGRAM_ID: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TRANSFER_HOOK: "6BGyrUsGSJiscv8M3hC7JWMm4JKLBXMu3Js4ZQvcNY3G",
};

export const SEEDS: Seeds = {
  CONFIG: "config",
  MINT_AUTHORITY: "mint_authority",
  ECOSYSTEM_CONFIG: "ecosystem_config",
  FEE_VAULT_AUTHORITY: "fee_vault_authority",
  FEE_VAULT: "fee_vault",
  COLLATERAL_VAULT: "collateral_vault",
};

export const INSTRUCTION_DISCRIMINATORS: InstructionDiscriminators = {
  INITIALIZE: [175, 175, 109, 31, 13, 152, 155, 237],
  CREATE_ECOSYSTEM: [112, 220, 80, 248, 66, 241, 71, 246],
  DEPOSIT_ECOSYSTEM: [177, 193, 65, 180, 136, 55, 178, 43],
  ADD_APPROVER: [213, 245, 135, 79, 129, 129, 22, 80],
  REMOVE_APPROVER: [214, 72, 133, 48, 50, 58, 227, 224],
  CREATE_WITHDRAWAL_REQUEST: [37, 98, 178, 192, 168, 139, 43, 242],
  APPROVE_WITHDRAWAL_REQUEST: [190, 168, 219, 52, 136, 10, 126, 172],
};

export const DEFAULT_CONFIG: DefaultConfig = {
  // keypair: "~/.config/solana/id.json",
  keypair: "./../wallet/new_keypair.json",
  url: "https://api.mainnet-beta.solana.com",
  commitment: "confirmed",
  computeUnits: 400000,
};
