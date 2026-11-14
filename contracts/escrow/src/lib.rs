//! Pay-to-DM escrow.
//!
//! A sender locks dmUSD by calling the token's `ft_transfer_call`. The fee stays
//! here until the founder replies (released to the founder) or the timeout
//! passes with no reply (refunded to the sender). Anyone can call `refund`
//! after the deadline, so a relayer can do it without the sender paying gas.
//!
//! Identify the user with `predecessor_account_id`. A meta-transaction's signer
//! is the relayer, and the predecessor of the inner call is the sender.

use near_sdk::json_types::{U64, U128};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};

const NS_PER_SECOND: u64 = 1_000_000_000;
const MIN_TIMEOUT_SECONDS: u64 = 60;
const MAX_TIMEOUT_SECONDS: u64 = 30 * 24 * 60 * 60;
const MIN_AMOUNT: u128 = 1_000_000;
const MAX_MESSAGE_CHARS: usize = 500;
const MAX_REPLY_CHARS: usize = 1000;
const MAX_HANDLE_CHARS: usize = 32;
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(20);

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum Status {
    Open,
    Settling,
    Released,
    Refunded,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh])]
enum Pending {
    None,
    Release,
    Refund,
}

#[derive(Clone)]
#[near(serializers = [borsh])]
struct Thread {
    id: u64,
    sender: AccountId,
    founder: AccountId,
    handle: String,
    amount: u128,
    message: String,
    reply: Option<String>,
    opened_at_ns: u64,
    timeout_ns: u64,
    status: Status,
    pending: Pending,
    resolved_at_ns: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct ThreadView {
    pub id: u64,
    pub sender: AccountId,
    pub founder: AccountId,
    pub handle: String,
    pub amount: U128,
    pub message: String,
    pub reply: Option<String>,
    pub opened_at_ns: U64,
    pub timeout_ns: U64,
    pub deadline_ns: U64,
    pub status: Status,
    pub resolved_at_ns: Option<U64>,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Config {
    pub token: AccountId,
    pub owner_id: AccountId,
    pub default_timeout_seconds: U64,
    pub min_timeout_seconds: U64,
    pub max_timeout_seconds: U64,
    pub min_amount: U128,
    pub next_id: u64,
}

#[near(serializers = [borsh, json])]
struct OpenRequest {
    founder: AccountId,
    message: String,
    handle: Option<String>,
    timeout_seconds: Option<u64>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    token: AccountId,
    owner: AccountId,
    default_timeout_ns: u64,
    next_id: u64,
    threads: IterableMap<u64, Thread>,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(token: AccountId, owner_id: AccountId, default_timeout_seconds: u64) -> Self {
        require!(token != owner_id, "token and owner must differ");
        Self {
            token,
            owner: owner_id,
            default_timeout_ns: seconds_to_ns(default_timeout_seconds),
            next_id: 1,
            threads: IterableMap::new(b"t"),
        }
    }

    pub fn set_default_timeout_seconds(&mut self, seconds: u64) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner can set the default timeout"
        );
        self.default_timeout_ns = seconds_to_ns(seconds);
    }

    pub fn get_config(&self) -> Config {
        Config {
            token: self.token.clone(),
            owner_id: self.owner.clone(),
            default_timeout_seconds: U64(self.default_timeout_ns / NS_PER_SECOND),
            min_timeout_seconds: U64(MIN_TIMEOUT_SECONDS),
            max_timeout_seconds: U64(MAX_TIMEOUT_SECONDS),
            min_amount: U128(MIN_AMOUNT),
            next_id: self.next_id,
        }
    }

    pub fn get_thread(&self, thread_id: u64) -> Option<ThreadView> {
        self.threads.get(&thread_id).map(view)
    }

    pub fn list_threads(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<ThreadView> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(20).min(50) as usize;
        let mut all: Vec<ThreadView> = self.threads.iter().map(|(_, thread)| view(thread)).collect();
        all.reverse();
        all.into_iter().skip(from).take(limit).collect()
    }

