// server/utils/notify.js
const { db, messaging } = require("../config/firebaseAdmin");

/**
 * Write an in-app notification for a user and (optionally) send FCM push.
 */
async function notify({ tenantId, toUid, type, title, body, link = "", meta = {}, push = true }) {
  if (!tenantId || !toUid) throw new Error("notify() missing tenantId or toUid");

  const ref = db.ref(`tenants/${tenantId}/userNotifications/${toUid}`).push();
  const payload = {
    type, title, body, link, meta,
    createdAt: Date.now(),
    read: false,
  };
  await ref.set(payload);

  // Try push (if FCM is initialized and user has tokens)
  if (push && messaging) {
    try {
      const tokSnap = await db.ref(`tenants/${tenantId}/users/${toUid}/fcmTokens`).once("value");
      const tokens = Object.keys(tokSnap.val() || {});
      if (tokens.length) {
        await messaging.sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: {
            type,
            link,
            tenantId: String(tenantId),
            ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
          },
        });
      }
    } catch (e) {
      console.warn("notify(): push failed:", e?.message);
    }
  }

  return { id: ref.key, ...payload };
}

module.exports = { notify };
