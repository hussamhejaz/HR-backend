const { db } = require("../config/firebaseAdmin");

exports.profile = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });

    // 1) load memberships
    const msnap = await db.ref(`memberships/${req.uid}`).once("value");
    const memberships = msnap.val() || {};

    // optional explicit header
    const explicit = req.header("X-Tenant-Id") || req.header("x-tenant-id") || "";

    // 2) pick tenant: explicit -> defaultTenantId -> first membership
    let tenantId = explicit;
    if (!tenantId) {
      const def = (await db.ref(`users/${req.uid}/profile/defaultTenantId`).once("value")).val();
      tenantId = (def && memberships[def]) ? def : Object.keys(memberships)[0] || "";
    }
    if (!tenantId) return res.status(403).json({ error: "No tenant membership found" });

    // 3) find employee in that tenant
    const byUid = await db.ref(`tenants/${tenantId}/employees`).orderByChild("uid").equalTo(req.uid).once("value");
    let employee = null;
    if (byUid.exists()) {
      const [id, val] = Object.entries(byUid.val())[0];
      employee = { id, ...val };
    } else if (req.user?.email) {
      const byEmail = await db.ref(`tenants/${tenantId}/employees`).orderByChild("email").equalTo(req.user.email).once("value");
      if (byEmail.exists()) {
        const [id, val] = Object.entries(byEmail.val())[0];
        employee = { id, ...val };
      }
    }
    if (!employee) return res.status(404).json({ error: "Employee profile not found for this tenant" });

    // 4) respond (include memberships so client can switch later if needed)
    res.json({
      tenantId,
      memberships,                // { [tenantId]: { role, createdAt } }
      uid: employee.uid || req.uid,
      id: employee.id,
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
      email: employee.email || "",
      phone: employee.phone || "",
      role: employee.role || "",
      departmentId: employee.departmentId || "",
      department: employee.department || "",
      teamId: employee.teamId || "",
      teamName: employee.teamName || "",
      status: employee.status || "Active",
      createdAt: employee.createdAt || "",
      updatedAt: employee.updatedAt || "",
    });
  } catch (e) {
    console.error("me.profile error:", e);
    res.status(500).json({ error: "Failed to load profile" });
  }
};
