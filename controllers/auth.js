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

const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

/* --------------------------- login --------------------------- */
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

    res.json({
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      localId: data.localId,
      email: data.email,
    });
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
 * tenants/{tenantId}/userTokens/{uid}/{sha256(idToken)} = {
 *   createdAt, lastSeenAt, ua, ip
 * }
 */
exports.storeToken = async (req, res) => {
  try {
    // Accept ID token from Authorization or X-Id-Token (auth middleware verifies & sets req.uid)
    const authz = req.get("authorization") || "";
    const xId   = req.get("x-id-token") || req.get("X-Id-Token") || "";
    const rawToken = authz.startsWith("Bearer ")
      ? authz.slice(7).trim()
      : xId.trim();

    if (!rawToken) {
      return res.status(400).json({ error: "Missing idToken in headers" });
    }

    // Verify to make sure it's valid and to get the uid
    const decoded = await admin.auth().verifyIdToken(rawToken, true);
    const uid = decoded.uid;
    if (!uid) return res.status(401).json({ error: "Invalid token" });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    // Hash the token before storing (we do not store raw tokens)
    const fingerprint = crypto.createHash("sha256").update(rawToken).digest("hex");

    const node = db.ref(`tenants/${tenantId}/userTokens/${uid}/${fingerprint}`);
    const now = new Date().toISOString();

    // Upsert (create or update lastSeenAt)
    await node.update({
      createdAt: admin.database.ServerValue.TIMESTAMP,
      lastSeenAt: now,
      userAgent: req.get("user-agent") || "",
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
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
