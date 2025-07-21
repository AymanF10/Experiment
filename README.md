# USP

Initial, more centralized version of a lending protocol where partner token communities can lock any $TOKEN and take a loan in $tuSP, an unspent version of that token; allowing them to airdrop rewards to users, without affecting token price heavily short term through massive sell-offs after airdrops when user’s spend their rewards.

## uSP - Token Deployer Anchor Program

### Architecture

- Config Account: Stores global protocol settings and owner information
- Ecosystem Config: Stores per-token ecosystem parameters
- Fee Vault: Has fees collected from deposits, withdrawals
- Collateral Vault: Stores collateral tokens backing each ecosystem's uSP
- Transfer Hook: Controls token transfers by gatekeeping it only to whitelisted users

### Setup

Before deployment make sure to set correct Solana wallet and network(localhost for local testing, devnet for test network deployment and mainnet for standard Solana network).

- Move into core uSP directory `cd token-deployer`
- Build the anchor program - `anchor build`
- Deploy program `anchor deploy`
- Run tests `anchor test`

**Fixing Issues**

- If tests are failing - check if program IDs are set correctly
  - to sync execute command `anchor keys sync`

### Deployment

Latest version including the jupiter integration won't fully work on devnet or localnet because jupiter only has functional deployment on mainnet. For mainnet deployment use these commands:

- Configure the wallet you want to use and make sure it has enough SOL on mainnet (around 3.7 SOL for deploying `token_deployer` program and around 2 SOL for `transfer_hook` program)
- Modify `Anchor.toml` to be configured for mainet:
  ```
  [provider]
  cluster = "mainnet"
  ```
- **These steps are only required if you're redeploying and need a new keypair:**
  - Close previously deployed program `solana program close <PROGRAM ID> --bypass-warning`
  - Generate new program keypair `solana-keygen new --outfile cpi-program-keypair.json --force`
  - Copy keypair file content for program you want to redeploy e.g. for `token_deployer` it's `/target/deploy/token_deployer-keypair.json`
  - Sync keys `anchor keys sync`
  - Rebuild the program `anchor build`
- Deploy chosen program e.g. `anchor deploy --program-name token_deployer --program-keypair target/deploy/token_deployer-keypair.json --provider.wallet ./../wallet/new_keypair.json`

### Ecosystem CLI

Testing with ecosystem cli has to be performed on mainnet, otherwise it won't work.

Latest mainnet deployments:

- token-deployer - **DuFkXZLHxnuKpz9QzS128kEbs7e1bvmC91EGywP74n4U**
- transfer-hook - **6BGyrUsGSJiscv8M3hC7JWMm4JKLBXMu3Js4ZQvcNY3G**

- Create directory with your wallet keypair in the core repo `mkdir wallet`
- Run `cd wallet`
- Create keypair file `touch new_keypair.json` and paste your private key as array of bytes
- Move to the ecosystem cli diorectory, install dependencies and build:
  ```
  cd ecosystem-testing
  npm i
  npm run build
  ```

```
# Run all steps e.g. with BONK
npm run run-all -- --collateral-token-mint DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263

# Run these steps separately
npm run initialize
npm run create-ecosystem -- --collateral-token-mint <MINT>
npm run create-token-account -- --ecosystem-mint <MINT>
npm run deposit -- --ecosystem-mint <MINT> --user-collateral-account <ACCOUNT>
```

For executing spurchase with uSP and jupiter swap:

```
cd jupiter-cpi
cd swap-execute-client
cargo build
BS58_KEYPAIR=<KEYPAIR> cargo run
```

Add new approver address:

```
npm run add-approver -- --approver-address <ADDRESS>
```

Then check if there is any balance in the merchant's account:

```
npm run check-balance -- \
 --ecosystem-mint <MINT> \
 --merchant-wallet <WALLET>
```

Request withdrawal of payment proceeds from ecosystem as merchant:

```
npm run request-withdrawal -- \
  --ecosystem-mint <MINT>  \
  --merchant-wallet <WALLET>
```

