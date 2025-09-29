// server/controllers/resignations.js
const { v4: uuidv4 } = require("uuid");
const { db, bucket } = require("../config/firebaseAdmin");

/* --------------------------- helpers / wiring --------------------------- */
const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

const refResigs    = (tenantId) => db.ref(`tenants/${tenantId}/resignations`);
const refEmployees = (tenantId) => db.ref(`tenants/${tenantId}/employees`);
const refNotifies  = (tenantId) => db.ref(`tenants/${tenantId}/notifications`);

const asArray = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const isElevated = (req) => {
  const r = String(req.tenantRole || "").toLowerCase();
  return ["hr", "manager", "admin", "owner", "superadmin"].includes(r);
};

const toBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v || "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
};

const isValidDate = (s) => !Number.isNaN(new Date(String(s)).valueOf());
const diffDays = (from, to) => {
  const d0 = new Date(from);
  const d1 = new Date(to);
  // calendar day difference (inclusive)
  return Math.max(0, Math.floor((d1 - d0) / 86400000) + 1);
};

async function findEmployeeByUid(tenantId, uid) {
  if (!uid) return null;
  const snap = await refEmployees(tenantId).orderByChild("uid").equalTo(uid).once("value");
  if (!snap.exists()) return null;
  const [id, val] = Object.entries(snap.val())[0];
  return { id, ...val };
}

/* ------------------------------ uploads -------------------------------- */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = (ct) => /^image\//.test(ct) || ct === "application/pdf";
const sanitize = (s) => String(s || "").replace(/[^\w.\-]+/g, "_");

function collectFiles(req) {
  const bag = req.files || {};
  const files = [
    ...(bag.attachments || []),
    ...(bag.files || []),
    ...(bag["files[]"] || []),
    ...(bag.images || []),
    ...(bag.image || []),
    ...(bag.photo || []),
    ...(bag.pdfs || []),
    ...(bag.pdf || []),
  ].filter(Boolean);
  return files;
}

