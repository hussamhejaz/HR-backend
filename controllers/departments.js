// server/controllers/departments.js
const { db } = require("../config/firebaseAdmin");

const slugify = (s = "") =>
  String(s)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const getTenantId = (req) =>
  String(req.tenantId || req.params.tenantId || req.header("X-Tenant-Id") || "").trim();

const refDepartments = (tenantId) => db.ref(`tenants/${tenantId}/departments`);

const findBySlug = async (tenantId, slug) => {
  const snap = await refDepartments(tenantId).once("value");
  const data = snap.val() || {};
  const entry = Object.entries(data).find(
    ([, d]) => (d.slug || slugify(d.name || "")) === slug
  );
  return entry ? { id: entry[0], ...entry[1] } : null;
};

exports.list = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const q = String(req.query.q || "").trim().toLowerCase();
  const snap = await refDepartments(tenantId).once("value");
  const data = snap.val() || {};
  let list = Object.entries(data).map(([id, d]) => ({ id, ...d }));
  if (q) {
    list = list.filter(
      (d) =>
        String(d.name || "").toLowerCase().includes(q) ||
        String(d.head || "").toLowerCase().includes(q) ||
        String(d.code || "").toLowerCase().includes(q)
    );
  }
  res.json(list);
};

exports.getOne = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const snap = await refDepartments(tenantId).child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json({ id: snap.key, ...snap.val() });
};

exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { name, head = "", code = "", location = "", description = "", color = "#4f46e5" } =
      req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    const slug = slugify(name);
    const dup = await findBySlug(tenantId, slug);
    if (dup) {
      return res.status(409).json({ error: "Department name already exists" });
    }

    const now = new Date().toISOString();
    const payload = {
      name: String(name).trim(),
      head,
      code,
      location,
      description,
      color,
      slug,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await refDepartments(tenantId).push(payload);
    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("create department error:", e);
    res.status(500).json({ error: "Failed to create department" });
  }
};

exports.update = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const id = req.params.id;
    const upd = { ...req.body, updatedAt: new Date().toISOString() };

    if (typeof upd.name === "string" && upd.name.trim()) {
      const newSlug = slugify(upd.name);
      const dup = await findBySlug(tenantId, newSlug);
      if (dup && dup.id !== id) {
        return res.status(409).json({ error: "Department name already exists" });
      }
      upd.slug = newSlug;
    }

    await refDepartments(tenantId).child(id).update(upd);
    const snap = await refDepartments(tenantId).child(id).once("value");
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("update department error:", e);
    res.status(500).json({ error: "Failed to update department" });
  }
};

exports.remove = async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  await refDepartments(tenantId).child(req.params.id).remove();
  res.status(204).end();
};
