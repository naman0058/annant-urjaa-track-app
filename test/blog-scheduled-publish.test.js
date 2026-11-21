'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  listDueScheduledPosts,
  publishDuePost,
} = require('../services/blogScheduledPublishService');

function mockDb({ dueRows = [], publishAffected = 1 } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, title, slug, scheduled_at') && sql.includes("status = 'scheduled'")) {
        return [dueRows];
      }
      if (sql.includes("SET status = 'published'")) {
        return [{ affectedRows: publishAffected }];
      }
      return [[], undefined];
    },
  };
}

describe('blogScheduledPublishService', () => {
  it('lists due scheduled posts', async () => {
    const db = mockDb({ dueRows: [{ id: 9, title: 'T', slug: 't', scheduled_at: new Date() }] });
    const rows = await listDueScheduledPosts(db, { limit: 5 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 9);
  });

  it('publishes due post when update matches', async () => {
    const db = mockDb({ publishAffected: 1 });
    const ok = await publishDuePost(db, 9);
    assert.equal(ok, true);
  });

  it('returns false when no row updated', async () => {
    const db = mockDb({ publishAffected: 0 });
    const ok = await publishDuePost(db, 9);
    assert.equal(ok, false);
  });
});