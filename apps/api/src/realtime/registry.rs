//! Generation-aware single connection per member. Old connection cleanup cannot
//! remove its replacement. Database disconnect writes remain the caller's job.

use super::{outbound::ConnectionOutput, protocol::ReplacementReason};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

type Key = (String, String);

#[derive(Clone)]
pub struct Registration {
    pub room_id: String,
    pub member_id: String,
    pub generation: u64,
    pub output: Arc<ConnectionOutput>,
}

#[derive(Default)]
pub struct ConnectionRegistry {
    next_generation: AtomicU64,
    members: Mutex<HashMap<Key, Registration>>,
}

impl ConnectionRegistry {
    pub fn register(
        &self,
        room_id: String,
        member_id: String,
        output: Arc<ConnectionOutput>,
    ) -> Registration {
        let registration = Registration {
            room_id,
            member_id,
            output,
            generation: self.next_generation.fetch_add(1, Ordering::Relaxed),
        };
        let old = self
            .members
            .lock()
            .expect("connection registry poisoned")
            .insert(
                (registration.room_id.clone(), registration.member_id.clone()),
                registration.clone(),
            );
        if let Some(old) = old {
            old.output.replace(ReplacementReason::Replaced);
        }
        registration
    }

    /// True only if this generation was current. Combine with skip_disconnect
    /// before any database mutation; a superseded registration returns false.
    pub fn unregister(&self, registration: &Registration) -> bool {
        let mut members = self.members.lock().expect("connection registry poisoned");
        let key = (registration.room_id.clone(), registration.member_id.clone());
        if members
            .get(&key)
            .is_some_and(|current| current.generation == registration.generation)
        {
            members.remove(&key);
            true
        } else {
            false
        }
    }

    pub fn current(&self, room_id: &str, member_id: &str) -> Option<Registration> {
        self.members
            .lock()
            .expect("connection registry poisoned")
            .get(&(room_id.to_owned(), member_id.to_owned()))
            .cloned()
    }

    /// Snapshot without retaining the registry lock during projection or I/O.
    pub fn room_connections(&self, room_id: &str) -> Vec<Registration> {
        self.members
            .lock()
            .expect("connection registry poisoned")
            .values()
            .filter(|connection| connection.room_id == room_id)
            .cloned()
            .collect()
    }

    pub fn invalidate_member(&self, room_id: &str, member_id: &str) {
        if let Some(current) = self.current(room_id, member_id) {
            current.output.replace(ReplacementReason::MemberChanged);
        }
    }

    pub fn close_all_for_restart(&self) {
        let connections: Vec<_> = self
            .members
            .lock()
            .expect("connection registry poisoned")
            .values()
            .cloned()
            .collect();
        for connection in connections {
            connection.output.service_restart();
        }
    }
}
