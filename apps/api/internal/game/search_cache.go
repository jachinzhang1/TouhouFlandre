package game

import (
	"container/list"
	"context"
	"sync"
)

// sharedLRU coalesces concurrent loads for the same key and only retains
// successful values. A canceled waiter does not cancel the shared load.
type sharedLRU[K comparable, V any] struct {
	mu       sync.Mutex
	capacity int
	entries  map[K]*list.Element
	order    *list.List
	inflight map[K]*sharedLoad[V]
}

type lruEntry[K comparable, V any] struct {
	key   K
	value V
}

type sharedLoad[V any] struct {
	done  chan struct{}
	value V
	err   error
}

func newSharedLRU[K comparable, V any](capacity int) *sharedLRU[K, V] {
	if capacity < 1 {
		capacity = 1
	}
	return &sharedLRU[K, V]{
		capacity: capacity,
		entries:  make(map[K]*list.Element, capacity),
		order:    list.New(),
		inflight: make(map[K]*sharedLoad[V]),
	}
}

func (c *sharedLRU[K, V]) get(ctx context.Context, key K, loader func(context.Context) (V, error)) (V, error) {
	c.mu.Lock()
	if element, ok := c.entries[key]; ok {
		c.order.MoveToFront(element)
		value := element.Value.(lruEntry[K, V]).value
		c.mu.Unlock()
		return value, nil
	}
	if loading, ok := c.inflight[key]; ok {
		c.mu.Unlock()
		select {
		case <-loading.done:
			return loading.value, loading.err
		case <-ctx.Done():
			var zero V
			return zero, ctx.Err()
		}
	}
	loading := &sharedLoad[V]{done: make(chan struct{})}
	c.inflight[key] = loading
	c.mu.Unlock()

	value, err := loader(ctx)
	c.mu.Lock()
	loading.value = value
	loading.err = err
	delete(c.inflight, key)
	if err == nil {
		if existing, ok := c.entries[key]; ok {
			existing.Value = lruEntry[K, V]{key: key, value: value}
			c.order.MoveToFront(existing)
		} else {
			c.entries[key] = c.order.PushFront(lruEntry[K, V]{key: key, value: value})
		}
		for c.order.Len() > c.capacity {
			oldest := c.order.Back()
			if oldest == nil {
				break
			}
			entry := oldest.Value.(lruEntry[K, V])
			delete(c.entries, entry.key)
			c.order.Remove(oldest)
		}
	}
	close(loading.done)
	c.mu.Unlock()
	return value, err
}

func (c *sharedLRU[K, V]) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}

func (c *sharedLRU[K, V]) contains(key K) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.entries[key]
	return ok
}
