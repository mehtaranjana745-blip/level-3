#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

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

fn setup(env: &Env) -> (Address, TokenContractClient<'static>, TokenContractClient<'static>, Address, StakingContractClient<'static>) {
    env.mock_all_auths();
    
    // Register reward token contract
    let reward_token_id = env.register_contract(None, TokenContract);
    let reward_token_client = TokenContractClient::new(&env, &reward_token_id);
    
    // Initialize reward token contract
    let admin = Address::generate(&env);
    let name1 = String::from_str(&env, "Reward");
    let symbol1 = String::from_str(&env, "RWD");
    reward_token_client.initialize(&admin, &name1, &symbol1); 

    // Register staking token contract
    let staking_token_id = env.register_contract(None, TokenContract);
    let staking_token_client = TokenContractClient::new(&env, &staking_token_id);
    
    // Initialize staking token contract
    let name2 = String::from_str(&env, "Staking");
    let symbol2 = String::from_str(&env, "STK");
    staking_token_client.initialize(&admin, &name2, &symbol2); 

    // Register staking contract
    let staking_id = env.register_contract(None, StakingContract);
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Give staking contract admin rights over reward token (for minting)
    reward_token_client.set_admin(&staking_id);

    // Initialize staking contract with both reward and staking tokens
    staking_client.initialize(&reward_token_id, &staking_token_id);

    let user = Address::generate(&env);
    
    // Fund the user with some staking tokens
    staking_token_client.mint(&user, &1000000);

    (user, reward_token_client, staking_token_client, staking_id, staking_client)
}

#[test]
fn test_successful_stake() {
    let env = Env::default();
    let (user, _, staking_token_client, _, staking_client) = setup(&env);
    
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &500);

    // Verify staking tokens were debited from the user's account
    assert_eq!(staking_token_client.balance(&user), 1000000 - 500);

    let rewards = staking_client.calculate_rewards(&user);
    assert_eq!(rewards, 0);
}

#[test]
fn test_unstake_and_rewards() {
    let env = Env::default();
    let (user, reward_token_client, staking_token_client, _, staking_client) = setup(&env);
    
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &100);

    env.ledger().with_mut(|l| l.timestamp = 1050); // 50 seconds passed
    
    let expected_rewards = 100 * 50; // 5000
    
    assert_eq!(staking_client.calculate_rewards(&user), expected_rewards);
    
    staking_client.unstake(&user);
    
    // Verify staking tokens were credited back to the user
    assert_eq!(staking_token_client.balance(&user), 1000000);
    
    // Verify reward tokens were claimed and credited
    assert_eq!(reward_token_client.balance(&user), expected_rewards);
}

#[test]
fn test_inter_contract_call_claim_rewards() {
    let env = Env::default();
    let (user, reward_token_client, _, _, staking_client) = setup(&env);
    
    env.ledger().with_mut(|l| l.timestamp = 1000);
    staking_client.stake(&user, &200);

    env.ledger().with_mut(|l| l.timestamp = 1010); // 10 seconds passed
    
    // Claiming rewards should explicitly invoke the token contract
    staking_client.claim_rewards(&user);
    
    // Check balance is updated via inter-contract mint call
    assert_eq!(reward_token_client.balance(&user), 200 * 10);
}

#[test]
fn test_get_stake() {
    let env = Env::default();
    let (user, _, _, _, staking_client) = setup(&env);
    
    staking_client.stake(&user, &350);
    assert_eq!(staking_client.get_stake(&user), 350);
}


