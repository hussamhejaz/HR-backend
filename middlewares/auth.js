// server/middlewares/auth.js
const { admin } = require("../config/firebaseAdmin");

/**
 * Accept credentials from:
 *  - Authorization: Bearer <idToken>
 *  - X-Id-Token: <idToken>           (useful for clients that can't set Authorization)
 *  - Cookie: session=<sessionCookie> (Firebase Session Cookie for web)
 */
module.exports = async function auth(req, res, next) {
  try {
    // Preflight
    if (req.method === "OPTIONS") return next();

    const authz = req.get("authorization") || "";
    const xId   = req.get("x-id-token") || req.get("X-Id-Token");
    const cookieSession = req.cookies?.session;

    let decoded;

    if (authz.startsWith("Bearer ")) {
      const token = authz.slice(7).trim();
      decoded = await admin.auth().verifyIdToken(token, true); // check revocation
    } else if (xId) {
      decoded = await admin.auth().verifyIdToken(xId.trim(), true);
    } else if (cookieSession) {
      decoded = await admin.auth().verifySessionCookie(cookieSession, true);
    } else {
      return res.status(401).json({ error: "Missing credentials" });
    }

    req.user  = decoded;
    req.uid   = decoded.uid;
    next();
  } catch (e) {
    const code = e?.errorInfo?.code || e?.code || "";
    if (code === "auth/id-token-expired")  return res.status(401).json({ error: "Token expired" });
    if (code === "auth/id-token-revoked")  return res.status(401).json({ error: "Token revoked" });
    if (code === "auth/argument-error")    return res.status(401).json({ error: "Invalid token" });
    console.error("auth middleware:", e);
    return res.status(401).json({ error: "Invalid or missing token" });
  }
};