Approve withdrawal request from merchant as approver:

```
npm run approve-withdrawal -- \
  --ecosystem-mint <MINT>  \
  --merchant-wallet <WALLET> \
  --merchant-token-account <ACCOUNT>
```

### Anchor Test Files

- `token-deployer.spec.ts`: Main uSP tests for ecosystem, deposit, and fee functionality
- `transfer-hook.ts`: Transfer hook implementation and tests

### Core Functions

- initialize: Creates initial protocol config with program owner
- create_ecosystem: Creates a new token ecosystem with ecosystem partner wallet, max cap of created tokens, deposit fees, withdrawal fees
- deposit_ecosystem: Deposits collateral tokens and mints ecosystem tokens
- collect_fees: Allows owner to collect fees from deposits
- update_max_cap: Updates the maximum cap for a given ecosystem
- toggle_global_freeze: Enables/disables global protocol freeze
- toggle_ecosystem_freeze: Enables/disables freeze for specific ecosystem
- swap: Performs a purchase with specific merchant by submitting the merchant Pubkey, purchase reference id, burns chosen amount of uSPs to unlock the same amount of collateral token which is then sold on jupiter for USDC
- create_withdrawal_request: Allows merchant to withdraw USDC from purchases performed with uSPs in specific ecosystem and applies withdrawal fee from this specific ecosystem
- approve_withdrawal_request: Approves withdrawl request made by merchant and actually transfers the USDC to merchant wallet

### PDAs

ToDo

### Ecosystem Configuration

Initially when creating ecosystem, Spree admin can set these values:

- Ecosystem partner wallet(only this wallet can make deposits later on)
- Collateral token(backing uSPs from this specific ecosystem)
- Token metadata(decimals, name, ticker, image etc)
- Initial max uSP minting cap
- Withdrawal fees
- Deposit fees

Later `deposit`,` withdrawal` fees and `max minting cap` can be changed.

Collateral token change is not made possible on purpose because newly created ecosystem's uSP is initialized with specific metadata, decimals etc corresponding to the collateral token and that can't be changed later.

### Whitelisting

Program allows for dynamic access control with multiple whitelists:

- `uSP whitelist`: Controls which addressess(end users) can interact with uSPs(transfer them, use them for purchase)
- `Ecosystem whitelist`: When creating each new ecosystem program owner whitelists specific ecosystem partner to initialize deposits on behalf of this ecosystem.
- `Ecosystem Freeze state`: Owner can disable new deposits for specific ecosystem at any time
- `Global Freeze state`: Owner can disable new deposits globally for all ecosystems at any time
- `Ecosystem Max cap`: Limits amount of uSPs from specific ecosystems that can be in circulation at a time, can be adjusted later by the program owner.

### User Flow

#### Before creating ecosystems (Spree Admin)

- Redeploy the `token_deployer` and `transfer_hook` programs
- Call **Initialize** function - will initialize the global config, program owner

#### Adding new uSP partners (Spree Admin)

- Call **create_ecosystem** function with:
  - Token metadata for the new uSP(make sure that the amount of decimals for token is the same as decimals in collateral token)
- Whitelist merchant and users that should be able to receive uSPs later in the `transfer_hook`

#### Deposit collateral & mint more uSPs (Ecosystem Partner)

- If it's first time depositing to this ecosystem, run script to initialize accounts properly
- Call `deposit_ecosystem` function - it will lock chosen amount of colateral token and mint same amount of uSPs for the ecosystem to partner's wallet
- Distribute uSPs to ecosystem users so they can spend it later

#### Purchase (User)

- Call `swap` function - it will automatically burn the uSPs used for purchase, and swap collateral to USDC which can be claimed later by a merchant

#### Withdraw Request (Merchant)

- Call `create_withdrawal_request` function for every ecosystem where purchases were made to claim USDC from these purchases(standard withdrawal ecosystem fee applies)

#### Approve Withdrawal (Approver)

- Call `approve_withdrawal_request` function to approve withdrawal request made by a merchant
