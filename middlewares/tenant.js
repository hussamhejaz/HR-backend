// server/middlewares/tenant.js
const { db } = require("../config/firebaseAdmin");

// Resolve tenantId from header/query OR default membership
module.exports = async function tenant(req, res, next) {
  try {
    if (req.method === "OPTIONS") return next();
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });

    const explicit = req.header("x-tenant-id") || req.query.tenantId || "";
    const isSuper =
      req.user?.role === "superadmin" ||
      req.user?.superadmin === true ||
      (req.user?.claims && req.user.claims.superadmin === true);

    // user memberships live at /memberships/{uid}/{tenantId} = { role, createdAt }
    const msnap = await db.ref(`memberships/${req.uid}`).once("value");
    const memberships = msnap.val() || {};

    let tenantId = explicit;
    if (tenantId) {
      if (!memberships[tenantId] && !isSuper) {
        return res.status(403).json({ error: "Not a member of this tenant" });
      }
    } else {
      // pick defaultTenantId if set, else first membership
      const psnap = await db.ref(`users/${req.uid}/profile/defaultTenantId`).once("value");
      const def = psnap.val();
      tenantId = def && memberships[def] ? def : Object.keys(memberships)[0];
    }

    if (!tenantId && !isSuper) {
      return res.status(403).json({ error: "No tenant membership found" });
    }

    req.tenantId = tenantId || explicit || ""; // superadmin may operate with explicit header
    req.tenantRole = (tenantId && memberships[tenantId]?.role) || (isSuper ? "superadmin" : "member");
    req.memberships = memberships;
    next();
  } catch (e) {
    console.error("tenant middleware:", e);
    res.status(500).json({ error: "Tenant resolution failed" });
  }
};
