// server/controllers/adjustments.js
const { db } = require("../config/firebaseAdmin");

// Resolve tenantId from middleware, path param, or header
function getTenantId(req) {
  return String(
    req.tenantId || req.params.tenantId || req.header("X-Tenant-Id") || ""
  ).trim();
}

function refAdjustments(tenantId) {
  return db.ref(`tenants/${tenantId}/adjustments`);
}

exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refAdjustments(tenantId).once("value");
    const data = snap.val() || {};
    const arr = Object.entries(data).map(([id, a]) => ({ id, ...a }));

    arr.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    res.json(arr);
  } catch (e) {
    console.error("adjustments.list error:", e);
    res.status(500).json({ error: "Failed to load adjustments" });
  }
};

exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refAdjustments(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("adjustments.getOne error:", e);
    res.status(500).json({ error: "Failed to load adjustment" });
  }
};

exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const now = Date.now();
    const payload = {
      ...req.body,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await refAdjustments(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("adjustments.create error:", e);
    res.status(500).json({ error: "Failed to create adjustment" });
  }
};

exports.update = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refAdjustments(tenantId).child(req.params.id);
    const patch = { ...req.body, updatedAt: Date.now() };

    await node.update(patch);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("adjustments.update error:", e);
    res.status(500).json({ error: "Failed to update adjustment" });
  }
};

exports.remove = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    await refAdjustments(tenantId).child(req.params.id).remove();
    res.status(204).end();
  } catch (e) {
    console.error("adjustments.remove error:", e);
    res.status(500).json({ error: "Failed to delete adjustment" });
  }
};

/** BULK create: POST /api/payroll/adjustments/bulk  { items: [...] } */
exports.bulkCreate = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "items[] required" });

    const now = Date.now();
    const ref = refAdjustments(tenantId);
    const ops = items.map((item) =>
      ref.push({
        ...item,
        createdAt: now,
        updatedAt: now,
      })
    );

    await Promise.all(ops);

    // Return the newly created items (best-effort; read them back)
    const snap = await ref.orderByChild("createdAt").startAt(now).once("value");
    const created = [];
    if (snap.exists()) {
      for (const [id, v] of Object.entries(snap.val())) {
        if (v.createdAt === now) created.push({ id, ...v });
      }
    }
    res.status(201).json({ created: created.length ? created : true });
  } catch (e) {
    console.error("adjustments.bulkCreate error:", e);
    res.status(500).json({ error: "Failed to bulk create adjustments" });
  }
};
