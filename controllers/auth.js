// server/controllers/auth.js
const fetch = require("node-fetch");
const crypto = require("crypto");
const { db } = require("../config/firebaseAdmin");

// Pick Firebase Web API key from envs you already support
const pickApiKey = () =>
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  process.env.REACT_APP_FIREBASE_API_KEY ||
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  "";

// Helpers
const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params?.tenantId ||
      req.get("X-Tenant-Id") ||
      req.get("x-tenant-id") ||
      ""
  ).trim();

// Hash refresh tokens so you’re not storing secrets in plaintext.
// Use a server-side pepper from env.
function hashRefreshToken(refreshToken) {
  const pepper = process.env.REFRESH_TOKEN_PEPPER || "changeme_pepper";
  return crypto
    .createHash("sha256")
    .update(`${refreshToken}:${pepper}`)
    .digest("hex");
}

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

    // ---- Persist audit + optional hashed refresh token ----
    const tenantId = getTenantId(req) || "default"; // or require a tenant header if you prefer
    const { localId, refreshToken, idToken } = data;

    const now = new Date().toISOString();
    const ua = req.get("user-agent") || "";
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "";

    // 1) Login audit (non-sensitive)
    const auditRef = db.ref(`tenants/${tenantId}/authLogins/${localId}`).push();
    await auditRef.set({
      email: data.email,
      at: now,
      ip,
      userAgent: ua,
      kind: "password",
    });

    // 2) Optional storage of a hashed refresh token (controlled by env)
    //    NEVER store the raw refresh token unencrypted.
    if (process.env.STORE_REFRESH_TOKENS === "1" && refreshToken) {
      const hashed = hashRefreshToken(refreshToken);
      await db
        .ref(`tenants/${tenantId}/refreshTokens/${localId}/${hashed}`)
        .set({
          createdAt: now,
          lastSeenAt: now,
          userAgent: ua,
          ip,
          valid: true,
        });
    }

    // You might also want to store a compact "lastLoginAt" for the user profile
    await db
      .ref(`tenants/${tenantId}/users/${localId}`)
      .update({ lastLoginAt: now, email: data.email });

    // Return the same payload as before (do NOT add hashed token to response)
    res.json({
      idToken,                 // short-lived; client stores/uses this
      refreshToken,            // client manages this; not stored in plaintext server-side
      expiresIn: data.expiresIn,
      localId: data.localId,
      email: data.email,
    });
  } catch (e) {
    console.error("auth.login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
};
