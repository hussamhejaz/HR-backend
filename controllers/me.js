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
 * Requires:
 *   - Authorization: Bearer <Firebase ID token>
 *   - X-Tenant-Id: <tenantId>  (unless defaultTenantId is set for the user)
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

    // Build the full profile response
    const out = {
      // identity / tenant
      uid: employee.uid || req.uid,
      tenantId,
      tenantRole: String(req.tenantRole || "member"),
      id: employee.id,

      // names
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),

      // contact
      email: employee.email || "",
      phone: employee.phone || "",
      address: employee.address || "",

      // personal
      gender: employee.gender || "",
      dob: employee.dob || "",
      nationality: employee.nationality || "",

      // job
      role: employee.role || "",
      roleTitle: employee.role || "", // alias
      departmentId: employee.departmentId || "",
      department: employee.department || "",
      teamId: employee.teamId || "",
      teamName: employee.teamName || "",
      status: employee.status || "Active",
      employeeType: employee.employeeType || "Full-time",
      startDate: employee.startDate || "",
      endDate: employee.endDate || "",

      // payroll
      salary:
        typeof employee.salary === "number"
          ? employee.salary
          : Number(employee.salary || 0),
      payFrequency: employee.payFrequency || "Monthly",
      bankName: employee.bankName || "",
      accountNumber: employee.accountNumber || "",
      iban: employee.iban || "",

      // misc
      notes: employee.notes || "",
      createdAt: employee.createdAt || "",
      updatedAt: employee.updatedAt || "",

      // stored files (large; your app can ignore if not needed)
      contractFileName: employee.contractFileName || "",
      contractBase64: employee.contractBase64 || "",
      profilePicFileName: employee.profilePicFileName || "",
      profilePicBase64: employee.profilePicBase64 || "",
      idDocFileName: employee.idDocFileName || "",
      idDocBase64: employee.idDocBase64 || "",
    };

    return res.json(out);
  } catch (e) {
    console.error("me.profile error:", e);
    res.status(500).json({ error: "Failed to load profile" });
  }
};