    /// Called by the dmUSD contract. Keeps the full amount (returns 0 unused).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        require!(
            env::predecessor_account_id() == self.token,
            "only the dmUSD contract can open a thread"
        );
        require!(msg.len() <= 2_000, "message payload is too large");
        let request: OpenRequest =
            near_sdk::serde_json::from_str(&msg).expect("msg must be JSON: founder, message, timeout_seconds");
        let amount = amount.0;
        require!(amount >= MIN_AMOUNT, "amount is below 1 dmUSD");
        require!(sender_id != request.founder, "you cannot pay yourself");
        require!(request.founder != self.token, "founder cannot be the token contract");
        let message = request.message.trim().to_string();
        require!(!message.is_empty(), "message is empty");
        require!(
            message.chars().count() <= MAX_MESSAGE_CHARS,
            "message is longer than 500 characters"
        );
        let handle = normalize_handle(request.handle, &request.founder);
        let timeout_ns = match request.timeout_seconds {
            Some(seconds) => seconds_to_ns(seconds),
            None => self.default_timeout_ns,
        };
        let id = self.next_id;
        self.next_id += 1;
        let opened_at_ns = env::block_timestamp();
        let thread = Thread {
            id,
            sender: sender_id.clone(),
            founder: request.founder.clone(),
            handle: handle.clone(),
            amount,
            message: message.clone(),
            reply: None,
            opened_at_ns,
            timeout_ns,
            status: Status::Open,
            pending: Pending::None,
            resolved_at_ns: None,
        };
        self.threads.insert(id, thread);
        env::log_str(&format!("receipts:thread={id}"));
        emit(
            "thread_opened",
            &near_sdk::serde_json::json!({
                "id": id,
                "sender": sender_id,
                "founder": request.founder,
                "handle": handle,
                "amount": amount.to_string(),
                "timeout_ns": timeout_ns.to_string(),
            }),
        );
        U128(0)
    }

    /// Founder reply. Pays the locked fee to the founder.
    pub fn reply(&mut self, thread_id: u64, text: String) -> Promise {
        let founder = env::predecessor_account_id();
        let text = text.trim().to_string();
        require!(!text.is_empty(), "reply is empty");
        require!(
            text.chars().count() <= MAX_REPLY_CHARS,
            "reply is longer than 1000 characters"
        );
        let mut thread = self
            .threads
            .get(&thread_id)
            .cloned()
            .expect("thread not found");
        require!(thread.founder == founder, "only the founder can reply");
        require!(thread.status == Status::Open, "thread is not open");
        thread.reply = Some(text);
        thread.status = Status::Settling;
        thread.pending = Pending::Release;
        let amount = thread.amount;
        let receiver = thread.founder.clone();
        self.threads.insert(thread_id, thread);
        self.settle(thread_id, receiver, amount, "release")
    }

    /// Permissionless refund once the timeout has passed and nobody has replied.
    pub fn refund(&mut self, thread_id: u64) -> Promise {
        let mut thread = self
            .threads
            .get(&thread_id)
            .cloned()
            .expect("thread not found");
        require!(thread.status == Status::Open, "thread is not open");
        let now = env::block_timestamp();
        let deadline = thread.opened_at_ns.saturating_add(thread.timeout_ns);
        require!(
            now >= deadline,
            "timeout has not passed; the founder can still reply"
        );
        thread.status = Status::Settling;
        thread.pending = Pending::Refund;
        let amount = thread.amount;
        let receiver = thread.sender.clone();
        self.threads.insert(thread_id, thread);
        self.settle(thread_id, receiver, amount, "refund")
    }

    #[private]
    pub fn on_settled(&mut self, thread_id: u64, action: String) {
        let Some(mut thread) = self.threads.get(&thread_id).cloned() else {
            return;
        };
        if thread.status != Status::Settling {
            return;
        }
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if ok {
            thread.status = if action == "release" {
                Status::Released
            } else {
                Status::Refunded
            };
            thread.resolved_at_ns = Some(env::block_timestamp());
            thread.pending = Pending::None;
            emit(
                if action == "release" { "thread_released" } else { "thread_refunded" },
                &near_sdk::serde_json::json!({
                    "id": thread_id,
                    "amount": thread.amount.to_string(),
                    "sender": thread.sender,
                    "founder": thread.founder,
                }),
            );
        } else {
            thread.status = Status::Open;
            thread.pending = Pending::None;
            if action == "release" {
                thread.reply = None;
            }
            env::log_str(&format!("receipts:settle-failed:{thread_id}"));
        }
        self.threads.insert(thread_id, thread);
    }

    fn settle(&self, thread_id: u64, receiver: AccountId, amount: u128, action: &str) -> Promise {
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(receiver, U128(amount), Some(format!("receipts:{action}:{thread_id}")))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_settled(thread_id, action.to_string()),
            )
    }
}

