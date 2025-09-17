// server/controllers/salaryGrades.js
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

const refGrades = (tenantId) => db.ref(`tenants/${tenantId}/salaryGrades`);

const asArray = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const isElevated = (req) => {
  const r = String(req.tenantRole || "").toLowerCase();
  return ["hr", "manager", "admin", "owner", "superadmin"].includes(r);
};

const normalize = (id, g) => ({
  id,
  name: String(g.name || ""),
  code: String(g.code || ""),
  level: g.level === "" || g.level === undefined ? null : Number(g.level),
  currency: String(g.currency || "USD").toUpperCase(),
  minSalary: Number(g.minSalary) || 0,
  maxSalary: Number(g.maxSalary) || 0,
  allowances: g.allowances || {},       // { housing: 0, transport: 0, ... }
  benefits: Array.isArray(g.benefits) ? g.benefits : [], // ["Health", "Gym", ...]
  effectiveFrom: g.effectiveFrom || null, // YYYY-MM-DD
  active: g.active === undefined ? true : Boolean(g.active),
  createdAt: g.createdAt || null,
  updatedAt: g.updatedAt || null,
});

const isValidDate = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(new Date(s).valueOf());

function validatePayload(body, isUpdate = false) {
  const err = (msg) => ({ ok: false, error: msg });

  const {
    name,
    level,
    currency = "USD",
    minSalary,
    maxSalary,
    effectiveFrom,
    allowances,
    benefits,
    active,
  } = body || {};

  if (!isUpdate) {
    if (!name || String(name).trim() === "") return err("name is required");
  }
  if (level !== undefined && level !== null && Number.isNaN(Number(level))) {
    return err("level must be a number");
  }
  if (minSalary !== undefined && (Number.isNaN(Number(minSalary)) || Number(minSalary) < 0)) {
    return err("minSalary must be a non-negative number");
  }
  if (maxSalary !== undefined && (Number.isNaN(Number(maxSalary)) || Number(maxSalary) < 0)) {
    return err("maxSalary must be a non-negative number");
  }
  if (minSalary !== undefined && maxSalary !== undefined && Number(minSalary) > Number(maxSalary)) {
    return err("maxSalary must be >= minSalary");
  }
  if (currency !== undefined && String(currency).trim().length < 3) {
    return err("currency must be a 3-letter code");
  }
  if (effectiveFrom !== undefined && effectiveFrom !== null && !isValidDate(effectiveFrom)) {
    return err("effectiveFrom must be YYYY-MM-DD");
  }
  if (benefits !== undefined && !Array.isArray(benefits)) {
    return err("benefits must be an array");
  }
  if (allowances !== undefined && typeof allowances !== "object") {
    return err("allowances must be an object");
  }
  if (active !== undefined && typeof active !== "boolean") {
    return err("active must be boolean");
  }

  return { ok: true };
}

/* -------------------- controllers -------------------- */

// GET /api/payroll/grades
// Query: q, level, active (true|false), limit
exports.list = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { q, level, active, limit } = req.query;

    const snap = await refGrades(tenantId).once("value");
    let rows = asArray(snap.val() || {}).map((r) => normalize(r.id, r));

    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((g) =>
        [g.name, g.code].filter(Boolean).join(" ").toLowerCase().includes(term)
      );
    }
    if (level !== undefined) {
      const L = Number(level);
      if (!Number.isNaN(L)) rows = rows.filter((g) => Number(g.level) === L);
    }
    if (active !== undefined) {
      const A = String(active) === "true";
      rows = rows.filter((g) => g.active === A);
    }

    rows.sort((a, b) => {
      // sort by level (nulls last), then name
      const la = a.level ?? Infinity;
      const lb = b.level ?? Infinity;
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("grades.list error:", e);
    res.status(500).json({ error: "Failed to load salary grades" });
  }
};

// GET /api/payroll/grades/:id
exports.getOne = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refGrades(tenantId).child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    res.json(normalize(snap.key, snap.val()));
  } catch (e) {
    console.error("grades.getOne error:", e);
    res.status(500).json({ error: "Failed to load salary grade" });
  }
};

// POST /api/payroll/grades
exports.create = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const v = validatePayload(req.body, false);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const now = new Date().toISOString();
    const payload = {
      name: String(req.body.name || "").trim(),
      code: String(req.body.code || "").trim(),
      level: req.body.level === "" || req.body.level === undefined ? null : Number(req.body.level),
      currency: String(req.body.currency || "USD").toUpperCase(),
      minSalary: Number(req.body.minSalary) || 0,
      maxSalary: Number(req.body.maxSalary) || 0,
      allowances: req.body.allowances || {},
      benefits: Array.isArray(req.body.benefits) ? req.body.benefits : [],
      effectiveFrom: req.body.effectiveFrom || null,
      active: req.body.active === undefined ? true : Boolean(req.body.active),
      createdAt: now,
      updatedAt: now,
    };

    const ref = await refGrades(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json(normalize(snap.key, snap.val()));
  } catch (e) {
    console.error("grades.create error:", e);
    res.status(500).json({ error: "Failed to create salary grade" });
  }
};

// PUT /api/payroll/grades/:id
exports.update = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refGrades(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const v = validatePayload(req.body, true);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const updates = {};
    const set = (k, val) => {
      if (val !== undefined) updates[k] = val;
    };

    set("name", req.body.name && String(req.body.name).trim());
    set("code", req.body.code !== undefined ? String(req.body.code).trim() : undefined);
    if (req.body.level !== undefined)
      set("level", req.body.level === "" || req.body.level === null ? null : Number(req.body.level));
    if (req.body.currency !== undefined) set("currency", String(req.body.currency).toUpperCase());
    if (req.body.minSalary !== undefined) set("minSalary", Number(req.body.minSalary));
    if (req.body.maxSalary !== undefined) set("maxSalary", Number(req.body.maxSalary));
    if (req.body.allowances !== undefined) set("allowances", req.body.allowances || {});
    if (req.body.benefits !== undefined)
      set("benefits", Array.isArray(req.body.benefits) ? req.body.benefits : []);
    if (req.body.effectiveFrom !== undefined) set("effectiveFrom", req.body.effectiveFrom || null);
    if (req.body.active !== undefined) set("active", Boolean(req.body.active));

    updates.updatedAt = new Date().toISOString();

    await node.update(updates);
    const after = await node.once("value");
    res.json(normalize(after.key, after.val()));
  } catch (e) {
    console.error("grades.update error:", e);
    res.status(500).json({ error: "Failed to update salary grade" });
  }
};

// DELETE /api/payroll/grades/:id
exports.remove = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refGrades(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    await node.remove();
    res.status(204).end();
  } catch (e) {
    console.error("grades.remove error:", e);
    res.status(500).json({ error: "Failed to delete salary grade" });
  }
};
