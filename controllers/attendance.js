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

      // Optional: geofence enforcement if token has geo bounds
      if (t.geo && t.geo.lat != null && t.geo.lng != null && t.geo.radiusMeters != null) {
        if (lat == null || lng == null) {
          return res.status(400).json({ error: "Location required for this QR" });
        }
        const within = haversineMeters(Number(lat), Number(lng), Number(t.geo.lat), Number(t.geo.lng)) <= Number(t.geo.radiusMeters);
        if (!within) return res.status(403).json({ error: "Outside allowed area for this QR" });
      }
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

      // Optional: geofence enforcement
      if (t.geo && t.geo.lat != null && t.geo.lng != null && t.geo.radiusMeters != null) {
        if (lat == null || lng == null) {
          return res.status(400).json({ error: "Location required for this QR" });
        }
        const within = haversineMeters(Number(lat), Number(lng), Number(t.geo.lat), Number(t.geo.lng)) <= Number(t.geo.radiusMeters);
        if (!within) return res.status(403).json({ error: "Outside allowed area for this QR" });
      }
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
 * GET /api/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD&employeeId=
 * Admin/HR list across employees
 */
exports.listRange = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { from = "", to = "", employeeId = "" } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    if (to < from) return res.status(400).json({ error: "to must be >= from" });

    const snap = await refAttendance(tenantId).once("value");
    const byDate = snap.val() || {};
    const out = [];

    for (const [date, employees] of Object.entries(byDate)) {
      if (date < from || date > to) continue;
      if (!employees) continue;
      for (const [empId, rec] of Object.entries(employees)) {
        if (employeeId && empId !== employeeId) continue;
        out.push({ id: `${date}/${empId}`, date, employeeId: empId, ...rec });
      }
    }

    out.sort((a, b) =>
      a.date === b.date ? (a.employeeId > b.employeeId ? 1 : -1) : (a.date < b.date ? 1 : -1)
    );
    res.json(out);
  } catch (e) {
    console.error("attendance.listRange error:", e);
    res.status(500).json({ error: "Failed to load attendance range" });
  }
};


/* ----------------------------- geo helpers ----------------------------- */
/** Haversine distance in meters */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
