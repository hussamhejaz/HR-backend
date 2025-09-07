// server/controllers/offboarding.js
const { db } = require("../config/firebaseAdmin");

// ----- helpers: tenant-aware refs -----
function getTenantId(req) {
  const hdrTenant = req.header("X-Tenant-Id") || req.header("x-tenant-id") || "";
  return String(req.tenantId || req.params.tenantId || hdrTenant || "").trim();
}
const refOffboarding = (tenantId) => db.ref(`tenants/${tenantId}/offboarding`);
const refEmployees  = (tenantId) => db.ref(`tenants/${tenantId}/employees`);

const toList = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
const normBool = (v) => (typeof v === "string" ? v === "true" : !!v);
const normalizeChecklist = (c = {}) => ({
  assetsReturned:   normBool(c.assetsReturned),
  emailDisabled:    normBool(c.emailDisabled),
  payrollCleared:   normBool(c.payrollCleared),
  accessRevoked:    normBool(c.accessRevoked),
  exitInterviewDone:normBool(c.exitInterviewDone),
});

// GET /api/offboarding?employeeId=abc
exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { employeeId } = req.query || {};

    // Primary: tenant-scoped
    const snap = await refOffboarding(tenantId).once("value");
    let list = toList(snap.val());

    // Filter by employee if requested
    if (employeeId) list = list.filter((i) => i.employeeId === employeeId);

    // ----- Legacy fallback -----
    if (list.length === 0) {
      const legacySnap = await db.ref("offboarding").once("value");
      let legacy = toList(legacySnap.val());

      // Build set of this-tenant employee IDs to avoid cross-tenant leakage
      const empSnap = await refEmployees(tenantId).once("value");
      const empIds = new Set(Object.keys(empSnap.val() || {}));

      legacy = legacy.filter((i) => empIds.has(i.employeeId));
      if (employeeId) legacy = legacy.filter((i) => i.employeeId === employeeId);

      // Mark for debugging/visibility (optional)
      list = legacy.map((i) => ({ ...i, _legacy: true }));
    }
    // -----------------------------------

    list.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    res.json(list);
  } catch (e) {
    console.error("Offboarding.list error:", e);
    res.status(500).json({ error: "Failed to load offboarding records" });
  }
};

// GET /api/offboarding/:id  (tenant first, then legacy)
exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refOffboarding(tenantId).child(req.params.id);
    let snap = await node.once("value");
    if (!snap.exists()) {
      // legacy fallback
      snap = await db.ref("offboarding").child(req.params.id).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    }
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("Offboarding.getOne error:", e);
    res.status(500).json({ error: "Failed to load offboarding record" });
  }
};

// POST /api/offboarding  (always write to tenant path)
exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const {
      employeeId,
      lastDay, // YYYY-MM-DD
      reason = "End of contract",
      handoverTo = "",
      noticeServed = true,
      checklist = {},
      notes = "",
      updateEmployee = false,
    } = req.body || {};

    if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
    if (!lastDay)    return res.status(400).json({ error: "lastDay is required" });

    // Ensure employee exists in this tenant
    const empSnap = await refEmployees(tenantId).child(employeeId).once("value");
    if (!empSnap.exists()) return res.status(404).json({ error: "Employee not found" });
    const emp = empSnap.val() || {};

    // Guard: lastDay >= startDate (if startDate exists)
    if (emp.startDate && String(lastDay) < String(emp.startDate)) {
      return res.status(400).json({
        error: "lastDay cannot be before employee startDate",
        details: { startDate: emp.startDate, lastDay },
      });
    }

    const now = Date.now();
    const payload = {
      employeeId,
      reason,
      lastDay,
      handoverTo,
      noticeServed: normBool(noticeServed),
      checklist: normalizeChecklist(checklist),
      notes,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await refOffboarding(tenantId).push(payload);
    const createdSnap = await ref.once("value");
    const created = { id: createdSnap.key, ...createdSnap.val() };

    if (normBool(updateEmployee)) {
      await refEmployees(tenantId).child(employeeId).update({
        status: "Terminated",
        endDate: lastDay,
        updatedAt: now,
      });
      created.employeeUpdated = true;
    }

    return res.status(201).json(created);
  } catch (e) {
    console.error("Offboarding.create error:", e);
    return res.status(500).json({ error: "Failed to create offboarding record" });
  }
};

// PUT /api/offboarding/:id  (update tenant or legacy record)
exports.update = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const id = req.params.id;

    // try tenant path
    let node = refOffboarding(tenantId).child(id);
    let snap = await node.once("value");
    let isLegacy = false;

    if (!snap.exists()) {
      // fall back to legacy
      node = db.ref("offboarding").child(id);
      snap = await node.once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      isLegacy = true;
    }

    const body = { ...req.body };
    if (body.checklist) body.checklist = normalizeChecklist(body.checklist);
    if (typeof body.noticeServed !== "undefined") body.noticeServed = normBool(body.noticeServed);
    body.updatedAt = Date.now();

    await node.update(body);
    const updated = await node.once("value");
    res.json({ id: updated.key, ...updated.val(), _legacy: isLegacy });
  } catch (e) {
    console.error("Offboarding.update error:", e);
    res.status(500).json({ error: "Failed to update offboarding record" });
  }
};

// DELETE /api/offboarding/:id  (delete in whichever path it exists)
exports.remove = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const id = req.params.id;

    let node = refOffboarding(tenantId).child(id);
    let snap = await node.once("value");
    if (!snap.exists()) {
      node = db.ref("offboarding").child(id); // legacy
      snap = await node.once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    }

    await node.remove();
    res.status(204).end();
  } catch (e) {
    console.error("Offboarding.remove error:", e);
    res.status(500).json({ error: "Failed to delete offboarding record" });
  }
};
