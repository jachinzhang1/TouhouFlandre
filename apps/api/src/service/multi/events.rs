use crate::app::AppState;
pub use crate::repository::events::append_event;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoomEffect {
    pub room_id: String,
    pub game: bool,
    pub chat: bool,
    pub forfeits: Vec<String>,
}
impl RoomEffect {
    pub fn game(room_id: &str) -> Self {
        Self {
            room_id: room_id.into(),
            game: true,
            chat: false,
            forfeits: Vec::new(),
        }
    }
    pub fn merge(&mut self, other: &Self) {
        assert!(self.room_id.is_empty() || self.room_id == other.room_id);
        if self.room_id.is_empty() {
            self.room_id = other.room_id.clone();
        }
        self.game |= other.game;
        self.chat |= other.chat;
        self.forfeits.extend(other.forfeits.iter().cloned());
    }
}
/// Call only after committing the transaction, including commits returning a domain conflict.
pub fn publish(state: &AppState, effect: &RoomEffect) {
    for reason in &effect.forfeits {
        crate::metrics::METRICS.forfeit(reason);
    }
    if effect.game {
        state.realtime.notify_game(&effect.room_id);
    }
    if effect.chat {
        state.realtime.notify_chat(&effect.room_id);
    }
}
