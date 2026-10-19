use super::GameError;
use futures_util::FutureExt;
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::hash::Hash;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

type LoadResult<V> = Result<Arc<V>, GameError>;
type Pending<V> = watch::Receiver<Option<LoadResult<V>>>;
struct CacheState<K, V> {
    values: HashMap<K, Arc<V>>,
    order: VecDeque<K>,
    loading: HashMap<K, Pending<V>>,
}
/// A small shared LRU for immutable catalog artifacts. Loads are coalesced by
/// key and detached from individual callers so cancelling one waiter cannot
/// strand the other waiters or cancel the shared load. Failed loads are retried.
pub struct SharedLru<K, V> {
    capacity: usize,
    state: Mutex<CacheState<K, V>>,
}
impl<K, V> SharedLru<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Send + Sync + 'static,
{
    pub fn new(capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            capacity: capacity.max(1),
            state: Mutex::new(CacheState {
                values: HashMap::new(),
                order: VecDeque::new(),
                loading: HashMap::new(),
            }),
        })
    }
    pub fn len(&self) -> usize {
        self.state
            .lock()
            .expect("cache mutex poisoned")
            .values
            .len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn contains(&self, key: &K) -> bool {
        self.state
            .lock()
            .expect("cache mutex poisoned")
            .values
            .contains_key(key)
    }
    pub async fn get<F, Fut>(self: &Arc<Self>, key: K, loader: F) -> LoadResult<V>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<V, GameError>> + Send + 'static,
    {
        let (mut pending, sender) = {
            let mut state = self.state.lock().expect("cache mutex poisoned");
            if let Some(value) = state.values.get(&key).cloned() {
                state.order.retain(|k| k != &key);
                state.order.push_front(key);
                return Ok(value);
            }
            if let Some(pending) = state.loading.get(&key) {
                (pending.clone(), None)
            } else {
                let (sender, receiver) = watch::channel(None);
                state.loading.insert(key.clone(), receiver.clone());
                (receiver, Some(sender))
            }
        };
        if let Some(sender) = sender {
            let cache = Arc::clone(self);
            tokio::spawn(async move {
                let result = AssertUnwindSafe(async move { loader().await })
                    .catch_unwind()
                    .await
                    .map_err(|_| GameError::LoaderPanicked)
                    .and_then(|v| v)
                    .map(Arc::new);
                {
                    let mut state = cache.state.lock().expect("cache mutex poisoned");
                    if let Ok(value) = &result {
                        state.values.insert(key.clone(), Arc::clone(value));
                        state.order.retain(|k| k != &key);
                        state.order.push_front(key.clone());
                        while state.order.len() > cache.capacity {
                            if let Some(oldest) = state.order.pop_back() {
                                state.values.remove(&oldest);
                            }
                        }
                    }
                    // Publish while holding the same lock as removal; a fresh
                    // caller may retry errors, while existing callers see the
                    // exact completed result of the load they joined.
                    sender.send_replace(Some(result));
                    state.loading.remove(&key);
                }
            });
        }
        loop {
            if let Some(result) = pending.borrow_and_update().clone() {
                return result;
            }
            if pending.changed().await.is_err() {
                return Err(GameError::LoaderStopped);
            }
        }
    }
}
