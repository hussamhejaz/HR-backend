
const admin = require("firebase-admin");
const { db } = require("../config/firebaseAdmin");

const slugify = (s = "") =>
  String(s)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const ensureUniqueTenantId = async (base) => {
  let id = base || Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < 8; i++) {
    const snap = await db.ref(`tenants/${id}/meta`).once("value");
    if (!snap.exists()) return id;
    id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
};

const validUsername = (u = "") => /^[a-z0-9](?:[a-z0-9._-]{2,30})$/.test(u);
const usernameToEmail = (u) => `${u}@tenant.invalid`;

// POST /api/tenants/register
const register = async (req, res) => {
  try {
    const { name, username, password, email, locale = "en", timezone = "UTC" } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!username || !validUsername(username.toLowerCase())) {
      return res.status(400).json({ error: "username is invalid" });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "password must be at least 8 chars" });
    }

    const uname = username.toLowerCase();
    const unameSnap = await db.ref(`usernames/${uname}`).once("value");
    if (unameSnap.exists()) return res.status(409).json({ error: "username already taken" });

    const authEmail = email?.trim() || usernameToEmail(uname);
    const userRecord = await admin.auth().createUser({
      email: authEmail,
      password,
      displayName: `${name} Owner`,
    });

    const baseId = slugify(name) || slugify(uname) || "tenant";
    const tenantId = await ensureUniqueTenantId(baseId);
    const now = Date.now();

    const meta = {
      name: String(name).trim(),
      locale,
      timezone,
      createdAt: now,
      updatedAt: now,
      ownerUid: userRecord.uid,
      ownerUsername: uname,
      ownerEmail: authEmail,
    };

    await db.ref().update({
      [`tenants/${tenantId}/meta`]: meta,
      [`memberships/${userRecord.uid}/${tenantId}`]: { role: "owner", createdAt: now },
      [`usernames/${uname}`]: { uid: userRecord.uid },
      [`users/${userRecord.uid}/profile`]: {
        username: uname,
        email: authEmail,
        displayName: userRecord.displayName || "",
        createdAt: now,
        // optionally make it default
        defaultTenantId: tenantId,
      },
      // ❌ no tenants/{tenantId}/data here
    });

    res.status(201).json({
      tenantId,
      owner: { uid: userRecord.uid, username: uname, email: authEmail },
      meta,
    });
  } catch (e) {
    console.error("tenants.register error:", e);
    res.status(500).json({ error: "Failed to register tenant" });
  }
};

// helpers
const list = async (_req, res) => {
  const snap = await db.ref("tenants").once("value");
  const data = snap.val() || {};
  const rows = Object.entries(data).map(([id, v]) => ({ id, ...(v.meta || {}) }));
  res.json(rows);
};
const getOne = async (req, res) => {
  const snap = await db.ref(`tenants/${req.params.tenantId}/meta`).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json({ id: req.params.tenantId, ...snap.val() });
};
const update = async (req, res) => {
  const ref = db.ref(`tenants/${req.params.tenantId}/meta`);
  const snap = await ref.once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  const payload = { ...req.body, updatedAt: Date.now() };
  await ref.update(payload);
  const after = await ref.once("value");
  res.json({ id: req.params.tenantId, ...after.val() });
};
const remove = async (req, res) => {
  await db.ref(`tenants/${req.params.tenantId}`).remove();
  res.status(204).end();
};

module.exports = { register, list, getOne, update, remove };
