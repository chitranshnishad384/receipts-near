//! Testnet NEP-141 token used as a stand-in for USDC.
//!
//! This is not Circle USDC, not bridged USDC, and not redeemable for dollars.
//! Decimals are 6 so amounts line up with USDC's display convention.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    PromiseResult,
};

const STORAGE_COST: u128 = 1_250_000_000_000_000_000_000;
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(35);
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    owner: AccountId,
    total_supply: u128,
    balances: LookupMap<AccountId, u128>,
    metadata: FungibleTokenMetadata,
}

#[near]
impl Token {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner: owner_id,
            total_supply: 0,
            balances: LookupMap::new(b"b"),
            metadata: FungibleTokenMetadata {
                spec: "ft-1.0.0".to_string(),
                name: "Receipts Demo USDC".to_string(),
                symbol: "dmUSD".to_string(),
                icon: None,
                reference: Some(
                    "NEAR testnet stand-in for USDC. Not issued by Circle. Not redeemable for dollars."
                        .to_string(),
                ),
                reference_hash: None,
                decimals: 6,
            },
        }
    }

    /// Owner-only mint for the testnet demo. Registers the receiver if needed.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can mint");
        let amount = amount.0;
        require!(amount > 0, "amount must be positive");
        if !self.balances.contains_key(&account_id) {
            self.balances.insert(account_id.clone(), 0);
        }
        let next = self.balance_of_raw(&account_id) + amount;
        self.balances.insert(account_id.clone(), next);
        self.total_supply += amount;
        emit_ft("ft_mint", &account_id, &account_id, amount, Some("demo mint"));
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance_of_raw(&account_id))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }

    pub fn disclaimer(&self) -> String {
        "dmUSD is a NEAR testnet fungible token used as a stand-in for USDC. It is not issued by Circle, is not bridged USDC, and is not redeemable for dollars.".to_string()
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds {
            min: U128(STORAGE_COST),
            max: Some(U128(STORAGE_COST)),
        }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        if self.balances.contains_key(&account_id) {
            Some(StorageBalance {
                total: U128(STORAGE_COST),
                available: U128(0),
            })
        } else {
            None
        }
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let _ = registration_only;
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit().as_yoctonear();
        let payer = env::predecessor_account_id();
        if self.balances.contains_key(&account) {
            refund(&payer, attached);
            return StorageBalance {
                total: U128(STORAGE_COST),
                available: U128(0),
            };
        }
        require!(
            attached >= STORAGE_COST,
            "attach at least 0.00125 NEAR to register"
        );
        self.balances.insert(account.clone(), 0);
        refund(&payer, attached - STORAGE_COST);
        StorageBalance {
            total: U128(STORAGE_COST),
            available: U128(0),
        }
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.transfer_internal(&sender, &receiver_id, amount.0, memo.as_deref());
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        near_sdk::assert_one_yocto();
        require!(
            env::prepaid_gas() >= GAS_FOR_ON_TRANSFER.saturating_add(GAS_FOR_RESOLVE),
            "attach at least 45 TGas"
        );
        let sender = env::predecessor_account_id();
        let amount = amount.0;
        self.transfer_internal(&sender, &receiver_id, amount, memo.as_deref());
        let promise = ext_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_ON_TRANSFER)
            .ft_on_transfer(sender.clone(), U128(amount), msg)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .ft_resolve_transfer(sender, receiver_id, U128(amount)),
            );
        PromiseOrValue::Promise(promise)
    }

    /// Refunds unused tokens after `ft_on_transfer`. A failed receiver call refunds the full amount.
    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let amount = amount.0;
        let unused = match env::promise_result(0) {
            PromiseResult::Successful(bytes) => {
                if let Ok(U128(parsed)) = near_sdk::serde_json::from_slice::<U128>(&bytes) {
                    parsed.min(amount)
                } else {
                    amount
                }
            }
            PromiseResult::Failed => amount,
        };
        if unused > 0 {
            let receiver_balance = self.balance_of_raw(&receiver_id);
            let refund_amount = unused.min(receiver_balance);
            if refund_amount > 0 {
                self.balances
                    .insert(receiver_id.clone(), receiver_balance - refund_amount);
                if !self.balances.contains_key(&sender_id) {
                    self.balances.insert(sender_id.clone(), 0);
                }
                let sender_balance = self.balance_of_raw(&sender_id);
                self.balances
                    .insert(sender_id.clone(), sender_balance + refund_amount);
                emit_ft(
                    "ft_transfer",
                    &receiver_id,
                    &sender_id,
                    refund_amount,
                    Some("refund unused"),
                );
            }
        }
        U128(amount - unused.min(amount))
    }

    fn balance_of_raw(&self, account_id: &AccountId) -> u128 {
        self.balances.get(account_id).copied().unwrap_or(0)
    }

    fn transfer_internal(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        amount: u128,
        memo: Option<&str>,
    ) {
        require!(sender != receiver, "sender and receiver must differ");
        require!(amount > 0, "amount must be positive");
        require!(
            self.balances.contains_key(sender),
            "sender is not registered"
        );
        require!(
            self.balances.contains_key(receiver),
            "receiver is not registered"
        );
        let sender_balance = self.balance_of_raw(sender);
        require!(sender_balance >= amount, "not enough dmUSD");
        self.balances.insert(sender.clone(), sender_balance - amount);
        let receiver_balance = self.balance_of_raw(receiver);
        self.balances
            .insert(receiver.clone(), receiver_balance + amount);
        emit_ft("ft_transfer", sender, receiver, amount, memo);
    }
}

