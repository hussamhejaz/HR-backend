const { db } = require("../config/firebaseAdmin");

/* -------------------- helpers -------------------- */

const getTenantId = (req) =>
  String(
    req.tenantId ||
    req.params.tenantId ||
    req.header("X-Tenant-Id") ||
    req.header("x-tenant-id") ||
    ""
  ).trim();

const refShifts     = (tenantId) => db.ref(`tenants/${tenantId}/shifts`);
const refEmployees  = (tenantId) => db.ref(`tenants/${tenantId}/employees`);

const asArray = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const isElevated = (req) => {
  const r = String(req.tenantRole || "").toLowerCase();
  return ["hr", "manager", "admin", "owner", "superadmin"].includes(r);
};

async function findEmployeeByUid(tenantId, uid) {
  const snap = await refEmployees(tenantId).orderByChild("uid").equalTo(uid).once("value");
  if (!snap.exists()) return null;
  const [id, val] = Object.entries(snap.val())[0];
  return { id, ...val };
}

async function findEmployeeById(tenantId, id) {
  const snap = await refEmployees(tenantId).child(String(id)).once("value");
  if (!snap.exists()) return null;
  return { id: snap.key, ...snap.val() };
}

// HH:MM -> minutes since midnight
const m = (hhmm) => {
  const [hh, mm] = String(hhmm).split(":").map((n) => Number(n));
  return (hh * 60) + mm;
};

// [a,b) overlaps [c,d)?
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

const normalize = (id, s) => ({
  id,
  date: s.date || "",                  // YYYY-MM-DD
  startTime: s.startTime || "",        // HH:MM (24h)
  endTime: s.endTime || "",            // HH:MM
  location: s.location || "",
  role: s.role || "",                  // (optional) job role for the shift
  notes: s.notes || "",                // scheduler notes
  published: Boolean(s.published),     // visible to employee in clients
  acknowledged: Boolean(s.acknowledged),
  acknowledgeNote: s.acknowledgeNote || "",
  acknowledgedAt: s.acknowledgedAt || null,
  createdAt: s.createdAt || null,
  updatedAt: s.updatedAt || null,
  // embedded employee snapshot (for quick listing/filters)
  employee: {
    uid: s.employee?.uid || s.uid || "",
    id: s.employee?.id || s.employeeId || "",
    fullName: s.employee?.fullName || s.employeeName || "",
    email: s.employee?.email || "",
    department: s.employee?.department || "",
    teamName: s.employee?.teamName || "",
  },
});

/* -------------------- controllers -------------------- */

// GET /mine - shifts assigned to current user
exports.mine = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { from, to, q, published, acknowledged, limit } = req.query;

    const snap = await refShifts(tenantId).orderByChild("employee/uid").equalTo(req.uid).once("value");
    let rows = asArray(snap.val() || {}).map((r) => normalize(r.id, r));

    if (from) rows = rows.filter((r) => r.date >= from);
    if (to)   rows = rows.filter((r) => r.date <= to);
    if (published !== undefined) {
      const want = String(published) === "true";
      rows = rows.filter((r) => Boolean(r.published) === want);
    }
    if (acknowledged !== undefined) {
      const want = String(acknowledged) === "true";
      rows = rows.filter((r) => Boolean(r.acknowledged) === want);
    }
    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [
          r.employee?.fullName,
          r.location,
          r.role,
          r.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }

    rows.sort((a, b) =>
      a.date === b.date ? (a.startTime < b.startTime ? -1 : 1) : (a.date < b.date ? -1 : 1)
    );

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("shifts.mine error:", e);
    res.status(500).json({ error: "Failed to load shifts" });
  }
};

// GET / - elevated list of all shifts
exports.list = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { from, to, employeeId, q, published, acknowledged, limit } = req.query;

    const snap = await refShifts(tenantId).once("value");
    let rows = asArray(snap.val() || {}).map((r) => normalize(r.id, r));

    if (from) rows = rows.filter((r) => r.date >= from);
    if (to)   rows = rows.filter((r) => r.date <= to);
    if (employeeId) rows = rows.filter((r) => r.employee?.id === String(employeeId));
    if (published !== undefined) {
      const want = String(published) === "true";
      rows = rows.filter((r) => Boolean(r.published) === want);
    }
    if (acknowledged !== undefined) {
      const want = String(acknowledged) === "true";
      rows = rows.filter((r) => Boolean(r.acknowledged) === want);
    }
    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [
          r.employee?.fullName,
          r.employee?.id,
          r.location,
          r.role,
          r.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }

    rows.sort((a, b) =>
      a.date === b.date ? (a.startTime < b.startTime ? -1 : 1) : (a.date < b.date ? -1 : 1)
    );

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("shifts.list error:", e);
    res.status(500).json({ error: "Failed to load shifts" });
  }
};

// GET /:id - read one (employee can read own; elevated can read any)
exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refShifts(tenantId).child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = normalize(snap.key, snap.val());
    if (!isElevated(req) && row.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(row);
  } catch (e) {
    console.error("shifts.getOne error:", e);
    res.status(500).json({ error: "Failed to load shift" });
  }
};

