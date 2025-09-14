// server/controllers/timeTracking.js
const { db } = require("../config/firebaseAdmin");

const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

const refTimesheets = (tenantId) => db.ref(`tenants/${tenantId}/timesheets`);
const refEmployees  = (tenantId) => db.ref(`tenants/${tenantId}/employees`);

const asArray = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const isElevated = (req) => {
  const r = String(req.tenantRole || "").toLowerCase();
  return ["hr", "manager", "admin", "owner", "superadmin"].includes(r);
};

const isValidDate = (s) => {
  const str = String(s || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return !Number.isNaN(new Date(str).valueOf());
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

const normalize = (id, r) => ({
  id,
  date: r.date || "",
  project: r.project || "",
  task: r.task || "",
  hours: Number(r.hours) || 0,
  status: r.status || "Pending",
  notes: r.notes || "",
  completed: Boolean(r.completed),
  completionNote: r.completionNote || "",
  completedAt: r.completedAt || null,
  createdAt: r.createdAt || null,
  updatedAt: r.updatedAt || null,
  employee: {
    uid: r.employee?.uid || r.uid || "",
    id: r.employee?.id || r.employeeId || "",
    fullName: r.employee?.fullName || r.employeeName || "",
    email: r.employee?.email || "",
    department: r.employee?.department || "",
    teamName: r.employee?.teamName || "",
  },
});

// --------- controllers ---------

exports.mine = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { from, to, status, q, project, task, limit, completed } = req.query;

    const snap = await refTimesheets(tenantId).orderByChild("employee/uid").equalTo(req.uid).once("value");
    let rows = asArray(snap.val() || {}).map((r) => normalize(r.id, r));

    if (from) rows = rows.filter((r) => r.date >= from);
    if (to)   rows = rows.filter((r) => r.date <= to);
    if (status) rows = rows.filter((r) => (r.status || "Pending") === status);
    if (project) rows = rows.filter((r) => String(r.project || "") === String(project));
    if (task) rows = rows.filter((r) => String(r.task || "") === String(task));
    if (completed === "true" || completed === "false") {
      const want = completed === "true";
      rows = rows.filter((r) => Boolean(r.completed) === want);
    }
    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [r.employee?.fullName, r.project, r.task, r.notes, r.completionNote]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }

    rows.sort((a, b) => {
      if (a.date === b.date) return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("time.mine error:", e);
    res.status(500).json({ error: "Failed to load time entries" });
  }
};

exports.list = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { from, to, employeeId, status, q, project, task, limit, completed } = req.query;

    const snap = await refTimesheets(tenantId).once("value");
    let rows = asArray(snap.val() || {}).map((r) => normalize(r.id, r));

    if (from) rows = rows.filter((r) => r.date >= from);
    if (to)   rows = rows.filter((r) => r.date <= to);
    if (employeeId) rows = rows.filter((r) => r.employee?.id === employeeId);
    if (status) rows = rows.filter((r) => (r.status || "Pending") === status);
    if (project) rows = rows.filter((r) => String(r.project || "") === String(project));
    if (task) rows = rows.filter((r) => String(r.task || "") === String(task));
    if (completed === "true" || completed === "false") {
      const want = completed === "true";
      rows = rows.filter((r) => Boolean(r.completed) === want);
    }
    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [r.employee?.fullName, r.employee?.id, r.project, r.task, r.notes, r.completionNote]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }

    rows.sort((a, b) => {
      if (a.date === b.date) return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("time.list error:", e);
    res.status(500).json({ error: "Failed to load time entries" });
  }
};

exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refTimesheets(tenantId).child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = normalize(snap.key, snap.val());
    if (!isElevated(req) && row.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(row);
  } catch (e) {
    console.error("time.getOne error:", e);
    res.status(500).json({ error: "Failed to load entry" });
  }
};

exports.create = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const {
      date, project = "", task = "", hours, notes = "",
      employeeId: bodyEmployeeId,
      completed, progressNote, completionNote,
    } = req.body || {};

    if (!isValidDate(date)) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    const h = Number(hours);
    if (Number.isNaN(h) || h < 0 || h > 24) return res.status(400).json({ error: "hours must be between 0 and 24" });

    let employee = null;
    if (isElevated(req) && bodyEmployeeId) {
      employee = await findEmployeeById(tenantId, bodyEmployeeId);
      if (!employee) return res.status(400).json({ error: "Employee not found" });
    } else {
      employee = await findEmployeeByUid(tenantId, req.uid);
      if (!employee) return res.status(404).json({ error: "Employee profile not found for this tenant" });
    }

    const now = new Date().toISOString();
    const isCompleted = Boolean(completed);
    const payload = {
      date: String(date),
      project: String(project).trim(),
      task: String(task).trim(),
      hours: h,
      status: "Pending",
      notes: String(notes).trim(),
      completed: isCompleted,
      completedAt: isCompleted ? now : null,
      completionNote: String(progressNote ?? completionNote ?? "").trim(),
      createdAt: now,
      updatedAt: now,
      employee: {
        uid: employee.uid || req.uid,
        id: employee.id,
        fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
        email: employee.email || "",
        department: employee.department || "",
        teamName: employee.teamName || "",
      },
    };

    const ref = await refTimesheets(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json(normalize(snap.key, snap.val()));
  } catch (e) {
    console.error("time.create error:", e);
    res.status(500).json({ error: "Failed to create entry" });
  }
};

