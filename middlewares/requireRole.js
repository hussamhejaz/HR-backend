// server/middlewares/requireRole.js
/**
 * Accepts one or more allowed roles. Example:
 *   router.use(requireRole("admin","hr","manager","superadmin"));
 *
 * The tenant middleware sets req.tenantRole from memberships/{uid}/{tenantId}.role
 */
module.exports = function requireRole(...allowed) {
  const allow = new Set((allowed || []).map((r) => String(r).toLowerCase()));

  // Role aliases/hierarchy: treat "owner" as "admin" within its tenant
  const alias = {
    owner: "admin",
  };

  return (req, res, next) => {
    if (req.method === "OPTIONS") return next(); // preflight

    const raw = String(req.tenantRole || "member").toLowerCase();
    const effective = alias[raw] || raw;

    if (allow.size === 0 || allow.has(effective)) return next();

    return res.status(403).json({ error: "Forbidden: insufficient role" });
  };
};
