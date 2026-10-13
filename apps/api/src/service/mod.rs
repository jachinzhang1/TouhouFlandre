//! Application use cases: validation, transaction ownership and post-commit publication.
//! No HTTP extractors/responses or dependencies on handler/router modules.
//! Deferred Result inputs preserve authentication/mode validation precedence over
//! request decoding failures. Transactions commit before realtime publication.
pub mod catalog;
pub mod chat;
pub mod health;
pub mod lifecycle;
pub mod metrics;
pub mod multi;
pub mod solo;
pub mod ws;
