// server/controllers/me.js
const { db } = require("../config/firebaseAdmin");

// Resolve tenantId from middleware, path param, or header
function getTenantId(req) {
  const hdrTenant = req.header("X-Tenant-Id") || req.header("x-tenant-id") || "";
  return String(req.tenantId || req.params.tenantId || hdrTenant || "").trim();
}

/**
 * GET /api/me
 * Returns the logged-in user's employee profile within the active tenant.
 * - Works for any member (employee/hr/manager/admin/superadmin)
 * - Requires Authorization: Bearer <Firebase ID token>
 * - Tenant is resolved by middleware (defaultTenantId) or X-Tenant-Id header
 */
exports.profile = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    // 1) Prefer match by Auth UID (set when HR created the employee)
    const byUidSnap = await db
      .ref(`tenants/${tenantId}/employees`)
      .orderByChild("uid")
      .equalTo(req.uid)
      .once("value");

    let employee = null;
    if (byUidSnap.exists()) {
      const [id, val] = Object.entries(byUidSnap.val())[0];
      employee = { id, ...val };
    } else {
      // 2) Fallback: match by email from token
      const email = (req.user && req.user.email) || "";
      if (email) {
        const byEmailSnap = await db
          .ref(`tenants/${tenantId}/employees`)
          .orderByChild("email")
          .equalTo(email)
          .once("value");
        if (byEmailSnap.exists()) {
          const [id, val] = Object.entries(byEmailSnap.val())[0];
          employee = { id, ...val };
        }
      }
    }

    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found for this tenant" });
    }

    // Trim to only what's needed by the app (you can add more fields if you like)
    const out = {
      uid: employee.uid || req.uid,
      tenantId,
      tenantRole: String(req.tenantRole || "member"),
      id: employee.id,
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
      email: employee.email || "",
      phone: employee.phone || "",
      roleTitle: employee.role || "",       // job title
      departmentId: employee.departmentId || "",
      department: employee.department || "",
      teamId: employee.teamId || "",
      teamName: employee.teamName || "",
      status: employee.status || "Active",
      employeeType: employee.employeeType || "Full-time",
    };

    return res.json(out);
  } catch (e) {
    console.error("me.profile error:", e);
    res.status(500).json({ error: "Failed to load profile" });
  }
};
