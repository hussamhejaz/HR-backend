// server/controllers/salaryRequests.js
const { db } = require("../config/firebaseAdmin");

/* ------------------------------ helpers ------------------------------ */
function getTenantId(req) {
  const hdrTenant = req.header("X-Tenant-Id") || req.header("x-tenant-id") || "";
  return String(req.tenantId || req.params.tenantId || hdrTenant || "").trim();
}
const isValidYMD = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(new Date(s).valueOf());

const getActor = (req) => {
  const u = req.user || {};
  return {
    uid: u.uid || null,
    email: u.email || req.header("X-User-Email") || null,
  };
};

const refRequests = (tenantId) => db.ref(`tenants/${tenantId}/salaryRequests`);
const refEmployees = (tenantId) => db.ref(`tenants/${tenantId}/employees`);

async function findEmployeeByUid(tenantId, uid) {
  if (!uid) return null;
  const snap = await refEmployees(tenantId)
    .orderByChild("uid")
    .equalTo(uid)
    .once("value");
  if (!snap.exists()) return null;
  const [id] = Object.keys(snap.val());
  return { id, ...snap.val()[id] };
}

/* ------------------------------- create ------------------------------ */
/**
 * Employees (self-service) create a salary request
 * POST /api/self/salary-requests
 * body: {
 *   type: "advance" | "inquiry",
 *   amount?: number (required for "advance"),
 *   currency?: string (>=3, required for "advance"),
 *   expectedDate?: "YYYY-MM-DD",
 *   repaymentMonths?: number (1..36),
 *   reason?: string,
 *   tags?: string[],        // e.g. ["emergency","family"]
 *   ccEmail?: string,       // optional
 *   month?: "YYYY-MM"       // optional, useful for inquiries (e.g., payslip month)
 * }
 */
exports.selfCreate = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const actor = getActor(req);
    const me = await findEmployeeByUid(tenantId, actor.uid);
    if (!me) return res.status(404).json({ error: "Employee record not found for current user" });

    const nowISO = new Date().toISOString();
    const b = req.body || {};
    const type = String(b.type || "advance").toLowerCase();

    if (!["advance", "inquiry"].includes(type)) {
      return res.status(400).json({ error: "type must be 'advance' or 'inquiry'" });
    }

    // Validation
    let amount = null;
    let currency = null;

    if (type === "advance") {
      if (b.amount === undefined) return res.status(400).json({ error: "amount is required" });
      amount = Number(b.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
      }
      currency = String(b.currency || "").trim().toUpperCase();
      if (!currency || currency.length < 3) {
        return res.status(400).json({ error: "currency must be a 3-letter code" });
      }
    } else {
      // inquiry: amount/currency optional and ignored
      amount = b.amount !== undefined ? Number(b.amount) : null;
      currency = b.currency ? String(b.currency).trim().toUpperCase() : null;
    }

    const expectedDate = b.expectedDate ? String(b.expectedDate) : null;
    if (expectedDate && !isValidYMD(expectedDate)) {
      return res.status(400).json({ error: "expectedDate must be YYYY-MM-DD" });
    }

    const month = b.month ? String(b.month) : null; // e.g., "2025-09"
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month must be YYYY-MM" });
    }

    let repaymentMonths = b.repaymentMonths !== undefined ? Number(b.repaymentMonths) : null;
    if (repaymentMonths !== null) {
      if (!Number.isInteger(repaymentMonths) || repaymentMonths < 1 || repaymentMonths > 36) {
        return res.status(400).json({ error: "repaymentMonths must be an integer 1..36" });
      }
    }

    const doc = {
      tenantId,
      employeeId: me.id,
      type,                       // "advance" | "inquiry"
      amount: amount ?? null,
      currency: currency ?? null,
      expectedDate: expectedDate || null,
      month: month || null,       // useful for inquiries related to a month
      repaymentMonths: repaymentMonths,
      reason: (b.reason || "").toString().trim(),
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
      ccEmail: (b.ccEmail || "").toString().trim() || null,
      status: "Pending",          // Pending | Approved | Rejected | Cancelled
      createdBy: actor,
      createdAt: nowISO,
      updatedAt: nowISO,
      decision: null              // { by, at, action, notes }
    };

    const ref = await refRequests(tenantId).push(doc);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("salaryRequests.selfCreate error:", e);
    res.status(500).json({ error: "Failed to submit request" });
  }
};

