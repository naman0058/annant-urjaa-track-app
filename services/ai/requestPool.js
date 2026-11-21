'use strict';

const { blogAiConfig } = require('../../config/blogAiConfig');

class RequestPool {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      const task = async () => {
        this.active++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this.active--;
          this._dequeue();
        }
      };
      if (this.active < this.max) task();
      else this.queue.push(task);
    });
  }

  _dequeue() {
    if (!this.queue.length || this.active >= this.max) return;
    const next = this.queue.shift();
    next();
  }
}

const globalPool = new RequestPool(blogAiConfig.maxConcurrent);

async function withRetries(fn, { maxRetries = blogAiConfig.maxRetries } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.status === 429 ||
        (err.status >= 500 && err.status < 600);
      if (!retryable || attempt >= maxRetries) throw err;
      const base = Math.min(8000, 500 * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, base + jitter));
      attempt++;
    }
  }
  throw lastErr;
}

module.exports = { RequestPool, globalPool, withRetries };