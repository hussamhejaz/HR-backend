// server/controllers/attendanceQr.js
const { db } = require("../config/firebaseAdmin");

/* ------------------------------ helpers ------------------------------ */
function getTenantId(req) {
  const hdrTenant = req.header("X-Tenant-Id") || req.header("x-tenant-id") || "";
  return String(req.tenantId || req.params.tenantId || hdrTenant || "").trim();
}
const isISODate = (s) => !!s && !Number.isNaN(new Date(s).valueOf());

const refTokens   = (tenantId) => db.ref(`tenants/${tenantId}/attendance/qrTokens`);
const refLogs     = (tenantId) => db.ref(`tenants/${tenantId}/attendance/logs`);

/** small, URL-safe random token */
function makeToken(len = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/* -------------------------------- list -------------------------------- */
// GET /api/attendance/qr?siteId=&active=1
exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { siteId = "", active = "" } = req.query;

    const snap = await refTokens(tenantId).once("value");
    let list = [];
    if (snap.exists()) {
      list = Object.entries(snap.val()).map(([token, v]) => ({ token, ...v }));
    }

    if (siteId) list = list.filter((r) => (r.siteId || "") === siteId);
    if (active) {
      const now = Date.now();
      list = list.filter((r) => {
        const notExpired = !r.expiresAt || now <= Date.parse(r.expiresAt);
        const underMax   = !r.maxUses   || (typeof r.uses === "number" ? r.uses : 0) < r.maxUses;
        return notExpired && underMax && r.active !== false;
      });
    }

    // newest first
    list.sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0));
    res.json(list);
  } catch (e) {
    console.error("attendanceQr.list error:", e);
    res.status(500).json({ error: "Failed to load QR tokens" });
  }
};

/* ------------------------------- create ------------------------------- */
// POST /api/attendance/qr   { siteId, label?, expiresAt?, maxUses? }
exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const body = req.body || {};
    const siteId = String(body.siteId || "default");
    const label  = (body.label || "").toString().trim() || null;
    const expiresAt = body.expiresAt ? String(body.expiresAt) : null;
    const maxUsesRaw = body.maxUses;

    if (expiresAt && !isISODate(expiresAt)) {
      return res.status(400).json({ error: "expiresAt must be an ISO date string" });
    }

    let maxUses = null;
    if (maxUsesRaw !== undefined && maxUsesRaw !== null && maxUsesRaw !== "") {
      const n = Number(maxUsesRaw);
      if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: "maxUses must be an integer >= 1" });
      maxUses = n;
    }

    const token = makeToken(40);
    const nowISO = new Date().toISOString();
    const doc = {
      siteId,
      label,
      createdAt: nowISO,
      updatedAt: nowISO,
      expiresAt: expiresAt || null,
      maxUses: maxUses || null,
      uses: 0,
      active: true,
    };

    await refTokens(tenantId).child(token).set(doc);
    res.status(201).json({ token, ...doc });
  } catch (e) {
    console.error("attendanceQr.create error:", e);
    res.status(500).json({ error: "Failed to create QR token" });
  }
};

/* ------------------------------- revoke ------------------------------- */
// DELETE /api/attendance/qr/:token
exports.revoke = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const token = req.params.token;
    const node = refTokens(tenantId).child(token);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    await node.update({ active: false, updatedAt: new Date().toISOString() });
    res.status(204).end();
  } catch (e) {
    console.error("attendanceQr.revoke error:", e);
    res.status(500).json({ error: "Failed to revoke token" });
  }
};

/* ------------------------------ scan/use ------------------------------ */
// POST /api/attendance/scan { token, action: "in"|"out" }
// (Optional) client may send X-User-Email to improve logs; user uid comes from auth middleware.
exports.scan = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { token, action } = req.body || {};
    const act = String(action || "").toLowerCase();
    if (!token) return res.status(400).json({ error: "token is required" });
    if (!["in", "out"].includes(act)) return res.status(400).json({ error: "action must be 'in' or 'out'" });

    // Load token
    const tokenNode = refTokens(tenantId).child(token);
    const tSnap = await tokenNode.once("value");
    if (!tSnap.exists()) return res.status(404).json({ error: "Invalid token" });

    const t = tSnap.val();
    const now = new Date();
    if (t.active === false) return res.status(410).json({ error: "Token revoked" });
    if (t.expiresAt && now > new Date(t.expiresAt)) return res.status(410).json({ error: "Token expired" });
    if (t.maxUses && (typeof t.uses === "number" ? t.uses : 0) >= t.maxUses) {
      return res.status(409).json({ error: "Token max uses reached" });
    }

    // Who scanned?
    const u = req.user || {};
    const log = {
      at: now.toISOString(),
      by: { uid: u.uid || null, email: u.email || req.header("X-User-Email") || null },
      siteId: t.siteId || "default",
      token,
      action: act, // "in" | "out"
      userAgent: req.get("user-agent") || null,
      ip: req.ip || req.headers["x-forwarded-for"] || null,
    };

    // Write log and bump counters atomically-ish
    await Promise.all([
      refLogs(tenantId).push(log),
      tokenNode.update({
        uses: (typeof t.uses === "number" ? t.uses : 0) + 1,
        updatedAt: now.toISOString(),
      }),
    ]);

    res.json({ ok: true, log });
  } catch (e) {
    console.error("attendanceQr.scan error:", e);
    res.status(500).json({ error: "Failed to record scan" });
  }
};
