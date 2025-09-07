// controllers/leaveRequests.js
const { db } = require("../config/firebaseAdmin");
const REF = db.ref("leaveRequests");

// helpers
const asArray = (obj) =>
  Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const required = (v) => typeof v === "string" && v.trim() !== "";

// GET /api/attendance/leave?status=&q=&from=&to=&limit=
exports.list = async (req, res) => {
  const { status, q = "", from, to, limit } = req.query;

  const snap = await REF.once("value");
  let rows = asArray(snap.val());

  // filters
  if (status) {
    const s = String(status).toLowerCase();
    rows = rows.filter((r) => String(r.status || "").toLowerCase() === s);
  }

  if (q) {
    const term = String(q).toLowerCase();
    rows = rows.filter((r) =>
      [r.employee, r.type, r.notes]
        .map((x) => String(x || "").toLowerCase())
        .some((x) => x.includes(term))
    );
  }

  if (from) rows = rows.filter((r) => new Date(r.from) >= new Date(from));
  if (to)   rows = rows.filter((r) => new Date(r.to)   <= new Date(to));

  // sort by "from" desc
  rows.sort((a, b) => new Date(b.from) - new Date(a.from));

  const n = Number.parseInt(limit, 10);
  if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

  res.json(rows);
};

exports.getOne = async (req, res) => {
  const snap = await REF.child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json({ id: snap.key, ...snap.val() });
};

exports.create = async (req, res) => {
  const { employee, type, from, to, status = "Pending", notes = "" } = req.body || {};

  if (!required(employee) || !required(type) || !required(from) || !required(to)) {
    return res.status(400).json({ error: "employee, type, from, to are required" });
  }
  if (new Date(from) > new Date(to)) {
    return res.status(400).json({ error: "'from' cannot be after 'to'" });
  }

  const now = new Date().toISOString();
  const payload = { employee, type, from, to, status, notes, createdAt: now, updatedAt: now };

  const ref = await REF.push(payload);
  const snap = await ref.once("value");
  res.status(201).json({ id: snap.key, ...snap.val() });
};

exports.update = async (req, res) => {
  const patch = req.body || {};

  if (patch.from && patch.to && new Date(patch.from) > new Date(patch.to)) {
    return res.status(400).json({ error: "'from' cannot be after 'to'" });
  }

  patch.updatedAt = new Date().toISOString();

  await REF.child(req.params.id).update(patch);
  const snap = await REF.child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json({ id: snap.key, ...snap.val() });
};

exports.remove = async (req, res) => {
  await REF.child(req.params.id).remove();
  res.status(204).end();
};
