#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};
use token_contract::Client as TokenClient;

// We need to import the token contract's WASM or just its types. 
// However, the `token_contract` module doesn't exist unless we define it.
// Oh wait, token contract was not defined as `token_contract::WASM` in `staking` unless `mod token_contract { soroban_sdk::contractimport!(file = "../token/target/wasm32-unknown-unknown/release/token.wasm"); }`
// Actually wait! Previously `staking/src/test.rs` imported `token_contract::Client` and `token_contract::WASM`. 
// Where is `token_contract` module? Let me look at the top of `staking/src/lib.rs` or `test.rs`.
// Ah! In the original `staking/src/test.rs`, it used `use token_contract::Client as TokenClient;`
// Let me first add `mod token_contract { soroban_sdk::contractimport!(file = "../token/target/wasm32-unknown-unknown/release/token.wasm"); }` 
// But wait, the wasm file might not be built yet during `cargo test`. 
// A better way is to use `soroban_sdk::contractimport` or just use the rust crate as a dependency!
// Since `token` is in `dev-dependencies`, we can just use `token::TokenContractClient`!

use token::TokenContractClient;
use token::TokenContract;

fn setup(env: &Env) -> (Address, TokenContractClient<'static>, Address, StakingContractClient<'static>) {
    env.mock_all_auths();
    
    // Register token contract
    let token_id = env.register_contract(None, TokenContract);
    let token_client = TokenContractClient::new(&env, &token_id);
    
    // Initialize token contract
    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Reward");
    let symbol = String::from_str(&env, "RWD");
    
    token_client.initialize(&admin, &name, &symbol); 

    // Register staking contract
    let staking_id = env.register_contract(None, StakingContract);
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Give staking contract admin rights over token (for minting)
    token_client.set_admin(&staking_id);

    staking_client.initialize(&token_id);

    let user = Address::generate(&env);
    (user, token_client, staking_id, staking_client)
}

#[test]
fn test_successful_stake() {
    let env = Env::default();
    let (user, _, _, staking_client) = setup(&env);
    
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &500);

    // No way to directly read state easily without a getter, but we can verify it doesn't panic
    // And we can calculate rewards at time 1000 which should be 0.
    let rewards = staking_client.calculate_rewards(&user);
    assert_eq!(rewards, 0);
}

#[test]
fn test_unstake_and_rewards() {
    let env = Env::default();
    let (user, token_client, _, staking_client) = setup(&env);
    
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &100);

    env.ledger().with_mut(|l| l.timestamp = 1050); // 50 seconds passed
    
    let expected_rewards = 100 * 50; // 5000
    
    assert_eq!(staking_client.calculate_rewards(&user), expected_rewards);
    
    staking_client.unstake(&user);
    
    // The balance should be the claimed rewards
    assert_eq!(token_client.balance(&user), expected_rewards);
}

#[test]
fn test_inter_contract_call_claim_rewards() {
    let env = Env::default();
    let (user, token_client, _, staking_client) = setup(&env);
    
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &200);

    env.ledger().with_mut(|l| l.timestamp = 1010); // 10 seconds passed
    
    // Claiming rewards should explicitly invoke the token contract
    staking_client.claim_rewards(&user);
    
    // Check balance is updated via inter-contract mint call
    assert_eq!(token_client.balance(&user), 200 * 10);
}

