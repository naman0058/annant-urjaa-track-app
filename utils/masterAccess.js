// utils/masterAccess.js
// Checks if a user currently has active master access.

async function getActiveMasterAccess(req, userId) {
  if (!userId) return null;

  const now = new Date();

  // If you use mysql named params, you can pass Date object; mysql2 will handle it.
  const [rows] = await req.db.query(
    `
    SELECT
      r.id AS redemption_id,
      r.access_starts_at,
      r.access_expires_at,
      c.code,
      c.assigned_member,
      c.status
    FROM master_code_redemptions r
    JOIN master_codes c ON c.id = r.master_code_id
    WHERE r.user_id = :user_id
      AND c.status = 'active'
      AND r.access_starts_at <= :now
      AND r.access_expires_at >= :now
    ORDER BY r.access_expires_at DESC
    LIMIT 1
    `,
    { user_id: Number(userId), now }
  );

  return rows[0] || null;
}

async function userHasPremiumAccess(req, userId, trackId = null) {
  // 1) master code unlock
  const master = await getActiveMasterAccess(req, userId);
  if (master) return { ok: true, via: 'master_code', master };

  // 2) fallback to your existing subscription logic (example)
  // If your subscriptions table means "user subscribed to track_id"
  if (trackId) {
    const [subs] = await req.db.query(
      `
      SELECT id
      FROM subscriptions
      WHERE user_id = :user_id
        AND track_id = :track_id
        AND status = 'active'
      LIMIT 1
      `,
      { user_id: Number(userId), track_id: String(trackId) }
    );
    if (subs.length) return { ok: true, via: 'subscription' };
  }

  return { ok: false };
}

module.exports = {
  getActiveMasterAccess,
  userHasPremiumAccess
};
