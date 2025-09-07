// server/controllers/timeTracking.js
const { db } = require("../config/firebaseAdmin");
const REF = db.ref("timesheets");

// Helper: normalize one record
const normalize = (id, r) => ({
  id,
  date: r.date || "",
  employeeId: r.employeeId || "",
  employeeName: r.employeeName || "",
  project: r.project || "",
  task: r.task || "",
  hours: Number(r.hours) || 0,
  status: r.status || "Pending",
  notes: r.notes || "",
  createdAt: r.createdAt || null,
  updatedAt: r.updatedAt || null,
});

exports.list = async (req, res) => {
  const { from, to, employeeId, status, q } = req.query;

  const snap = await REF.once("value");
  const data = snap.val() || {};
  let rows = Object.entries(data).map(([id, r]) => normalize(id, r));

  // in-memory filters (sufficient for modest datasets)
  if (from) rows = rows.filter((r) => r.date >= from);
  if (to) rows = rows.filter((r) => r.date <= to);
  if (employeeId) rows = rows.filter((r) => r.employeeId === employeeId);
  if (status) rows = rows.filter((r) => (r.status || "Pending") === status);
  if (q) {
    const term = q.toLowerCase();
    rows = rows.filter((r) =>
      [
        r.employeeName,
        r.employeeId,
        r.project,
        r.task,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }

  // sort newest date first, then createdAt desc
  rows.sort((a, b) => {
    if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
    return a.date < b.date ? 1 : -1;
  });

  res.json(rows);
};

exports.getOne = async (req, res) => {
  const snap = await REF.child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json(normalize(snap.key, snap.val()));
};

exports.create = async (req, res) => {
  const now = Date.now();
  const payload = {
    date: req.body.date,
    employeeId: req.body.employeeId || "",
    employeeName: req.body.employeeName || "",
    project: req.body.project || "",
    task: req.body.task || "",
    hours: Number(req.body.hours) || 0,
    status: req.body.status || "Pending",
    notes: req.body.notes || "",
    createdAt: now,
    updatedAt: now,
  };

  // simple validation
  if (!payload.date) return res.status(400).json({ error: "date is required" });
  if (!payload.employeeName) return res.status(400).json({ error: "employeeName is required" });
  if (payload.hours < 0 || payload.hours > 24) return res.status(400).json({ error: "hours must be 0..24" });

  const ref = await REF.push(payload);
  const snap = await ref.once("value");
  res.status(201).json(normalize(snap.key, snap.val()));
};

exports.update = async (req, res) => {
  const now = Date.now();
  const updates = {
    ...(req.body.date !== undefined ? { date: req.body.date } : {}),
    ...(req.body.employeeId !== undefined ? { employeeId: req.body.employeeId } : {}),
    ...(req.body.employeeName !== undefined ? { employeeName: req.body.employeeName } : {}),
    ...(req.body.project !== undefined ? { project: req.body.project } : {}),
    ...(req.body.task !== undefined ? { task: req.body.task } : {}),
    ...(req.body.hours !== undefined ? { hours: Number(req.body.hours) || 0 } : {}),
    ...(req.body.status !== undefined ? { status: req.body.status } : {}),
    ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
    updatedAt: now,
  };

  await REF.child(req.params.id).update(updates);
  const snap = await REF.child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json(normalize(snap.key, snap.val()));
};

exports.remove = async (req, res) => {
  await REF.child(req.params.id).remove();
  res.status(204).end();
};

// Simple summaries (optional, used for future widgets)
exports.summary = async (req, res) => {
  const { from, to, groupBy = "employee" } = req.query;
  const snap = await REF.once("value");
  const data = snap.val() || {};
  let rows = Object.entries(data).map(([id, r]) => normalize(id, r));
  if (from) rows = rows.filter((r) => r.date >= from);
  if (to) rows = rows.filter((r) => r.date <= to);

  const groups = {};
  for (const r of rows) {
    const key = groupBy === "date" ? r.date : (r.employeeName || r.employeeId || "—");
    groups[key] = (groups[key] || 0) + (Number(r.hours) || 0);
  }
  res.json(groups);
};
