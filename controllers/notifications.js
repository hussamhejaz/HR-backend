// server/controllers/notifications.js
const { admin, db } = require("../config/firebaseAdmin");

/* ----------------------------- helpers & refs ----------------------------- */
const nowISO = () => new Date().toISOString();
const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

const refTokens    = (tenantId) => db.ref(`tenants/${tenantId}/deviceTokens`);       // /{uid}/{tokenId} -> {token, platform, ...}
const refUserNoti  = (tenantId) => db.ref(`tenants/${tenantId}/userNotifications`);  // /{uid}/{notifId} -> {title, body, ...}
const refEmployees = (tenantId) => db.ref(`tenants/${tenantId}/employees`);

async function findEmployeeById(tenantId, employeeId) {
  const snap = await refEmployees(tenantId).child(employeeId).once("value");
  if (!snap.exists()) return null;
  return { id: snap.key, ...snap.val() };
}

/* ----------------------------- token endpoints ---------------------------- */
// POST /api/notifications/tokens  { token, platform?, userAgent? }
exports.registerToken = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { token, platform = "", userAgent = req.get("user-agent") || "" } = req.body || {};
    if (!token) return res.status(400).json({ error: "token is required" });

    // avoid duplicates for same uid+token
    const node = refTokens(tenantId).child(req.uid);
    const snap = await node
      .orderByChild("token")
      .equalTo(token)
      .once("value");

    if (snap.exists()) {
      // update lastSeen
      const updates = {};
      Object.keys(snap.val()).forEach((k) => {
        updates[`${k}/lastSeenAt`] = nowISO();
        updates[`${k}/userAgent`]  = userAgent;
        updates[`${k}/platform`]   = platform;
      });
      await node.update(updates);
      return res.json({ ok: true, updated: true });
    }

    const ref = await node.push({
      token,
      platform,
      userAgent,
      createdAt: nowISO(),
      lastSeenAt: nowISO(),
    });

    return res.status(201).json({ ok: true, id: ref.key });
  } catch (e) {
    console.error("notifications.registerToken", e);
    return res.status(500).json({ error: "Failed to register token" });
  }
};

// GET /api/notifications/tokens/mine
exports.listMyTokens = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refTokens(tenantId).child(req.uid).once("value");
    const list = Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v }));
    res.json(list);
  } catch (e) {
    console.error("notifications.listMyTokens", e);
    res.status(500).json({ error: "Failed to list tokens" });
  }
};

// DELETE /api/notifications/tokens/:id  (or body.token)
exports.deleteToken = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { id } = req.params;
    const { token } = req.body || {};

    const node = refTokens(tenantId).child(req.uid);

    if (id) {
      await node.child(id).remove();
      return res.status(204).end();
    }

    if (token) {
      const snap = await node.orderByChild("token").equalTo(token).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      const updates = {};
      for (const k of Object.keys(snap.val())) updates[k] = null;
      await node.update(updates);
      return res.status(204).end();
    }

    return res.status(400).json({ error: "Provide :id param or body.token" });
  } catch (e) {
    console.error("notifications.deleteToken", e);
    res.status(500).json({ error: "Failed to delete token" });
  }
};