/* ----------------------------- self list ----------------------------- */
// GET /api/self/salary-requests?status=Pending|Approved|Rejected
exports.selfList = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const actor = getActor(req);
    const me = await findEmployeeByUid(tenantId, actor.uid);
    if (!me) return res.status(404).json({ error: "Employee record not found for current user" });

    const { status = "" } = req.query;

    // Query by employeeId for efficiency
    const snap = await refRequests(tenantId)
      .orderByChild("employeeId")
      .equalTo(me.id)
      .once("value");

    let list = [];
    if (snap.exists()) {
      list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
    }

    if (status) list = list.filter((r) => r.status === status);

    // newest first
    list.sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0));
    res.json(list);
  } catch (e) {
    console.error("salaryRequests.selfList error:", e);
    res.status(500).json({ error: "Failed to load your requests" });
  }
};

/* ------------------------------ admin list --------------------------- */
// GET /api/salary/requests?employeeId=&status=&type=&limit=50
exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { employeeId = "", status = "", type = "", limit = "" } = req.query;

    let list = [];
    if (employeeId) {
      const snap = await refRequests(tenantId).orderByChild("employeeId").equalTo(employeeId).once("value");
      if (snap.exists()) list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
    } else {
      const snap = await refRequests(tenantId).once("value");
      if (snap.exists()) list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
    }

    if (status) list = list.filter((r) => r.status === status);
    if (type) list = list.filter((r) => r.type === type);

    list.sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0));

    const lim = parseInt(limit, 10);
    if (!Number.isNaN(lim) && lim > 0) list = list.slice(0, lim);

    res.json(list);
  } catch (e) {
    console.error("salaryRequests.list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
};

/* ------------------------------ admin get ---------------------------- */
// GET /api/salary/requests/:id
exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refRequests(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("salaryRequests.getOne error:", e);
    res.status(500).json({ error: "Failed to load request" });
  }
};

/* --------------------------- admin decision -------------------------- */
/**
 * POST /api/salary/requests/:id/decision
 * body: { action: "approve" | "reject" | "cancel", notes?: string }
 */
exports.decide = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const id = req.params.id;
    const node = refRequests(tenantId).child(id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const body = req.body || {};
    const action = String(body.action || "").toLowerCase();
    if (!["approve", "reject", "cancel"].includes(action)) {
      return res.status(400).json({ error: "action must be approve | reject | cancel" });
    }

    const statusMap = { approve: "Approved", reject: "Rejected", cancel: "Cancelled" };
    const status = statusMap[action];

    const patch = {
      status,
      updatedAt: new Date().toISOString(),
      decision: {
        by: getActor(req),
        at: new Date().toISOString(),
        action,
        notes: (body.notes || "").toString().trim() || null,
      },
    };

    await node.update(patch);
    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("salaryRequests.decide error:", e);
    res.status(500).json({ error: "Failed to update request" });
  }
};

/* ------------------------------ admin update ------------------------- */
// Optional general update (edit reason/tags/etc.)
exports.update = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const id = req.params.id;
    const node = refRequests(tenantId).child(id);
    const raw = req.body || {};

    const allowed = ["reason", "tags", "expectedDate", "repaymentMonths", "ccEmail"];
    const patch = { updatedAt: new Date().toISOString() };

    for (const k of allowed) {
      if (raw[k] !== undefined) patch[k] = raw[k];
    }

    if (patch.expectedDate && !isValidYMD(patch.expectedDate)) {
      return res.status(400).json({ error: "expectedDate must be YYYY-MM-DD" });
    }
    if (patch.repaymentMonths !== undefined) {
      const m = Number(patch.repaymentMonths);
      if (!Number.isInteger(m) || m < 1 || m > 36) {
        return res.status(400).json({ error: "repaymentMonths must be an integer 1..36" });
      }
      patch.repaymentMonths = m;
    }

    await node.update(patch);
    const after = await node.once("value");
    if (!after.exists()) return res.status(404).json({ error: "Not found" });
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("salaryRequests.update error:", e);
    res.status(500).json({ error: "Failed to update request" });
  }
};

