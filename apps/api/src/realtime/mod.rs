//! Protocol v3 transport primitives, independent of room/database services.
//!
//! The caller authenticates [`protocol::Hello`] before registering a connection,
//! captures database watermarks *after* registration, queues `hello-ok`, replays
//! the committed rows, and calls [`outbound::ConnectionOutput::finish_sync`].
//! Room publishers must serialize reads of committed events and project payloads
//! for each observer before using the connection's publish methods. Hidden game
//! events use [`protocol::GameCursor`]; hidden chat rows use `None` and still
//! advance the independent chat position. No room state is owned by this module.
//!
//! A socket writer owns [`outbound::OutboundReceiver`], sends frames in FIFO order,
//! and closes after `close_after`. Its independent close receiver must be polled
//! even when the data queue is full. On exit, call `mark_closed`, then remove the
//! registration by its generation; only a successful removal may mark a member
//! disconnected, and `skip_disconnect` suppresses that write on identity changes.

pub mod cursor;
pub mod outbound;
pub mod protocol;
pub mod registry;
pub mod transport;