/* ------------------------------ send helpers ------------------------------ */
async function sendFCMMulticast(targetTokens, { title, body, data = {} }) {
  if (!Array.isArray(targetTokens) || targetTokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  // Ensure data payload values are strings
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const message = {
    notification: { title, body },
    data: stringData,
    android: { priority: "high" },
    apns: { payload: { aps: { sound: "default" } } },
    tokens: targetTokens,
  };

  const messaging = admin.messaging();

  let batchResp;
  if (typeof messaging.sendMulticast === "function") {
    // Older Admin SDKs
    batchResp = await messaging.sendMulticast(message);
  } else if (typeof messaging.sendEachForMulticast === "function") {
    // v11+ Admin SDK
    batchResp = await messaging.sendEachForMulticast(message);
  } else {
    // Fallback: emulate multicast with sendAll
    const msgs = targetTokens.map((t) => ({ ...message, token: t, tokens: undefined }));
    batchResp = await messaging.sendAll(msgs);
  }

  return batchResp;
}

async function getTokensForUid(tenantId, uid) {
  const snap = await refTokens(tenantId).child(uid).once("value");
  const vals = Object.values(snap.val() || {});
  return vals.map((x) => x.token).filter(Boolean);
}

async function cleanupInvalidTokens(tenantId, uid, failedTokens) {
  if (!failedTokens.length || !uid) return;
  const node = refTokens(tenantId).child(uid);
  const snap = await node.once("value");
  const val = snap.val() || {};
  const byToken = new Set(failedTokens);
  const updates = {};
  Object.entries(val).forEach(([id, row]) => {
    if (byToken.has(row.token)) updates[id] = null;
  });
  if (Object.keys(updates).length) await node.update(updates);
}

/* --------------------------------- send API -------------------------------- */
// POST /api/notifications/send
// body: { uid?, employeeId?, token?, tokens?, title, body, data? }
exports.send = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { uid, employeeId, token, tokens, title, body, data = {} } = req.body || {};
    if ((!uid && !employeeId && !token && !tokens) || !title || !body) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let targetTokens = [];
    let cleanupUid = null;

    if (Array.isArray(tokens) && tokens.length) {
      targetTokens = tokens.slice();
    } else if (token) {
      targetTokens = [token];
    } else if (uid) {
      targetTokens = await getTokensForUid(tenantId, uid);
      cleanupUid = uid;
    } else if (employeeId) {
      const emp = await findEmployeeById(tenantId, employeeId);
      if (emp?.uid) {
        targetTokens = await getTokensForUid(tenantId, emp.uid);
        cleanupUid = emp.uid;
      }
    }

    if (!targetTokens.length) {
      return res.status(404).json({ error: "No device tokens registered for user" });
    }

    const resp = await sendFCMMulticast(targetTokens, { title, body, data });

    // Gather failed tokens
    const failedTokens = [];
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        failedTokens.push(targetTokens[idx]);
      }
    });

    // Clean up invalid tokens for this user
    if (failedTokens.length && cleanupUid) {
      await cleanupInvalidTokens(tenantId, cleanupUid, failedTokens);
    }

    // Optional: also append to user's in-app inbox (if we know the uid)
    const inboxUid =
      uid ||
      (employeeId ? (await findEmployeeById(tenantId, employeeId))?.uid : null);

    if (inboxUid) {
      await refUserNoti(tenantId).child(inboxUid).push({
        title,
        body,
        data,
        createdAt: nowISO(),
        read: false,
      });
    }

    return res.json({
      successCount: resp.successCount || 0,
      failureCount: resp.failureCount || 0,
      failures: resp.responses
        ? resp.responses
            .map((r, i) => (!r.success ? { token: targetTokens[i], error: r.error?.message || "Unknown" } : null))
            .filter(Boolean)
        : [],
    });
  } catch (e) {
    console.error("notifications.send", e);
    return res.status(500).json({ error: "Failed to send notification" });
  }
};

// POST /api/notifications/test  (send to current user's devices)
exports.sendTestToMe = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const tokens = await getTokensForUid(tenantId, req.uid);
    if (!tokens.length) return res.status(404).json({ error: "No device tokens" });

    const title = req.body?.title || "Test notification";
    const body  = req.body?.body  || "This is a test push from the server.";
    const data  = req.body?.data  || { type: "test" };

    const resp = await sendFCMMulticast(tokens, { title, body, data });

    // Clean invalid
    const failed = [];
    resp.responses.forEach((r, idx) => { if (!r.success) failed.push(tokens[idx]); });
    if (failed.length) await cleanupInvalidTokens(tenantId, req.uid, failed);

    await refUserNoti(tenantId).child(req.uid).push({
      title, body, data, createdAt: nowISO(), read: false,
    });

    return res.json({
      successCount: resp.successCount || 0,
      failureCount: resp.failureCount || 0,
    });
  } catch (e) {
    console.error("notifications.sendTestToMe", e);
    res.status(500).json({ error: "Failed to send test notification" });
  }
};