fn view(thread: &Thread) -> ThreadView {
    ThreadView {
        id: thread.id,
        sender: thread.sender.clone(),
        founder: thread.founder.clone(),
        handle: thread.handle.clone(),
        amount: U128(thread.amount),
        message: thread.message.clone(),
        reply: thread.reply.clone(),
        opened_at_ns: U64(thread.opened_at_ns),
        timeout_ns: U64(thread.timeout_ns),
        deadline_ns: U64(thread.opened_at_ns.saturating_add(thread.timeout_ns)),
        status: thread.status.clone(),
        resolved_at_ns: thread.resolved_at_ns.map(U64),
    }
}

fn seconds_to_ns(seconds: u64) -> u64 {
    require!(
        (MIN_TIMEOUT_SECONDS..=MAX_TIMEOUT_SECONDS).contains(&seconds),
        "timeout must be between 60 seconds and 30 days"
    );
    seconds
        .checked_mul(NS_PER_SECOND)
        .expect("timeout overflow")
}

fn normalize_handle(handle: Option<String>, founder: &AccountId) -> String {
    let raw = handle.unwrap_or_default();
    let handle = raw.trim().to_ascii_lowercase();
    if handle.is_empty() {
        return founder.to_string();
    }
    require!(
        handle.chars().count() <= MAX_HANDLE_CHARS,
        "handle is too long"
    );
    require!(
        handle
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
        "handle must be lowercase letters, digits, or hyphens"
    );
    handle
}

