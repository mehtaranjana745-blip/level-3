#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, IntoVal};



#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    RewardToken,
    Stake(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct StakeInfo {
    pub amount: i128,
    pub timestamp: u64,
}

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    pub fn initialize(env: Env, reward_token: Address) {
        if env.storage().instance().has(&DataKey::RewardToken) {
            panic!("already initialized")
        }
        env.storage().instance().set(&DataKey::RewardToken, &reward_token);
    }

    pub fn stake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Normally we would transfer a staking token from user to contract, 
        // but for simplicity let's say this contract records native XLM stakes 
        // or just records the intention (mock stake) for the testnet demo.
        // We will just record the amount.
        
        let current_time = env.ledger().timestamp();
        
        let mut new_amount = amount;
        if let Some(_) = env.storage().persistent().get::<_, StakeInfo>(&DataKey::Stake(user.clone())) {
            // Claim rewards for the existing stake before updating
            Self::claim_rewards_internal(env.clone(), user.clone());
            if let Some(updated_stake) = env.storage().persistent().get::<_, StakeInfo>(&DataKey::Stake(user.clone())) {
                new_amount += updated_stake.amount;
            }
        }

        env.storage().persistent().set(
            &DataKey::Stake(user.clone()),
            &StakeInfo {
                amount: new_amount,
                timestamp: current_time,
            },
        );

        env.events().publish((soroban_sdk::symbol_short!("Staked"), user), amount);
    }

    pub fn unstake(env: Env, user: Address) {
        user.require_auth();

        if let Some(stake_info) = env.storage().persistent().get::<_, StakeInfo>(&DataKey::Stake(user.clone())) {
            Self::claim_rewards_internal(env.clone(), user.clone());
            env.storage().persistent().remove(&DataKey::Stake(user.clone()));
            env.events().publish((soroban_sdk::symbol_short!("Unstaked"), user), stake_info.amount);
        } else {
            panic!("no active stake");
        }
    }

    pub fn calculate_rewards(env: Env, user: Address) -> i128 {
        if let Some(stake_info) = env.storage().persistent().get::<_, StakeInfo>(&DataKey::Stake(user)) {
            let current_time = env.ledger().timestamp();
            let time_staked = current_time.saturating_sub(stake_info.timestamp) as i128;
            
            // Reward formula: 1 reward token per 1 stake unit per second for demo purposes
            stake_info.amount * time_staked
        } else {
            0
        }
    }

    pub fn get_stake(env: Env, user: Address) -> i128 {
        if let Some(stake_info) = env.storage().persistent().get::<_, StakeInfo>(&DataKey::Stake(user)) {
            stake_info.amount
        } else {
            0
        }
    }

    fn claim_rewards_internal(env: Env, user: Address) {
        let rewards = Self::calculate_rewards(env.clone(), user.clone());
        if rewards > 0 {
            if let Some(mut stake_info) = env.storage().persistent().get::<_, StakeInfo>(&DataKey::Stake(user.clone())) {
                stake_info.timestamp = env.ledger().timestamp();
                env.storage().persistent().set(&DataKey::Stake(user.clone()), &stake_info);
            }

            let token_id: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
            env.invoke_contract::<()>(&token_id, &soroban_sdk::Symbol::new(&env, "mint"), (user.clone(), rewards).into_val(&env));

            env.events().publish((soroban_sdk::symbol_short!("Claimed"), user.clone()), rewards);
        }
    }

    pub fn claim_rewards(env: Env, user: Address) {
        user.require_auth();
        Self::claim_rewards_internal(env.clone(), user.clone());
    }
}

mod test;
