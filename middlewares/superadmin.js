// server/middlewares/superadmin.js
const { db } = require("../config/firebaseAdmin");

/**
 * Require a user that is a global superadmin (NOT tenant-scoped).
 * Assumes req.uid and req.user are populated by your existing auth middleware.
 */
module.exports = async function requireSuperadmin(req, res, next) {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });

    // Prefer custom claim set in ID token by Firebase Admin
    const hasClaim =
      req.user?.superadmin === true || // if your auth middleware maps custom claims
      req.user?.customClaims?.superadmin === true;

    if (hasClaim) return next();

    // Fallback: check DB mirror (in case token wasn't refreshed yet)
    const snap = await db.ref(`users/${req.uid}/profile/isSuperadmin`).once("value");
    if (snap.exists() && snap.val() === true) return next();

    return res.status(403).json({ error: "Forbidden (superadmin required)" });
  } catch (e) {
    console.error("requireSuperadmin error:", e);
    return res.status(500).json({ error: "Internal error" });
  }
};