fn emit(event: &str, data: &near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "receipts",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_ft)]
trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_self)]
trait ExtSelf {
    fn on_settled(&mut self, thread_id: u64, action: String);
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, Gas, VMContext};

    fn id(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn context(predecessor: &str, timestamp: u64) -> VMContext {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(id("escrow.testnet"))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id("relayer.testnet"))
            .block_timestamp(timestamp)
            .prepaid_gas(Gas::from_tgas(100))
            .attached_deposit(NearToken::from_yoctonear(0));
        builder.build()
    }

    fn setup_at(timestamp: u64) -> Escrow {
        testing_env!(context("owner.testnet", timestamp));
        Escrow::new(id("token.testnet"), id("owner.testnet"), 72 * 60 * 60)
    }

    fn open(escrow: &mut Escrow, sender: &str, timeout_seconds: u64, timestamp: u64) -> u64 {
        testing_env!(context("token.testnet", timestamp));
        let msg = format!(
            r#"{{"founder":"founder.testnet","handle":"nico-feld","message":"Do you still sell the gasket kit?","timeout_seconds":{timeout_seconds}}}"#
        );
        let unused = escrow.ft_on_transfer(id(sender), U128(5_000_000), msg);
        assert_eq!(unused.0, 0);
        escrow.next_id - 1
    }

    #[test]
    fn opening_a_thread_keeps_the_tokens_and_uses_the_requested_timeout() {
        let mut escrow = setup_at(1_000);
        let thread_id = open(&mut escrow, "sender.testnet", 120, 1_000);
        let thread = escrow.get_thread(thread_id).unwrap();
        assert_eq!(thread.status, Status::Open);
        assert_eq!(thread.amount.0, 5_000_000);
        assert_eq!(thread.timeout_ns.0, 120 * NS_PER_SECOND);
        assert_eq!(thread.deadline_ns.0, 1_000 + 120 * NS_PER_SECOND);
        assert_eq!(thread.handle, "nico-feld");
        assert_eq!(thread.sender, id("sender.testnet"));
    }

    #[test]
    #[should_panic(expected = "only the dmUSD contract can open a thread")]
    fn a_direct_call_cannot_open_a_thread() {
        let mut escrow = setup_at(0);
        testing_env!(context("sender.testnet", 0));
        escrow.ft_on_transfer(
            id("sender.testnet"),
            U128(5_000_000),
            r#"{"founder":"founder.testnet","message":"hello"}"#.to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "only the founder can reply")]
    fn a_stranger_cannot_reply() {
        let mut escrow = setup_at(0);
        let thread_id = open(&mut escrow, "sender.testnet", 120, 0);
        testing_env!(context("sender.testnet", 10));
        let _ = escrow.reply(thread_id, "I will take this".to_string());
    }

    #[test]
    fn founder_reply_locks_the_thread_as_settling() {
        let mut escrow = setup_at(0);
        let thread_id = open(&mut escrow, "sender.testnet", 3_600, 0);
        testing_env!(context("founder.testnet", 50));
        let _ = escrow.reply(thread_id, "Yes, for routes under 400kg.".to_string());
        let thread = escrow.get_thread(thread_id).unwrap();
        assert_eq!(thread.status, Status::Settling);
        assert_eq!(thread.reply.unwrap(), "Yes, for routes under 400kg.");
    }

    #[test]
    #[should_panic(expected = "timeout has not passed")]
    fn refund_before_the_deadline_fails() {
        let mut escrow = setup_at(0);
        let thread_id = open(&mut escrow, "sender.testnet", 120, 0);
        testing_env!(context("relayer.testnet", 50));
        let _ = escrow.refund(thread_id);
    }

    #[test]
    fn refund_after_the_deadline_locks_the_thread() {
        let mut escrow = setup_at(0);
        let thread_id = open(&mut escrow, "sender.testnet", 120, 0);
        testing_env!(context("relayer.testnet", 120 * NS_PER_SECOND));
        let _ = escrow.refund(thread_id);
        assert_eq!(escrow.get_thread(thread_id).unwrap().status, Status::Settling);
    }

    #[test]
    fn successful_callback_releases_and_failed_callback_reopens() {
        let mut escrow = setup_at(0);
        let thread_id = open(&mut escrow, "sender.testnet", 120, 0);
        testing_env!(context("founder.testnet", 10));
        let _ = escrow.reply(thread_id, "Yes.".to_string());

        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(id("escrow.testnet"))
            .predecessor_account_id(id("escrow.testnet"))
            .block_timestamp(20)
            .prepaid_gas(Gas::from_tgas(20));
        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::new(),
            vec![PromiseResult::Successful(Vec::new())],
        );
        escrow.on_settled(thread_id, "release".to_string());
        let released = escrow.get_thread(thread_id).unwrap();
        assert_eq!(released.status, Status::Released);
        assert_eq!(released.resolved_at_ns.unwrap().0, 20);

        let refund_id = open(&mut escrow, "sender.testnet", 60, 0);
        testing_env!(context("relayer.testnet", 60 * NS_PER_SECOND));
        let _ = escrow.refund(refund_id);
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(id("escrow.testnet"))
            .predecessor_account_id(id("escrow.testnet"))
            .block_timestamp(60 * NS_PER_SECOND)
            .prepaid_gas(Gas::from_tgas(20));
        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::new(),
            vec![PromiseResult::Failed],
        );
        escrow.on_settled(refund_id, "refund".to_string());
        let reopened = escrow.get_thread(refund_id).unwrap();
        assert_eq!(reopened.status, Status::Open);
        assert!(reopened.reply.is_none());
    }

    #[test]
    fn owner_can_change_the_default_timeout() {
        let mut escrow = setup_at(0);
        testing_env!(context("owner.testnet", 0));
        escrow.set_default_timeout_seconds(180);
        assert_eq!(escrow.get_config().default_timeout_seconds.0, 180);
    }

    #[test]
    #[should_panic(expected = "timeout must be between 60 seconds and 30 days")]
    fn a_thirty_second_timeout_is_rejected() {
        let mut escrow = setup_at(0);
        testing_env!(context("token.testnet", 0));
        escrow.ft_on_transfer(
            id("sender.testnet"),
            U128(5_000_000),
            r#"{"founder":"founder.testnet","message":"too fast","timeout_seconds":30}"#.to_string(),
        );
    }
}