// POST / - create (elevated)  **with overlap protection**
exports.create = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const {
      date, startTime, endTime,
      location = "", role = "", notes = "",
      employeeId,
      published = false,
    } = req.body || {};

    const employee = await findEmployeeById(tenantId, employeeId);
    if (!employee) return res.status(400).json({ error: "Employee not found" });

    // Overlap check (same employee, same date)
    const byEmp = await refShifts(tenantId).orderByChild("employee/id").equalTo(String(employeeId)).once("value");
    const sameDay = asArray(byEmp.val() || {}).filter((x) => x.date === String(date));
    const S = m(startTime), E = m(endTime);
    const conflicts = sameDay
      .filter((x) => overlaps(S, E, m(x.startTime), m(x.endTime)))
      .map((x) => ({ id: x.id, date: x.date, startTime: x.startTime, endTime: x.endTime }));

    if (conflicts.length) {
      return res.status(409).json({
        error: "Shift overlaps existing shift(s)",
        conflicts,
      });
    }

    const now = new Date().toISOString();
    const payload = {
      date: String(date),
      startTime: String(startTime),
      endTime: String(endTime),
      location: String(location).trim(),
      role: String(role).trim(),
      notes: String(notes).trim(),
      published: Boolean(published),
      acknowledged: false,
      acknowledgeNote: "",
      acknowledgedAt: null,
      createdAt: now,
      updatedAt: now,
      employee: {
        uid: employee.uid || "",
        id: employee.id,
        fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.fullName || "",
        email: employee.email || "",
        department: employee.department || "",
        teamName: employee.teamName || "",
      },
    };

    const ref = await refShifts(tenantId).push(payload);
    const saved = await ref.once("value");
    res.status(201).json(normalize(saved.key, saved.val()));
  } catch (e) {
    console.error("shifts.create error:", e);
    res.status(500).json({ error: "Failed to create shift" });
  }
};

// PUT /:id - update (elevated)  **with overlap protection**
exports.update = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refShifts(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    const current = snap.val();

    const {
      date, startTime, endTime,
      location, role, notes,
      published,
      employeeId,
    } = req.body || {};

    const updates = {};

    // Resolve target employee & date/time for overlap check
    const targetEmpId = employeeId !== undefined ? String(employeeId) : (current.employee?.id || "");
    const targetDate  = date !== undefined ? String(date) : (current.date || "");
    const targetStart = startTime !== undefined ? String(startTime) : (current.startTime || "");
    const targetEnd   = endTime !== undefined ? String(endTime) : (current.endTime || "");

    // If any of the fields related to overlap changed, re-check
    if (targetEmpId && targetDate && targetStart && targetEnd) {
      const byEmp = await refShifts(tenantId).orderByChild("employee/id").equalTo(targetEmpId).once("value");
      const sameDay = asArray(byEmp.val() || {}).filter((x) => x.date === targetDate && x.id !== req.params.id);
      const S = m(targetStart), E = m(targetEnd);
      const conflicts = sameDay
        .filter((x) => overlaps(S, E, m(x.startTime), m(x.endTime)))
        .map((x) => ({ id: x.id, date: x.date, startTime: x.startTime, endTime: x.endTime }));
      if (conflicts.length) {
        return res.status(409).json({
          error: "Shift overlaps existing shift(s)",
          conflicts,
        });
      }
    }

    if (date !== undefined)        updates.date = String(date);
    if (startTime !== undefined)   updates.startTime = String(startTime);
    if (endTime !== undefined)     updates.endTime = String(endTime);
    if (location !== undefined)    updates.location = String(location || "").trim();
    if (role !== undefined)        updates.role = String(role || "").trim();
    if (notes !== undefined)       updates.notes = String(notes || "").trim();
    if (published !== undefined)   updates.published = Boolean(published);

    if (employeeId !== undefined) {
      if (String(employeeId).trim() === "") {
        return res.status(400).json({ error: "Invalid employeeId" });
      }
      const emp = await findEmployeeById(tenantId, employeeId);
      if (!emp) return res.status(400).json({ error: "Employee not found" });
      updates.employee = {
        uid: emp.uid || "",
        id: emp.id,
        fullName: `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.fullName || "",
        email: emp.email || "",
        department: emp.department || "",
        teamName: emp.teamName || "",
      };
      // Reset acknowledgement if employee changed
      updates.acknowledged = false;
      updates.acknowledgeNote = "";
      updates.acknowledgedAt = null;
    }

    updates.updatedAt = new Date().toISOString();

    await node.update(updates);
    const after = await node.once("value");
    res.json(normalize(after.key, after.val()));
  } catch (e) {
    console.error("shifts.update error:", e);
    res.status(500).json({ error: "Failed to update shift" });
  }
};

// PATCH /:id/ack - employee acknowledges/unacknowledges assigned shift
exports.acknowledge = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refShifts(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = snap.val();

    // Only the assigned employee OR elevated roles can ack
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { acknowledged, note } = req.body || {};

    const updates = {
      acknowledged: Boolean(acknowledged),
      acknowledgeNote: String(note || "").trim(),
      acknowledgedAt: acknowledged ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    };

    await node.update(updates);
    const after = await node.once("value");
    res.json(normalize(after.key, after.val()));
  } catch (e) {
    console.error("shifts.acknowledge error:", e);
    res.status(500).json({ error: "Failed to update acknowledgement" });
  }
};

// DELETE /:id - remove (elevated)
exports.remove = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refShifts(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    await node.remove();
    res.status(204).end();
  } catch (e) {
    console.error("shifts.remove error:", e);
    res.status(500).json({ error: "Failed to delete shift" });
  }
};
