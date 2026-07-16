$ErrorActionPreference = "Stop"

Write-Host "Building smart contracts..."
cd contracts
stellar contract build

Write-Host "Deploying Token Contract to testnet..."
$token_address = (stellar contract deploy --wasm target/wasm32v1-none/release/token.wasm --network testnet --source admin)
Write-Host "Token deployed at: $token_address"

Write-Host "Deploying Staking Contract to testnet..."
$staking_address = (stellar contract deploy --wasm target/wasm32v1-none/release/staking.wasm --network testnet --source admin)
Write-Host "Staking deployed at: $staking_address"

Write-Host "Initializing Token Contract..."
$admin_address = (stellar keys address admin)
stellar contract invoke --id $token_address --network testnet --source admin -- initialize --admin $admin_address --name "RewardToken" --symbol "RWD"

Write-Host "Initializing Staking Contract..."
stellar contract invoke --id $staking_address --network testnet --source admin -- initialize --reward_token $token_address

Write-Host "Setting Staking Contract as Token Admin..."
stellar contract invoke --id $token_address --network testnet --source admin -- set_admin --new_admin $staking_address

Write-Host "Deployment completed successfully!"
Write-Host "Token Address: $token_address"
Write-Host "Staking Address: $staking_address"
