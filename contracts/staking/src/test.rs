#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};
use token_contract::Client as TokenClient;

#[test]
fn test_staking_flow() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Register token contract (need a dummy or we can just deploy the actual one from wasm)
    // Actually, since we import it, we can register the imported wasm
    let token_wasm = env.deployer().upload_contract_wasm(token_contract::WASM);
    let token_id = env.register_contract(None, token_contract::WASM);
    let token_client = TokenClient::new(&env, &token_id);
    
    // Initialize token contract
    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Reward");
    let symbol = String::from_str(&env, "RWD");
    
    // We must call initialize via the client
    // token_client.initialize(&admin, &name, &symbol); 
    // Wait, since we are doing an inter-contract call, the token contract must be initialized.
    // The token contract has `initialize(env, admin, name, symbol)`. 
    env.invoke_contract::<()>(&token_id, &soroban_sdk::Symbol::new(&env, "initialize"), (admin.clone(), name.clone(), symbol.clone()).into_val(&env));

    // Register staking contract
    let staking_id = env.register_contract(None, StakingContract);
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Give staking contract admin rights over token (for minting)
    env.invoke_contract::<()>(&token_id, &soroban_sdk::Symbol::new(&env, "set_admin"), (staking_id.clone(),).into_val(&env));

    staking_client.initialize(&token_id);

    let user = Address::generate(&env);
    
    // Stake
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &100);

    // Fast forward 10 seconds
    env.ledger().with_mut(|l| l.timestamp = 1010);
    
    // Calculate rewards (100 * 10 = 1000)
    let rewards = staking_client.calculate_rewards(&user);
    assert_eq!(rewards, 1000);

    // Claim rewards
    staking_client.claim_rewards(&user);

    // Check balance
    let balance: i128 = env.invoke_contract(&token_id, &soroban_sdk::Symbol::new(&env, "balance"), (user.clone(),).into_val(&env));
    assert_eq!(balance, 1000);

    // Unstake
    staking_client.unstake(&user);
    
    // After unstaking, another 0 seconds passed since we didn't advance time, so no new rewards
}
