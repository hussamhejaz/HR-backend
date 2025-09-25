// server/routes/calendar.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const { db } = require("../config/firebaseAdmin");

// Helpers
function getTenantId(req) {
  return String(
    req.tenantId || req.params.tenantId || req.header("X-Tenant-Id") || ""
  ).trim();
}
function refHolidays(tenantId) {
  // per-tenant storage in Firebase RTDB
  return db.ref(`tenants/${tenantId}/calendar/holidays`);
}
function normalizeHoliday(input) {
  // Allow either { id, title, date } or full range { start, end }
  // Always store: { title, start, end, country?, region?, createdAt, updatedAt }
  const now = Date.now();
  const title = String(input.title || "").trim();
  const start = String(input.start || input.date || "").trim();
  const end   = String(input.end || input.date || start || "").trim();
  const country = input.country || null;
  const region  = input.region || null;

  if (!title) throw new Error("title is required");
  if (!start) throw new Error("start (YYYY-MM-DD) is required");

  return {
    title,
    start, // YYYY-MM-DD
    end,   // YYYY-MM-DD (inclusive)
    country,
    region,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function inRange(holiday, fromYMD, toYMD) {
  // simple date-string (YYYY-MM-DD) comparison
  const s = holiday.start;
  const e = holiday.end || holiday.start;
  return !(e < fromYMD || s > toYMD);
}

/* -------------------- Public health check -------------------- */
router.get("/health", (req, res) => res.json({ ok: true }));

/* -------------------- All routes below require auth & tenant -------------------- */
router.use(auth, tenant);

/* -------------------- List all holidays -------------------- */
router.get("/holidays", requireRole("owner","admin","hr","manager","superadmin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refHolidays(tenantId).once("value");
    const data = snap.val() || {};
    const items = Object.entries(data).map(([id, v]) => ({ id, ...v }));
    // newest first
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    res.json(items);
  } catch (e) {
    console.error("[calendar] list error:", e);
    res.status(500).json({ error: "Failed to list holidays" });
  }
});

/* -------------------- List holidays within a date range -------------------- */
router.get("/holidays/range", requireRole("owner","admin","hr","manager","superadmin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const from = String(req.query.from || "").slice(0, 10);
    const to   = String(req.query.to   || "").slice(0, 10);
    if (!from || !to) return res.status(400).json({ error: "from & to (YYYY-MM-DD) are required" });

    const snap = await refHolidays(tenantId).once("value");
    const data = snap.val() || {};
    const items = Object.entries(data)
      .map(([id, v]) => ({ id, ...v }))
      .filter(h => inRange(h, from, to))
      .sort((a, b) => (a.start < b.start ? -1 : 1));

    res.json(items);
  } catch (e) {
    console.error("[calendar] range error:", e);
    res.status(500).json({ error: "Failed to load holiday range" });
  }
});

/* -------------------- Create a holiday -------------------- */
router.post("/holidays", requireRole("owner","admin","hr","manager","superadmin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const payload = normalizeHoliday(req.body || {});
    const ref = await refHolidays(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("[calendar] create error:", e);
    res.status(400).json({ error: e.message || "Failed to create holiday" });
  }
});

/* -------------------- Update a holiday -------------------- */
router.put("/holidays/:id", requireRole("owner","admin","hr","manager","superadmin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refHolidays(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    // allow partial: if client sends only title/start/end…
    const current = snap.val() || {};
    const merged = normalizeHoliday({ ...current, ...req.body, createdAt: current.createdAt });
    await node.set(merged);
    const fresh = await node.once("value");
    res.json({ id: fresh.key, ...fresh.val() });
  } catch (e) {
    console.error("[calendar] update error:", e);
    res.status(400).json({ error: e.message || "Failed to update holiday" });
  }
});

/* -------------------- Delete a holiday -------------------- */
router.delete("/holidays/:id", requireRole("owner","admin","hr","manager","superadmin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    await refHolidays(tenantId).child(req.params.id).remove();
    res.status(204).end();
  } catch (e) {
    console.error("[calendar] delete error:", e);
    res.status(500).json({ error: "Failed to delete holiday" });
  }
});

module.exports = router; // <-- IMPORTANT: export the router FUNCTION
