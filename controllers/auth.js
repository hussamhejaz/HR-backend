// server/controllers/auth.js
const fetch = require("node-fetch");
const crypto = require("crypto");
const { admin, db } = require("../config/firebaseAdmin");

/* -------------------------- helpers -------------------------- */
const pickApiKey = () =>
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  process.env.REACT_APP_FIREBASE_API_KEY ||
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  "";

const nowISO = () => new Date().toISOString();

const refDeviceTokens = (tenantId, uid) =>
  db.ref(`tenants/${tenantId}/deviceTokens/${uid}`);

const refUserTokens = (tenantId, uid, fp) =>
  db.ref(`tenants/${tenantId}/userTokens/${uid}/${fp}`);

async function saveDeviceToken({ tenantId, uid, token, platform, userAgent }) {
  if (!tenantId || !uid || !token) return { saved: false, reason: "missing fields" };

  // de-dup by token value for this uid
  const node = refDeviceTokens(tenantId, uid);
  const snap = await node.orderByChild("token").equalTo(token).once("value");

  if (snap.exists()) {
    const updates = {};
    for (const k of Object.keys(snap.val())) {
      updates[`${k}/lastSeenAt`] = nowISO();
      if (platform)  updates[`${k}/platform`]  = platform;
      if (userAgent) updates[`${k}/userAgent`] = userAgent;
    }
    await node.update(updates);
    return { saved: true, updated: true };
  }

  const pushRef = await node.push({
    token,
    platform: platform || "",
    userAgent: userAgent || "",
    createdAt: nowISO(),
    lastSeenAt: nowISO(),
  });
  return { saved: true, id: pushRef.key };
}

async function saveTokenFingerprint({ tenantId, idToken, userAgent, ip, uid }) {
  if (!tenantId || !idToken || !uid) return { saved: false };
  const fp = crypto.createHash("sha256").update(idToken).digest("hex");

  await refUserTokens(tenantId, uid, fp).update({
    createdAt: admin.database.ServerValue.TIMESTAMP,
    lastSeenAt: nowISO(),
    userAgent: userAgent || "",
    ip: ip || "",
  });

  return { saved: true, fingerprint: fp };
}

/* --------------------------- login --------------------------- */
/**
 * POST /api/auth/login
 * body: {
 *   email, password,
 *   // Optional — if provided we'll store the device token immediately:
 *   tenantId?, deviceToken?, platform?, storeFingerprint? (boolean)
 * }
 */
exports.login = async (req, res) => {
  try {
    const {
      email,
      password,
      tenantId,
      deviceToken,
      platform = "",
      storeFingerprint = false,
    } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const apiKey = pickApiKey();
    if (!apiKey) {
      return res.status(500).json({
        error:
          "Missing Firebase Web API key. Set FIREBASE_WEB_API_KEY (or VITE_FIREBASE_API_KEY).",
      });
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || "Login failed";
      return res.status(401).json({ error: msg });
    }

    // basic payload back to client
    const resp = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      localId: data.localId,
      email: data.email,
      stored: { tenantId: tenantId || null, deviceTokenStored: false, fingerprintStored: false },
    };

    // If client passed tenantId & deviceToken, save device token now
    if (tenantId && deviceToken) {
      try {
        const userAgent = req.get("user-agent") || "";
        const tokRes = await saveDeviceToken({
          tenantId,
          uid: data.localId,
          token: deviceToken,
          platform,
          userAgent,
        });
        resp.stored.deviceTokenStored = !!tokRes.saved;
      } catch (e) {
        console.warn("auth.login: saveDeviceToken failed:", e?.message || e);
      }
    }

    // Optional: also store a fingerprint of the ID token for auditing
    if (storeFingerprint && tenantId) {
      try {
        const fpRes = await saveTokenFingerprint({
          tenantId,
          idToken: data.idToken,
          uid: data.localId,
          userAgent: req.get("user-agent") || "",
          ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
        });
        resp.stored.fingerprintStored = !!fpRes.saved;
        if (fpRes.fingerprint) resp.stored.fingerprint = fpRes.fingerprint;
      } catch (e) {
        console.warn("auth.login: saveTokenFingerprint failed:", e?.message || e);
      }
    }

    res.json(resp);
  } catch (e) {
    console.error("auth.login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
};

/* -------------------- store ID token fingerprint -------------------- */
/**
 * POST /api/auth/store-token
 * Headers:
 *  - Authorization: Bearer <idToken>
 *  - X-Tenant-Id: <tenantId>
 * Body: {}
 *
 * Saves a hashed fingerprint of the ID token under:
 * tenants/{tenantId}/userTokens/{uid}/{sha256(idToken)}
 */
exports.storeToken = async (req, res) => {
  try {
    const authz = req.get("authorization") || "";
    const xId   = req.get("x-id-token") || req.get("X-Id-Token") || "";
    const rawToken = authz.startsWith("Bearer ")
      ? authz.slice(7).trim()
      : xId.trim();

    if (!rawToken) {
      return res.status(400).json({ error: "Missing idToken in headers" });
    }

    const decoded = await admin.auth().verifyIdToken(rawToken, true);
    const uid = decoded.uid;
    if (!uid) return res.status(401).json({ error: "Invalid token" });

    const tenantId = String(
      req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
    ).trim();
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const fp = crypto.createHash("sha256").update(rawToken).digest("hex");

    await refUserTokens(tenantId, uid, fp).update({
      createdAt: admin.database.ServerValue.TIMESTAMP,
      lastSeenAt: nowISO(),
      userAgent: req.get("user-agent") || "",
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
    });

    return res.json({ ok: true, uid, tenantId, fingerprint: fp });
  } catch (e) {
    console.error("auth.storeToken error:", e);
    const code = e?.errorInfo?.code || e?.code || "";
    if (code === "auth/id-token-expired")  return res.status(401).json({ error: "Token expired" });
    if (code === "auth/id-token-revoked")  return res.status(401).json({ error: "Token revoked" });
    if (code === "auth/argument-error")    return res.status(401).json({ error: "Invalid token" });
    return res.status(500).json({ error: "Failed to store token" });
  }
};
