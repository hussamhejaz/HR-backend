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

const getTenantIdFromReq = (req) =>
  String(
    req.body?.tenantId ||
      req.query?.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

const refDeviceTokens = (tenantId, uid) =>
  db.ref(`tenants/${tenantId}/deviceTokens/${uid}`);

const refUserTokens = (tenantId, uid) =>
  db.ref(`tenants/${tenantId}/userTokens/${uid}`);

/* --------------------------- login --------------------------- */
/**
 * POST /api/auth/login
 * Body:
 * {
 *   email, password,
 *   // optional to auto-store for notifications:
 *   tenantId?: string,
 *   deviceToken?: string,       // FCM token
 *   platform?: "android"|"ios"|"web"|string,
 *   userAgent?: string
 * }
 *
 * Response: { idToken, refreshToken, expiresIn, localId, email }
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const apiKey = pickApiKey();
    if (!apiKey) {
      return res.status(500).json({
        error:
          "Missing Firebase Web API key. Set FIREBASE_WEB_API_KEY (or VITE_FIREBASE_API_KEY) on the server.",
      });
    }

    // 1) Sign in via Firebase REST
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

    const idToken = data.idToken;
    const refreshToken = data.refreshToken;
    const expiresIn = data.expiresIn;
    const uid = data.localId;

    // 2) (Optional) store ID-token fingerprint for audit (hashed)
    //    requires tenantId to scope under tenant
    const tenantId = getTenantIdFromReq(req);
    if (tenantId) {
      try {
        const fingerprint = crypto
          .createHash("sha256")
          .update(String(idToken))
          .digest("hex");

        await refUserTokens(tenantId, uid).child(fingerprint).update({
          createdAt: admin.database.ServerValue.TIMESTAMP,
          lastSeenAt: nowISO(),
          userAgent: req.body?.userAgent || req.get("user-agent") || "",
          ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
          kind: "login",
        });
      } catch (e) {
        console.warn("login: failed to store idToken fingerprint:", e?.message || e);
      }
    }

    // 3) (Optional) store FCM device token for push notifications immediately
    const deviceToken = String(req.body?.deviceToken || "").trim();
    if (tenantId && deviceToken) {
      try {
        const platform = String(req.body?.platform || "").trim();
        const userAgent = req.body?.userAgent || req.get("user-agent") || "";

        // dedupe same token for this uid
        const node = refDeviceTokens(tenantId, uid);
        const snap = await node.orderByChild("token").equalTo(deviceToken).once("value");

        if (snap.exists()) {
          const updates = {};
          for (const key of Object.keys(snap.val())) {
            updates[`${key}/lastSeenAt`] = nowISO();
            updates[`${key}/userAgent`] = userAgent;
            updates[`${key}/platform`] = platform;
          }
          await node.update(updates);
        } else {
          await node.push({
            token: deviceToken,
            platform,
            userAgent,
            createdAt: nowISO(),
            lastSeenAt: nowISO(),
          });
        }
      } catch (e) {
        console.warn("login: failed to store deviceToken:", e?.message || e);
      }
    }

    // 4) return auth payload
    res.json({
      idToken,
      refreshToken,
      expiresIn,
      localId: uid,
      email: data.email,
      // helpful echo (so client knows if we stored anything)
      stored: {
        tenantId: tenantId || null,
        deviceTokenStored: Boolean(tenantId && deviceToken),
        fingerprintStored: Boolean(tenantId && idToken),
      },
    });
  } catch (e) {
    console.error("auth.login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
};

/* --------- (kept) standalone store-token if you need it later --------- */
/**
 * POST /api/auth/store-token
 * Headers: Authorization: Bearer <idToken>, X-Tenant-Id: <tenantId>
 */
exports.storeToken = async (req, res) => {
  try {
    const authz = req.get("authorization") || "";
    const xId   = req.get("x-id-token") || req.get("X-Id-Token") || "";
    const rawToken = authz.startsWith("Bearer ")
      ? authz.slice(7).trim()
      : xId.trim();

    if (!rawToken) return res.status(400).json({ error: "Missing idToken in headers" });

    const decoded = await admin.auth().verifyIdToken(rawToken, true);
    const uid = decoded.uid;
    if (!uid) return res.status(401).json({ error: "Invalid token" });

    const tenantId = getTenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const fingerprint = crypto.createHash("sha256").update(rawToken).digest("hex");

    await refUserTokens(tenantId, uid).child(fingerprint).update({
      createdAt: admin.database.ServerValue.TIMESTAMP,
      lastSeenAt: nowISO(),
      userAgent: req.get("user-agent") || "",
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
      kind: "manual",
    });

    return res.json({ ok: true, uid, tenantId, fingerprint });
  } catch (e) {
    console.error("auth.storeToken error:", e);
    const code = e?.errorInfo?.code || e?.code || "";
    if (code === "auth/id-token-expired")  return res.status(401).json({ error: "Token expired" });
    if (code === "auth/id-token-revoked")  return res.status(401).json({ error: "Token revoked" });
    if (code === "auth/argument-error")    return res.status(401).json({ error: "Invalid token" });
    return res.status(500).json({ error: "Failed to store token" });
  }
};
