#!/bin/bash
# Exit Validator if ctrl + c pressed in Terminal
set -e
# Function to clean up background processes
cleanup() {
    echo "Cleaning up..."
    # Kill any background jobs
    pkill -P $$
    # Remove the test-ledger folder
    rm -rf test-ledger/
    exit 0
}
# Trap SIGINT (Ctrl+C) to call cleanup function
trap cleanup SIGINT
# Enter your public key address in the terminal:
# echo -n "Please enter the Solana address: "
# read ADDRESS

# Automatically fetch the currently configured Solana address
ADDRESS=$(solana address)
# Validate the input
if [ -z "$ADDRESS" ]; then
    echo "Error: Address cannot be empty."
    exit 1
fi
echo "Using ADDRESS: $ADDRESS"
# Fetch USDC Solana account details and output as JSON
solana account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --output json --output-file ./tests/genesis/usdc.json -um
# Modify mint authority
python3 -c "
import base64
import base58
import json
usdc = json.load(open('./tests/genesis/usdc.json'))
data = bytearray(base64.b64decode(usdc['account']['data'][0]))
data[4:4+32] = base58.b58decode('$ADDRESS')
encoded_data = base64.b64encode(data).decode('utf8')
usdc['account']['data'][0] = encoded_data
with open('./tests/genesis/usdc_clone.json', 'w') as f:
    json.dump(usdc, f)
"
# Start Solana test validator
solana-test-validator --account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ./tests/genesis/usdc_clone.json --reset &
# Store PID of the validator process
VALIDATOR_PID=$!
# Wait for the validator to start
sleep 10
# Create a token account
spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
# Mint tokens
spl-token mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 123456789
# Output explorer URL
echo "Head over to the explorer and switch cluster to localnet, enjoy!"
echo "http://explorer.solana.com/address/$ADDRESS/tokens?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"
# Wait for the validator process to finish (Ctrl+C will trigger cleanup)
wait $VALIDATOR_PID