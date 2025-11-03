// server/controllers/teams.js
const { db } = require("../config/firebaseAdmin");

const getTenantId = (req) =>
  String(req.tenantId || req.params.tenantId || req.header("X-Tenant-Id") || "").trim();

const refTeams = (tenantId) => db.ref(`tenants/${tenantId}/teams`);
const refDeps  = (tenantId) => db.ref(`tenants/${tenantId}/departments`);

exports.list = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const snap = await refTeams(tenantId).once("value");
  const data = snap.val() || {};
  const list = Object.entries(data).map(([id, t]) => ({ id, ...t }));
  res.json(list);
};

exports.getOne = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const snap = await refTeams(tenantId).child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json({ id: snap.key, ...snap.val() });
};


exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { name, department, membersCount = 1 } = req.body || {};
    if (!name || !department) {
      return res.status(400).json({ error: "name and department are required" });
    }

    // ✅ Verify department at tenants/{tenantId}/departments
    const depSnap = await refDeps(tenantId).child(department).once("value");
    if (!depSnap.exists()) {
      return res.status(400).json({ error: "department does not exist" });
    }

    const now = new Date().toISOString();
    const payload = {
      name: String(name).trim(),
      department,                 // department id
      membersCount: Number(membersCount) || 1,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await refTeams(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("teams.create error:", e);
    res.status(500).json({ error: "Failed to create team" });
  }
};

exports.update = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const patch = { ...req.body, updatedAt: new Date().toISOString() };
  if (patch.department) {
    const depSnap = await refDeps(tenantId).child(patch.department).once("value");
    if (!depSnap.exists()) return res.status(400).json({ error: "department does not exist" });
  }

  await refTeams(tenantId).child(req.params.id).update(patch);
  const snap = await refTeams(tenantId).child(req.params.id).once("value");
  res.json({ id: snap.key, ...snap.val() });
};

exports.remove = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  await refTeams(tenantId).child(req.params.id).remove();
  res.status(204).end();
};
