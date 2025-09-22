// server/controllers/attendance.js
const { db } = require("../config/firebaseAdmin");

/* ------------------------------- helpers ------------------------------- */
function getTenantId(req) {
  const hdrTenant = req.header("X-Tenant-Id") || req.header("x-tenant-id") || "";
  return String(req.tenantId || req.params.tenantId || hdrTenant || "").trim();
}

const getActor = (req) => {
  const u = req.user || {};
  return { uid: u.uid || null, email: u.email || req.header("X-User-Email") || null };
};

const ymd = (d = new Date()) => {
  const x = new Date(typeof d === "string" ? d : d.valueOf());
  const m = `${x.getMonth() + 1}`.padStart(2, "0");
  const day = `${x.getDate()}`.padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
};

const refEmployees   = (tenantId) => db.ref(`tenants/${tenantId}/employees`);
const refQrTokens    = (tenantId) => db.ref(`tenants/${tenantId}/attendance/qrTokens`);
const refAttendance  = (tenantId) => db.ref(`tenants/${tenantId}/attendance/records`);

async function findEmployeeByUid(tenantId, uid) {
  if (!uid) return null;
  const snap = await refEmployees(tenantId).orderByChild("uid").equalTo(uid).once("value");
  if (!snap.exists()) return null;
  const [id] = Object.keys(snap.val());
  return { id, ...snap.val()[id] };
}

function randomToken(len = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let t = "";
  for (let i = 0; i < len; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

/* --------------------------- QR token (admin) --------------------------- */
/**
 * POST /api/attendance/qr
 * body: { siteId?: string, durationSec?: number (default 300), label?: string }
 * returns: { token, expiresAt, siteId, label }
 *
 * The returned `token` is what you render as a QR code string.
 * Employees will scan -> your front-end POSTs token to /check-in or /check-out.
 */
exports.issueQr = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { siteId = "default", durationSec = 300, label = "" } = req.body || {};
    const ttl = Math.max(60, Math.min(Number(durationSec) || 300, 3600)); // min 1m, max 1h
    const now = Date.now();
    const expiresAt = new Date(now + ttl * 1000).toISOString();

    const token = randomToken(40);
    const doc = {
      token,
      siteId,
      label: String(label || "").trim() || null,
      createdBy: getActor(req),
      createdAt: new Date(now).toISOString(),
      expiresAt,
      active: true,
    };

    await refQrTokens(tenantId).child(token).set(doc);
    res.status(201).json(doc);
  } catch (e) {
    console.error("attendance.issueQr error:", e);
    res.status(500).json({ error: "Failed to issue QR" });
  }
};

/**
 * GET /api/attendance/qr
 * returns list of active/expired tokens (latest first)
 */
exports.listQr = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refQrTokens(tenantId).once("value");
    const list = snap.exists()
      ? Object.entries(snap.val()).map(([token, v]) => ({ token, ...v }))
      : [];
    list.sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0));
    res.json(list);
  } catch (e) {
    console.error("attendance.listQr error:", e);
    res.status(500).json({ error: "Failed to load QR tokens" });
  }
};

/**
 * DELETE /api/attendance/qr/:token
 * revoke a token immediately
 */
exports.revokeQr = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const token = req.params.token;

    await refQrTokens(tenantId).child(token).update({ active: false, revokedAt: new Date().toISOString() });
    res.status(204).end();
  } catch (e) {
    console.error("attendance.revokeQr error:", e);
    res.status(500).json({ error: "Failed to revoke QR" });
  }
};

/* ------------------------- Check-in / Check-out ------------------------- */
/**
 * POST /api/attendance/check-in
 * body: { token?: string, lat?: number, lng?: number, note?: string }
 */
exports.checkIn = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const actor = getActor(req);
    const me = await findEmployeeByUid(tenantId, actor.uid);
    if (!me) return res.status(404).json({ error: "Employee record not found for current user" });

    const { token = "", lat = null, lng = null, note = "" } = req.body || {};

    // Validate QR token if provided
    let siteId = null;
    if (token) {
      const tSnap = await refQrTokens(tenantId).child(token).once("value");
      if (!tSnap.exists()) return res.status(400).json({ error: "Invalid QR token" });
      const t = tSnap.val();
      if (!t.active) return res.status(400).json({ error: "QR token is revoked" });
      if (t.expiresAt && Date.parse(t.expiresAt) < Date.now())
        return res.status(400).json({ error: "QR token expired" });
      siteId = t.siteId || null;
    }

    const today = ymd();
    const node = refAttendance(tenantId).child(`${today}/${me.id}`);

    const nowISO = new Date().toISOString();
    const payload = {
      checkInAt: nowISO,
      checkInSource: token ? "qr" : "manual",
      checkInSiteId: siteId,
      checkInGeo: lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null,
      checkInNote: String(note || "").trim() || null,
      updatedAt: nowISO,
    };

    const snap = await node.once("value");
    const existing = snap.val() || {};

    if (existing.checkInAt) {
      return res.status(400).json({ error: "Already checked in today" });
    }

    // initialize record
    const doc = {
      date: today,
      employeeId: me.id,
      createdAt: existing.createdAt || nowISO,
      ...existing,
      ...payload,
    };

    await node.set(doc);
    res.status(201).json({ id: `${today}/${me.id}`, ...doc });
  } catch (e) {
    console.error("attendance.checkIn error:", e);
    res.status(500).json({ error: "Failed to check in" });
  }
};

