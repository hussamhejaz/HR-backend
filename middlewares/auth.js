// server/middlewares/auth.js
const { admin } = require("../config/firebaseAdmin");

module.exports = async function auth(req, res, next) {
  // Let CORS preflight through
  if (req.method === "OPTIONS") return next();

  const hdr = req.headers.authorization || "";
  const m = hdr.match(/^(?:Bearer)\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing bearer token" });

  const token = m[1];

  try {
    // Pass 'true' to also check revocation; remove if you don't need it.
    const decoded = await admin.auth().verifyIdToken(token, true);
    req.user = decoded;
    req.uid = decoded.uid;
    req.token = token;
    next();
  } catch (e) {
    const code = e?.errorInfo?.code || e?.code || "";
    if (code === "auth/id-token-expired") {
      return res.status(401).json({ error: "Token expired" });
    }
    if (code === "auth/id-token-revoked") {
      return res.status(401).json({ error: "Token revoked" });
    }
    console.error("auth middleware:", e);
    return res.status(401).json({ error: "Invalid token" });
  }
};