async function uploadToStorage({ tenantId, resigId, files }) {
  const out = [];
  for (const f of files) {
    if (!ACCEPT(f.mimetype)) {
      console.warn("skip file (mime):", f.originalname, f.mimetype);
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      console.warn("skip file (size):", f.originalname, f.size);
      continue;
    }

    const safeName = sanitize(f.originalname || `file_${Date.now()}`);
    const dest = `tenants/${tenantId}/resignations/${resigId}/${Date.now()}_${safeName}`;
    const file = bucket.file(dest);
    const downloadToken = uuidv4();

    await file.save(f.buffer, {
      metadata: {
        contentType: f.mimetype,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
      public: false,
      validation: "crc32c",
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      dest
    )}?alt=media&token=${downloadToken}`;

    out.push({
      fileName: f.originalname,
      contentType: f.mimetype,
      size: f.size,
      bucket: bucket.name,
      path: dest,
      downloadUrl,
      token: downloadToken,
      uploadedAt: new Date().toISOString(),
    });
  }
  return out;
}

/* --------------------------------- API --------------------------------- */

/**
 * GET /api/offboarding/resignations/mine
 */
exports.mine = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refResigs(tenantId)
      .orderByChild("employee/uid")
      .equalTo(req.uid)
      .once("value");

    let rows = asArray(snap.val() || {});
    const { status, from, to } = req.query;

    if (status) {
      const s = String(status).toLowerCase();
      rows = rows.filter((r) => String(r.status || "").toLowerCase() === s);
    }
    if (from) rows = rows.filter((r) => new Date(r.createdAt) >= new Date(from));
    if (to)   rows = rows.filter((r) => new Date(r.createdAt) <= new Date(to));

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows);
  } catch (e) {
    console.error("resignations.mine error:", e);
    res.status(500).json({ error: "Failed to load my resignations" });
  }
};

/**
 * GET /api/offboarding/resignations
 * Query: status, q, from, to, limit
 */
exports.list = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, q = "", from, to, limit } = req.query;
    const snap = await refResigs(tenantId).once("value");
    let rows = asArray(snap.val() || {});

    if (status) {
      const s = String(status).toLowerCase();
      rows = rows.filter((r) => String(r.status || "").toLowerCase() === s);
    }
    if (q) {
      const term = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [
          r.employee?.fullName,
          r.employee?.email,
          r.type,
          r.reason,
          r.handoverPlan,
          r.contactPhone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }
    if (from) rows = rows.filter((r) => new Date(r.createdAt) >= new Date(from));
    if (to)   rows = rows.filter((r) => new Date(r.createdAt) <= new Date(to));

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const n = parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("resignations.list error:", e);
    res.status(500).json({ error: "Failed to load resignations" });
  }
};

/**
 * GET /api/offboarding/resignations/:id
 */
exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refResigs(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = { id: snap.key, ...snap.val() };
    // non-elevated can only see their own
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(row);
  } catch (e) {
    console.error("resignations.getOne error:", e);
    res.status(500).json({ error: "Failed to load resignation" });
  }
};

/**
 * POST /api/offboarding/resignations
 * Accepts JSON or multipart/form-data with images/PDFs.
 */
exports.create = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const me = await findEmployeeByUid(tenantId, req.uid);
    if (!me) return res.status(404).json({ error: "Employee profile not found for this tenant" });

    const {
      type = "Standard",
      lastWorkingDay,
      reason = "",
      handoverPlan = "",
      contactPhone = "",
      confirmReturnProperty = false,
      understandNoticePeriod = false,
      notifyManager = false,
    } = req.body || {};

    if (!String(type).trim()) return res.status(400).json({ error: "type is required" });
    if (!isValidDate(lastWorkingDay)) {
      return res.status(400).json({ error: "lastWorkingDay must be a valid date (YYYY-MM-DD)" });
    }

    const now = new Date().toISOString();
    const todayYMD = new Date().toISOString().slice(0, 10);
    const noticeDays = diffDays(todayYMD, lastWorkingDay);

    const basePayload = {
      type: String(type),
      status: "Pending", // Pending | Approved | Rejected | Cancelled
      submittedOn: now,
      createdAt: now,
      updatedAt: now,

      lastWorkingDay: String(lastWorkingDay),
      noticeDays, // calculated (calendar inclusive)
      reason: String(reason || "").trim(),
      handoverPlan: String(handoverPlan || "").trim(),
      contactPhone: String(contactPhone || "").trim(),

      confirmReturnProperty: toBool(confirmReturnProperty),
      understandNoticePeriod: toBool(understandNoticePeriod),

      attachments: [],
      attachmentsCount: 0,

      employee: {
        uid: me.uid || req.uid,
        id: me.id,
        fullName: `${me.firstName || ""} ${me.lastName || ""}`.trim() || me.fullName || "",
        email: me.email || "",
        phone: me.phone || "",
        roleTitle: me.role || "",
        departmentId: me.departmentId || "",
        department: me.department || "",
        teamId: me.teamId || "",
        teamName: me.teamName || "",
      },

      decision: null, // { by, at, status, notes, approvedLastWorkingDay?, noticeWaived? }
    };

    // Create first to get ID
    const ref = await refResigs(tenantId).push(basePayload);
    const resigId = ref.key;

    // Upload attachments (if any)
    const rawFiles = collectFiles(req);
    if (rawFiles.length) {
      const attachments = await uploadToStorage({ tenantId, resigId, files: rawFiles });
      await ref.update({
        attachments,
        attachmentsCount: attachments.length,
        updatedAt: new Date().toISOString(),
      });
    }

    // Optional notification for HR/manager
    if (toBool(notifyManager)) {
      await refNotifies(tenantId).push({
        kind: "resignation.created",
        resignationId: resigId,
        employee: basePayload.employee,
        status: "Pending",
        createdAt: now,
      });
    }

    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("resignations.create error:", e);
    res.status(500).json({ error: "Failed to submit resignation" });
  }
};

/**
 * PATCH /api/offboarding/resignations/:id/decision
 * body: { status: "Approved"|"Rejected", notes?, approvedLastWorkingDay?, noticeWaived? }
 */
exports.decide = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refResigs(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const { status, notes = "", approvedLastWorkingDay, noticeWaived = false } = req.body || {};
    if (!["Approved", "Rejected"].includes(String(status))) {
      return res.status(400).json({ error: "status must be Approved or Rejected" });
    }

    const patch = {
      status: String(status),
      updatedAt: new Date().toISOString(),
      decision: {
        by: { uid: req.uid, email: req.user?.email || "" },
        at: new Date().toISOString(),
        status: String(status),
        notes: String(notes || "").trim() || null,
        approvedLastWorkingDay: approvedLastWorkingDay && isValidDate(approvedLastWorkingDay)
          ? approvedLastWorkingDay
          : null,
        noticeWaived: toBool(noticeWaived),
      },
    };

    // If HR overrides last working day, keep both
    if (patch.decision.approvedLastWorkingDay) {
      patch.lastWorkingDayApproved = patch.decision.approvedLastWorkingDay;
    }

    await node.update(patch);
    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("resignations.decide error:", e);
    res.status(500).json({ error: "Failed to update resignation" });
  }
};

/**
 * PATCH /api/offboarding/resignations/:id/cancel
 * Employee can cancel own pending resignation
 */
exports.cancel = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refResigs(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = snap.val();
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (row.status !== "Pending") {
      return res.status(400).json({ error: "Only pending resignations can be cancelled" });
    }

    const now = new Date().toISOString();
    await node.update({ status: "Cancelled", updatedAt: now, cancelledAt: now, cancelledBy: req.uid });
    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("resignations.cancel error:", e);
    res.status(500).json({ error: "Failed to cancel resignation" });
  }
};
exports.latestMine = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refResigs(tenantId)
      .orderByChild("employee/uid")
      .equalTo(req.uid)
      .once("value");

    const rows = asArray(snap.val() || {});
    if (!rows.length) return res.status(404).json({ error: "No resignations found" });

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows[0]);
  } catch (e) {
    console.error("resignations.latestMine error:", e);
    res.status(500).json({ error: "Failed to load latest resignation" });
  }
};
exports.status = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refResigs(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = { id: snap.key, ...snap.val() };
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // return a slim view
    res.json({
      id: row.id,
      status: row.status,
      lastWorkingDay: row.lastWorkingDay || null,
      updatedAt: row.updatedAt || row.createdAt || null,
      decision: row.decision ? {
        status: row.decision.status,
        at: row.decision.at || null,
        notes: row.decision.notes || null
      } : null
    });
  } catch (e) {
    console.error("resignations.status error:", e);
    res.status(500).json({ error: "Failed to load status" });
  }
};
// --- Add this helper near the bottom of your helpers section ---
async function getResigNode(tenantId, id) {
  const node = refResigs(tenantId).child(id);
  const snap = await node.once("value");
  if (!snap.exists()) return { node, snap: null, row: null };
  return { node, snap, row: snap.val() };
}

// Normalized status guard (add UnderProcess to your status model)
const VALID_FINAL_DECISIONS = new Set(["Approved", "Rejected"]);
const VALID_TRANSITIONS = new Set(["Pending", "UnderProcess", "Approved", "Rejected", "Cancelled"]);

// --- New generic updater used by accept/reject/underProcess ---
async function applyStatus({ req, res, status, options = {} }) {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { id } = req.params;
    const { node, row } = await getResigNode(tenantId, id);
    if (!row) return res.status(404).json({ error: "Not found" });

    if (!VALID_TRANSITIONS.has(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }

    const nowIso = new Date().toISOString();
    const patch = { status, updatedAt: nowIso };

    // For UnderProcess we keep a lightweight review object, not a final decision
    if (status === "UnderProcess") {
      const notes = String(options.notes || req.body?.notes || "").trim() || null;
      patch.review = {
        by: { uid: req.uid, email: req.user?.email || "" },
        at: nowIso,
        notes,
      };
      // clear any prior decision if you want a clean slate while processing
      // (comment out next line if you prefer to keep old decision visible)
      patch.decision = null;
    }

    // For final decisions (Approved/Rejected) build a proper decision object
    if (VALID_FINAL_DECISIONS.has(status)) {
      const notes = String(options.notes ?? req.body?.notes ?? "").trim() || null;
      const approvedLastWorkingDay =
        options.approvedLastWorkingDay ?? req.body?.approvedLastWorkingDay;
      const noticeWaived = options.noticeWaived ?? req.body?.noticeWaived ?? false;

      patch.decision = {
        by: { uid: req.uid, email: req.user?.email || "" },
        at: nowIso,
        status,
        notes,
        approvedLastWorkingDay:
          approvedLastWorkingDay && isValidDate(approvedLastWorkingDay)
            ? approvedLastWorkingDay
            : null,
        noticeWaived: toBool(noticeWaived),
      };

      if (patch.decision.approvedLastWorkingDay) {
        patch.lastWorkingDayApproved = patch.decision.approvedLastWorkingDay;
      }
    }

    await node.update(patch);
    const after = await node.once("value");
    return res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("resignations.applyStatus error:", e);
    return res.status(500).json({ error: "Failed to update status" });
  }
}

// --- New explicit handlers ---
exports.markUnderProcess = (req, res) =>
  applyStatus({ req, res, status: "UnderProcess" });

exports.accept = (req, res) =>
  applyStatus({
    req,
    res,
    status: "Approved",
    options: {
      notes: req.body?.notes,
      approvedLastWorkingDay: req.body?.approvedLastWorkingDay,
      noticeWaived: req.body?.noticeWaived,
    },
  });

exports.reject = (req, res) =>
  applyStatus({
    req,
    res,
    status: "Rejected",
    options: { notes: req.body?.notes },
  });

