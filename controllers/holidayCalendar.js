// server/controllers/holidayCalendar.js
const { db } = require("../config/firebaseAdmin");
const REF = db.ref("holidays");

const normalize = (body) => {
  const out = {};
  if (typeof body.name === "string") out.name = body.name.trim();
  if (typeof body.date === "string") out.date = body.date.trim();
  return out;
};

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).valueOf());

exports.list = async (req, res) => {
  try {
    const snap = await REF.once("value");
    const data = snap.val() || {};
    const arr = Object.entries(data).map(([id, h]) => ({ id, ...h }));
    // sort by date asc
    arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    res.json(arr);
  } catch (e) {
    res.status(500).json({ error: "Failed to load holidays." });
  }
};

exports.getOne = async (req, res) => {
  try {
    const snap = await REF.child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    res.status(500).json({ error: "Failed to load holiday." });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = normalize(req.body);
    if (!payload.name || !payload.date || !isISODate(payload.date)) {
      return res.status(400).json({ error: "Invalid payload (name/date)." });
    }
    const ref = await REF.push({ name: payload.name, date: payload.date, createdAt: Date.now() });
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    res.status(500).json({ error: "Failed to create holiday." });
  }
};

exports.update = async (req, res) => {
  try {
    const patch = normalize(req.body);
    if (patch.date && !isISODate(patch.date)) {
      return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)." });
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update." });
    await REF.child(req.params.id).update(patch);
    const snap = await REF.child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    res.status(500).json({ error: "Failed to update holiday." });
  }
};

exports.remove = async (req, res) => {
  try {
    await REF.child(req.params.id).remove();
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: "Failed to delete holiday." });
  }
};
