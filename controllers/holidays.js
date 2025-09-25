// server/controllers/holidays.js
const { db } = require("../config/firebaseAdmin");

// Resolve tenantId from middleware, path param, or header
function getTenantId(req) {
  return String(
    req.tenantId || req.params.tenantId || req.header("X-Tenant-Id") || ""
  ).trim();
}

function refHolidays(tenantId) {
  return db.ref(`tenants/${tenantId}/holidays`);
}

// GET /api/calendar/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refHolidays(tenantId).once("value");
    const all = snap.val() || {};
    const items = Object.entries(all).map(([id, h]) => ({ id, ...h }));

    const { from, to } = req.query;
    let out = items;
    if (from || to) {
      const fromT = from ? new Date(from).getTime() : -Infinity;
      const toT   = to   ? new Date(to).getTime()   :  Infinity;
      out = items.filter(h => {
        const t = new Date(h.date).getTime();
        return Number.isFinite(t) && t >= fromT && t <= toT;
      });
    }

    // Sort by date asc
    out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    res.json(out);
  } catch (e) {
    console.error("holidays.list error:", e);
    res.status(500).json({ error: "Failed to load holidays" });
  }
};

// POST /api/calendar/holidays
// { date: "YYYY-MM-DD", name: "Eid al-Fitr", type: "public" }
exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { date, name, type = "public" } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Valid `date` (YYYY-MM-DD) is required" });
    }

    const payload = {
      date,
      name: name || "Holiday",
      type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ref = await refHolidays(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("holidays.create error:", e);
    res.status(500).json({ error: "Failed to create holiday" });
  }
};

// DELETE /api/calendar/holidays/:id
exports.remove = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    await refHolidays(tenantId).child(req.params.id).remove();
    res.status(204).end();
  } catch (e) {
    console.error("holidays.remove error:", e);
    res.status(500).json({ error: "Failed to delete holiday" });
  }
};
