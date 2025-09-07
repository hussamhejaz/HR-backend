// server/controllers/applicants.js
const { db } = require("../config/firebaseAdmin");

function refApplicants(tenantId) {
  return db.ref(`tenants/${tenantId}/recruitment/applicants`);
}

exports.list = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refApplicants(tenantId).once("value");
    const data = snap.val() || {};
    const arr = Object.entries(data).map(([id, a]) => ({ id, ...a }));

    arr.sort((x, y) => {
      const tx = x.createdAt ? Date.parse(x.createdAt) || x.createdAt : 0;
      const ty = y.createdAt ? Date.parse(y.createdAt) || y.createdAt : 0;
      return ty - tx;
    });

    res.json(arr);
  } catch (e) {
    console.error("applicants.list error:", e);
    res.status(500).json({ error: "Failed to load applicants" });
  }
};

exports.getOne = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refApplicants(tenantId).child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("applicants.getOne error:", e);
    res.status(500).json({ error: "Failed to load applicant" });
  }
};

exports.create = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const nowISO = new Date().toISOString();
    const payload = {
      ...req.body,
      createdAt: nowISO,
      updatedAt: nowISO,
    };

    const ref = await refApplicants(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("applicants.create error:", e);
    res.status(500).json({ error: "Failed to create applicant" });
  }
};

exports.update = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refApplicants(tenantId).child(req.params.id);
    const exists = (await node.once("value")).exists();
    if (!exists) return res.status(404).json({ error: "Not found" });

    const payload = { ...req.body, updatedAt: new Date().toISOString() };
    await node.update(payload);

    const snap = await node.once("value");
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("applicants.update error:", e);
    res.status(500).json({ error: "Failed to update applicant" });
  }
};

exports.remove = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refApplicants(tenantId).child(req.params.id);
    const exists = (await node.once("value")).exists();
    if (!exists) return res.status(404).json({ error: "Not found" });

    await node.remove();
    res.status(204).end();
  } catch (e) {
    console.error("applicants.remove error:", e);
    res.status(500).json({ error: "Failed to delete applicant" });
  }
};