fn refund(account: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

fn emit_ft(event: &str, old_owner: &AccountId, new_owner: &AccountId, amount: u128, memo: Option<&str>) {
    let data = if event == "ft_mint" {
        near_sdk::serde_json::json!([{
            "owner_id": new_owner,
            "amount": amount.to_string(),
            "memo": memo,
        }])
    } else {
        near_sdk::serde_json::json!([{
            "old_owner_id": old_owner,
            "new_owner_id": new_owner,
            "amount": amount.to_string(),
            "memo": memo,
        }])
    };
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "nep141",
            "version": "1.0.0",
            "event": event,
            "data": data,
        })
    ));
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_receiver)]
trait ExtReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128;
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_self)]
trait ExtSelf {
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128;
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, VMContext};

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn context(predecessor: &str, deposit: u128) -> VMContext {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("token.testnet"))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .prepaid_gas(Gas::from_tgas(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        builder.build()
    }

    fn setup() -> Token {
        testing_env!(context("owner.testnet", 0));
        let mut token = Token::new(account("owner.testnet"));
        testing_env!(context("owner.testnet", 0));
        token.mint(account("sender.testnet"), U128(50_000_000));
        testing_env!(context("payer.testnet", STORAGE_COST));
        token.storage_deposit(Some(account("escrow.testnet")), None);
        token
    }

    #[test]
    fn metadata_says_this_is_a_stand_in() {
        let token = setup();
        let meta = token.ft_metadata();
        assert_eq!(meta.symbol, "dmUSD");
        assert_eq!(meta.decimals, 6);
        assert!(token.disclaimer().contains("stand-in"));
        assert!(meta.reference.unwrap().contains("Not issued by Circle"));
    }

    #[test]
    fn mint_and_transfer() {
        let mut token = setup();
        assert_eq!(token.ft_balance_of(account("sender.testnet")).0, 50_000_000);
        testing_env!(context("sender.testnet", 1));
        token.ft_transfer(account("escrow.testnet"), U128(20_000_000), None);
        assert_eq!(token.ft_balance_of(account("sender.testnet")).0, 30_000_000);
        assert_eq!(token.ft_balance_of(account("escrow.testnet")).0, 20_000_000);
        assert_eq!(token.ft_total_supply().0, 50_000_000);
    }

    #[test]
    #[should_panic(expected = "only the owner can mint")]
    fn stranger_cannot_mint() {
        let mut token = setup();
        testing_env!(context("sender.testnet", 0));
        token.mint(account("sender.testnet"), U128(1));
    }

    #[test]
    #[should_panic(expected = "receiver is not registered")]
    fn transfer_to_unregistered_receiver_fails() {
        let mut token = setup();
        testing_env!(context("sender.testnet", 1));
        token.ft_transfer(account("founder.testnet"), U128(1), None);
    }

    #[test]
    fn resolve_refunds_the_full_amount_when_the_receiver_fails() {
        let mut token = setup();
        testing_env!(context("sender.testnet", 1));
        token.ft_transfer(account("escrow.testnet"), U128(20_000_000), None);
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("token.testnet"))
            .predecessor_account_id(account("token.testnet"))
            .prepaid_gas(Gas::from_tgas(20));
        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::new(),
            vec![PromiseResult::Failed],
        );
        let used = token.ft_resolve_transfer(
            account("sender.testnet"),
            account("escrow.testnet"),
            U128(20_000_000),
        );
        assert_eq!(used.0, 0);
        assert_eq!(token.ft_balance_of(account("sender.testnet")).0, 50_000_000);
        assert_eq!(token.ft_balance_of(account("escrow.testnet")).0, 0);
    }
}
