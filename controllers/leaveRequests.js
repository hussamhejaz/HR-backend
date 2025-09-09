// server/controllers/leaveRequests.js
const { db } = require("../config/firebaseAdmin");

// --- helpers ---------------------------------------------------------------
const getTenantId = (req) =>
  String(req.tenantId || req.params.tenantId || req.header("X-Tenant-Id") || req.header("x-tenant-id") || "").trim();

const refLeaves = (tenantId) => db.ref(`tenants/${tenantId}/leaveRequests`);
const refEmployees = (tenantId) => db.ref(`tenants/${tenantId}/employees`);

const asArray = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const isElevated = (req) => {
  const r = String(req.tenantRole || "").toLowerCase();
  return ["hr", "manager", "admin", "owner", "superadmin"].includes(r);
};

const toBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v || "").toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "paid";
};

const ALLOWED_TYPES = new Set(["Annual", "Sick", "Unpaid", "Emergency", "Other"]);

const isValidDate = (s) => !Number.isNaN(new Date(String(s)).valueOf());

const diffDays = (from, to, halfStart, halfEnd) => {
  const d0 = new Date(from);
  const d1 = new Date(to);
  // inclusive day count
  let days = Math.floor((d1 - d0) / 86400000) + 1;
  if (halfStart) days -= 0.5;
  if (halfEnd) days -= 0.5;
  // clamp min 0.5
  return Math.max(0.5, days);
};

async function findEmployeeByUid(tenantId, uid) {
  const snap = await refEmployees(tenantId).orderByChild("uid").equalTo(uid).once("value");
  if (!snap.exists()) return null;
  const [id, val] = Object.entries(snap.val())[0];
  return { id, ...val };
}

// --- controllers -----------------------------------------------------------

// GET /api/attendance/leave/mine?status=&from=&to=
exports.mine = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, from, to } = req.query;

    const snap = await refLeaves(tenantId)
      .orderByChild("employee/uid")
      .equalTo(req.uid)
      .once("value");

    let rows = asArray(snap.val());

    if (status) {
      const s = String(status).toLowerCase();
      rows = rows.filter((r) => String(r.status || "").toLowerCase() === s);
    }
    if (from) rows = rows.filter((r) => new Date(r.from) >= new Date(from));
    if (to)   rows = rows.filter((r) => new Date(r.to)   <= new Date(to));

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows);
  } catch (e) {
    console.error("leave.mine error:", e);
    res.status(500).json({ error: "Failed to load leave requests" });
  }
};

// GET /api/attendance/leave?status=&q=&from=&to=&limit=
exports.list = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, q = "", from, to, limit } = req.query;

    const snap = await refLeaves(tenantId).once("value");
    let rows = asArray(snap.val());

    if (status) {
      const s = String(status).toLowerCase();
      rows = rows.filter((r) => String(r.status || "").toLowerCase() === s);
    }
    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [
          r.employee?.fullName,
          r.employee?.email,
          r.type,
          r.reason,
          r.notes,
          r.destination,
          r.contact,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }
    if (from) rows = rows.filter((r) => new Date(r.from) >= new Date(from));
    if (to)   rows = rows.filter((r) => new Date(r.to)   <= new Date(to));

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("leave.list error:", e);
    res.status(500).json({ error: "Failed to load leave requests" });
  }
};

// GET /api/attendance/leave/:id
exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refLeaves(tenantId).child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = { id: snap.key, ...snap.val() };
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(row);
  } catch (e) {
    console.error("leave.getOne error:", e);
    res.status(500).json({ error: "Failed to load leave request" });
  }
};

// POST /api/attendance/leave
exports.create = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    // match mobile UI
    const {
      type,
      paid,
      from,
      to,
      halfDayStart = false,
      halfDayEnd = false,
      reason = "",
      destination = "",
      contact = "",
      notes = "",
    } = req.body || {};

    if (!ALLOWED_TYPES.has(String(type || ""))) {
      return res.status(400).json({ error: "Invalid leave type" });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ error: "from and to must be valid dates (YYYY-MM-DD)" });
    }
    if (new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "'from' cannot be after 'to'" });
    }
    if (!String(reason).trim()) {
      return res.status(400).json({ error: "reason is required" });
    }
    if (!String(contact).trim()) {
      return res.status(400).json({ error: "contact is required" });
    }

    const employee = await findEmployeeByUid(tenantId, req.uid);
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found for this tenant" });
    }

    const now = new Date().toISOString();
    const days = diffDays(from, to, toBool(halfDayStart), toBool(halfDayEnd));

    const payload = {
      type: String(type),
      paid: toBool(paid),
      from: String(from),
      to: String(to),
      halfDayStart: toBool(halfDayStart),
      halfDayEnd: toBool(halfDayEnd),
      reason: String(reason).trim(),
      destination: String(destination || "").trim(),
      contact: String(contact).trim(),
      notes: String(notes || "").trim(),
      days,

      status: "Pending",          // Pending | Approved | Rejected | Cancelled
      createdAt: now,
      updatedAt: now,

      // snapshot of the employee at request time
      employee: {
        uid: employee.uid || req.uid,
        id: employee.id,
        fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
        email: employee.email || "",
        phone: employee.phone || "",
        roleTitle: employee.role || "",
        departmentId: employee.departmentId || "",
        department: employee.department || "",
        teamId: employee.teamId || "",
        teamName: employee.teamName || "",
      },
    };

    const ref = await refLeaves(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("leave.create error:", e);
    res.status(500).json({ error: "Failed to create leave request" });
  }
};

// PATCH /api/attendance/leave/:id/decision  { status: "Approved"|"Rejected", decisionNotes? }
exports.decide = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, decisionNotes = "" } = req.body || {};
    const S = String(status || "");
    if (!["Approved", "Rejected"].includes(S)) {
      return res.status(400).json({ error: "status must be Approved or Rejected" });
    }

    const node = refLeaves(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const now = new Date().toISOString();
    await node.update({
      status: S,
      decisionNotes: String(decisionNotes || "").trim(),
      decidedAt: now,
      decidedBy: { uid: req.uid, email: req.user?.email || "" },
      updatedAt: now,
    });

    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("leave.decide error:", e);
    res.status(500).json({ error: "Failed to update request" });
  }
};

// PATCH /api/attendance/leave/:id/cancel
exports.cancel = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refLeaves(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = snap.val();
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (row.status !== "Pending") {
      return res.status(400).json({ error: "Only pending requests can be cancelled" });
    }

    const now = new Date().toISOString();
    await node.update({ status: "Cancelled", updatedAt: now, cancelledAt: now, cancelledBy: req.uid });
    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("leave.cancel error:", e);
    res.status(500).json({ error: "Failed to cancel request" });
  }
};
