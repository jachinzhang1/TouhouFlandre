//! Character guessing rules without persistence, multiplayer, or presentation.
//!
//! [`Catalog`] owns a snapshot of the facts used for comparison. Call
//! [`Catalog::evaluate_guess`] when another state machine controls the game, or
//! [`Catalog::apply_guess`] to advance a simple [`AttemptState`].
//!
//! The caller supplies the answer, attempt history, and comparison rules. It
//! also owns authorization, timeouts, transactions, and rendering the result.
//!
//! ```
//! use touhouflandre_core::{AnswerMatchPolicy, AttemptState, Catalog, Character};
//!
//! let facts = [Character {
//!     id: "answer".into(),
//!     enabled_as_guess: true,
//!     ..Default::default()
//! }];
//! let catalog = Catalog::new(AnswerMatchPolicy::Strict, &facts)?;
//! let state = AttemptState { limit: Some(6), ..Default::default() };
//! let outcome = catalog.apply_guess(&state, "answer", "answer", None)?;
//! assert!(outcome.guess.is_correct);
//! assert!(outcome.state.closed);
//! assert_eq!(state.used, 0);
//! # Ok::<(), touhouflandre_core::Error>(())
//! ```

mod attempt;
mod catalog;
mod error;
mod fields;
mod types;

pub use attempt::{AttemptOutcome, AttemptState, consume_attempt};
pub use catalog::Catalog;
pub use error::Error;
pub use fields::{canonical_field_value, compare_feedback, default_fields, equivalent_characters};
pub use types::*;