/**
 * POST /api/attendance/check-out
 * body: { token?: string, lat?: number, lng?: number, note?: string }
 */
exports.checkOut = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const actor = getActor(req);
    const me = await findEmployeeByUid(tenantId, actor.uid);
    if (!me) return res.status(404).json({ error: "Employee record not found for current user" });

    const { token = "", lat = null, lng = null, note = "" } = req.body || {};

    // Validate QR token if provided
    let siteId = null;
    if (token) {
      const tSnap = await refQrTokens(tenantId).child(token).once("value");
      if (!tSnap.exists()) return res.status(400).json({ error: "Invalid QR token" });
      const t = tSnap.val();
      if (!t.active) return res.status(400).json({ error: "QR token is revoked" });
      if (t.expiresAt && Date.parse(t.expiresAt) < Date.now())
        return res.status(400).json({ error: "QR token expired" });
      siteId = t.siteId || null;
    }

    const today = ymd();
    const node = refAttendance(tenantId).child(`${today}/${me.id}`);

    const nowISO = new Date().toISOString();
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(400).json({ error: "No check-in found for today" });

    const existing = snap.val();

    if (existing.checkOutAt) {
      return res.status(400).json({ error: "Already checked out today" });
    }

    // if check-in exists and check-out time is before check-in (clock skew), block
    if (existing.checkInAt && Date.parse(nowISO) < Date.parse(existing.checkInAt)) {
      return res.status(400).json({ error: "Invalid time (before check-in)" });
    }

    const patch = {
      checkOutAt: nowISO,
      checkOutSource: token ? "qr" : "manual",
      checkOutSiteId: siteId,
      checkOutGeo: lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null,
      checkOutNote: String(note || "").trim() || null,
      updatedAt: nowISO,
    };

    await node.update(patch);
    const after = await node.once("value");
    res.json({ id: `${today}/${me.id}`, ...after.val() });
  } catch (e) {
    console.error("attendance.checkOut error:", e);
    res.status(500).json({ error: "Failed to check out" });
  }
};

/* ------------------------------- listing ------------------------------- */
/**
 * GET /api/attendance/me?from=YYYY-MM-DD&to=YYYY-MM-DD
 * returns current user's attendance records
 */
exports.myAttendance = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const actor = getActor(req);
    const me = await findEmployeeByUid(tenantId, actor.uid);
    if (!me) return res.status(404).json({ error: "Employee record not found for current user" });

    const { from = "", to = "" } = req.query;

    const snap = await refAttendance(tenantId).once("value");
    const all = snap.val() || {};
    const list = [];

    Object.entries(all).forEach(([date, byEmp]) => {
      if (from && date < from) return;
      if (to && date > to) return;
      if (byEmp && byEmp[me.id]) list.push({ id: `${date}/${me.id}`, ...byEmp[me.id] });
    });

    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(list);
  } catch (e) {
    console.error("attendance.myAttendance error:", e);
    res.status(500).json({ error: "Failed to load attendance" });
  }
};

/**
 * GET /api/attendance?employeeId=&from=&to=
 * Admin list over range (or for one employee)
 */
exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { employeeId = "", from = "", to = "" } = req.query;

    const snap = await refAttendance(tenantId).once("value");
    const all = snap.val() || {};
    const list = [];

    Object.entries(all).forEach(([date, byEmp]) => {
      if (from && date < from) return;
      if (to && date > to) return;
      Object.entries(byEmp || {}).forEach(([eid, rec]) => {
        if (employeeId && eid !== employeeId) return;
        list.push({ id: `${date}/${eid}`, ...rec });
      });
    });

    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(list);
  } catch (e) {
    console.error("attendance.list error:", e);
    res.status(500).json({ error: "Failed to load attendance" });
  }
};