exports.update = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refTimesheets(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    const row = snap.val();

    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updates = {};
    if (req.body.date !== undefined) {
      if (!isValidDate(req.body.date)) return res.status(400).json({ error: "Invalid date (YYYY-MM-DD)" });
      updates.date = String(req.body.date);
    }
    if (req.body.project !== undefined) updates.project = String(req.body.project || "").trim();
    if (req.body.task !== undefined)    updates.task = String(req.body.task || "").trim();
    if (req.body.hours !== undefined) {
      const h = Number(req.body.hours);
      if (Number.isNaN(h) || h < 0 || h > 24) return res.status(400).json({ error: "hours must be between 0 and 24" });
      updates.hours = h;
    }
    if (req.body.notes !== undefined) updates.notes = String(req.body.notes || "").trim();

    // NEW: completion fields
    if (req.body.completed !== undefined) {
      const c = Boolean(req.body.completed);
      updates.completed = c;
      updates.completedAt = c ? new Date().toISOString() : null;
    }
    if (req.body.progressNote !== undefined || req.body.completionNote !== undefined) {
      updates.completionNote = String(req.body.progressNote ?? req.body.completionNote ?? "").trim();
    }

    updates.updatedAt = new Date().toISOString();

    await node.update(updates);
    const after = await node.once("value");
    res.json(normalize(after.key, after.val()));
  } catch (e) {
    console.error("time.update error:", e);
    res.status(500).json({ error: "Failed to update entry" });
  }
};

exports.remove = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refTimesheets(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    const row = snap.val();

    if (!isElevated(req)) {
      if (row?.employee?.uid !== req.uid) return res.status(403).json({ error: "Forbidden" });
      if ((row.status || "Pending") !== "Pending") {
        return res.status(400).json({ error: "Only pending entries can be deleted by the owner" });
      }
    }

    await node.remove();
    res.status(204).end();
  } catch (e) {
    console.error("time.remove error:", e);
    res.status(500).json({ error: "Failed to delete entry" });
  }
};

// Approve / Reject (elevated only)
exports.decide = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status = "", decisionNotes = "" } = req.body || {};
    const S = String(status);
    if (!["Approved", "Rejected"].includes(S)) {
      return res.status(400).json({ error: "status must be Approved or Rejected" });
    }

    const node = refTimesheets(tenantId).child(req.params.id);
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
    res.json(normalize(after.key, after.val()));
  } catch (e) {
    console.error("time.decide error:", e);
    res.status(500).json({ error: "Failed to update status" });
  }
};

// NEW: progress endpoint (owner or elevated)
exports.progress = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refTimesheets(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    const row = snap.val();

    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updates = {};
    if (req.body.completed !== undefined) {
      const c = Boolean(req.body.completed);
      updates.completed = c;
      updates.completedAt = c ? new Date().toISOString() : null;
    }
    if (req.body.updateNote !== undefined || req.body.progressNote !== undefined || req.body.completionNote !== undefined) {
      updates.completionNote = String(req.body.updateNote ?? req.body.progressNote ?? req.body.completionNote ?? "").trim();
    }
    updates.updatedAt = new Date().toISOString();

    await node.update(updates);
    const after = await node.once("value");
    res.json(normalize(after.key, after.val()));
  } catch (e) {
    console.error("time.progress error:", e);
    res.status(500).json({ error: "Failed to update progress" });
  }
};

exports.summary = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { from, to, groupBy = "employee" } = req.query;
    const snap = await refTimesheets(tenantId).once("value");
    let rows = asArray(snap.val() || {}).map((r) => normalize(r.id, r));

    if (!isElevated(req)) {
      rows = rows.filter((r) => r.employee?.uid === req.uid);
    }
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to)   rows = rows.filter((r) => r.date <= to);

    const totals = {};
    for (const r of rows) {
      const key =
        groupBy === "date"
          ? r.date
          : groupBy === "project"
          ? r.project || "—"
          : r.employee?.fullName || r.employee?.id || "—";
      totals[key] = (totals[key] || 0) + (Number(r.hours) || 0);
    }
    res.json(totals);
  } catch (e) {
    console.error("time.summary error:", e);
    res.status(500).json({ error: "Failed to summarize time entries" });
  }
};
