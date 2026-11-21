'use strict';

const TTL_MS = parseInt(process.env.BLOG_PUBLIC_CACHE_MS || '60000', 10);

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value) {
  store.set(key, { value, expires: Date.now() + TTL_MS });
}

function bustAll() {
  store.clear();
}

module.exports = { get, set, bustAll, TTL_MS };