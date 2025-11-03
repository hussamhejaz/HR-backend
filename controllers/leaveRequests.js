// server/controllers/leaveRequests.js
const { v4: uuidv4 } = require("uuid");
const { db, bucket } = require("../config/firebaseAdmin");
const { notify } = require("../utils/notify");

const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

const refLeaves    = (tenantId) => db.ref(`tenants/${tenantId}/leaveRequests`);
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

const ALLOWED_TYPES = new Set(["Annual", "Sick", "Unpaid", "Emergency", "Other"]);
const isValidDate   = (s) => !Number.isNaN(new Date(String(s)).valueOf());

const diffDays = (from, to, halfStart, halfEnd) => {
  const d0 = new Date(from);
  const d1 = new Date(to);
  let days = Math.floor((d1 - d0) / 86400000) + 1; // inclusive
  if (halfStart) days -= 0.5;
  if (halfEnd)   days -= 0.5;
  return Math.max(0.5, days);
};

async function findEmployeeByUid(tenantId, uid) {
  const snap = await refEmployees(tenantId).orderByChild("uid").equalTo(uid).once("value");
  if (!snap.exists()) return null;
  const [id, val] = Object.entries(snap.val())[0];
  return { id, ...val };
}

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

async function uploadToStorage({ tenantId, requestId, files }) {
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
    const dest = `tenants/${tenantId}/leaveRequests/${requestId}/${Date.now()}_${safeName}`;
    const file = bucket.file(dest);

    const downloadToken = uuidv4();

    // NOTE: contentType belongs inside metadata
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

// ---------- controllers ----------

exports.mine = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, from, to } = req.query;

    const snap = await refLeaves(tenantId)
      .orderByChild("employee/uid")
      .equalTo(req.uid)
      .once("value");

    let rows = asArray(snap.val() || {});
    if (status) {
      const s = String(status).toLowerCase();
      rows = rows.filter((r) => String(r.status || "").toLowerCase() === s);
    }
    if (from) rows = rows.filter((r) => new Date(r.from) >= new Date(from));
    if (to)   rows = rows.filter((r) => new Date(r.to)   <= new Date(to));
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(rows);
  } catch (e) {
    console.error("leave.mine error:", e);
    res.status(500).json({ error: "Failed to load leave requests" });
  }
};

exports.list = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, q = "", from, to, limit } = req.query;
    const snap = await refLeaves(tenantId).once("value");
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
          r.notes,
          r.destination,
          r.contact,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }
    if (from) rows = rows.filter((r) => new Date(r.from) >= new Date(from));
    if (to)   rows = rows.filter((r) => new Date(r.to)   <= new Date(to));
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const n = Number.parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0) rows = rows.slice(0, n);

    res.json(rows);
  } catch (e) {
    console.error("leave.list error:", e);
    res.status(500).json({ error: "Failed to load leave requests" });
  }
};

exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const snap = await refLeaves(tenantId).child(req.params.id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = { id: snap.key, ...snap.val() };
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(row);
  } catch (e) {
    console.error("leave.getOne error:", e);
    res.status(500).json({ error: "Failed to load leave request" });
  }
};

exports.create = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const {
      type,
      paid,
      from,
      to,
      halfDayStart = false,
      halfDayEnd = false,
      reason = "",
      destination = "",
      contact = "",
      notes = "",
      notifyManager = false,
    } = req.body || {};

    if (!ALLOWED_TYPES.has(String(type || ""))) {
      return res.status(400).json({ error: "Invalid leave type" });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ error: "from and to must be valid dates (YYYY-MM-DD)" });
    }
    if (new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "'from' cannot be after 'to'" });
    }
    if (!String(reason).trim())  return res.status(400).json({ error: "reason is required" });
    if (!String(contact).trim()) return res.status(400).json({ error: "contact is required" });

    const employee = await findEmployeeByUid(tenantId, req.uid);
    if (!employee) return res.status(404).json({ error: "Employee profile not found for this tenant" });

    const now  = new Date().toISOString();
    const days = diffDays(from, to, toBool(halfDayStart), toBool(halfDayEnd));

    // Log what multer parsed (helps if attachments aren't showing up)
    console.log("create leave: files keys:", Object.keys(req.files || {}));
    if (req.files) {
      for (const [k, arr] of Object.entries(req.files)) {
        console.log(`  field ${k}: ${Array.isArray(arr) ? arr.length : 0} file(s)`);
      }
    }
    console.log("create leave: body keys:", Object.keys(req.body || {}));

    // 1) Create the request first to get an ID
    const basePayload = {
      type: String(type),
      paid: toBool(paid),
      from: String(from),
      to: String(to),
      halfDayStart: toBool(halfDayStart),
      halfDayEnd: toBool(halfDayEnd),
      days,

      reason: String(reason).trim(),
      destination: String(destination || "").trim(),
      contact: String(contact).trim(),
      notes: String(notes || "").trim(),

      notifyManager: toBool(notifyManager),

      attachments: [],
      attachmentsCount: 0,

      status: "Pending",
      createdAt: now,
      updatedAt: now,

      employee: {
        uid: employee.uid || req.uid,
        id: employee.id,
        fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
        email: employee.email || "",
        phone: employee.phone || "",
        roleTitle: employee.role || "",
        departmentId: employee.departmentId || "",
        department: employee.department || "",
        teamId: employee.teamId || "",
        teamName: employee.teamName || "",
      },
    };

    const ref = await refLeaves(tenantId).push(basePayload);
    const requestId = ref.key;

    // 2) Upload any files (images/pdf) to Storage
    const rawFiles = collectFiles(req);
    let attachments = [];
    if (rawFiles.length > 0) {
      console.log("uploading", rawFiles.length, "file(s) to Storage…");
      attachments = await uploadToStorage({ tenantId, requestId, files: rawFiles });
      await ref.update({
        attachments,
        attachmentsCount: attachments.length,
        updatedAt: new Date().toISOString(),
      });
    } else {
      console.log("no files attached");
    }

    const snap = await ref.once("value");

    // Optional: write notification row
    if (toBool(notifyManager)) {
      await refNotifies(tenantId).push({
        kind: "leave.request",
        requestId,
        employee: basePayload.employee,
        status: "Pending",
        createdAt: now,
      });
    }

    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("leave.create error:", e);
    res.status(500).json({ error: "Failed to create leave request" });
  }
};

// Decisions (approve / reject)
exports.decide = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { status, decisionNotes = "" } = req.body || {};
    const S = String(status || "");
    if (!["Approved", "Rejected"].includes(S)) {
      return res.status(400).json({ error: "status must be Approved or Rejected" });
    }

    const node = refLeaves(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const before = snap.val();
    const now = new Date().toISOString();

    await node.update({
      status: S,
      decisionNotes: String(decisionNotes || "").trim(),
      decidedAt: now,
      decidedBy: { uid: req.uid, email: req.user?.email || "" },
      updatedAt: now,
    });

    const after = await node.once("value");
    const row = { id: after.key, ...after.val() };

    // --- NEW: notify the employee about the decision ---
    const toUid = row.employee?.uid;
    if (toUid) {
      const title = S === "Approved" ? "Leave request approved" : "Leave request rejected";
      const amountTxt = row.days != null ? ` (${row.days} day${row.days === 1 ? "" : "s"})` : "";
      const body  = S === "Approved"
        ? `Your ${row.type || "Leave"} request${amountTxt} has been approved.`
        : `Your ${row.type || "Leave"} request${amountTxt} was rejected.${row.decisionNotes ? " Notes: " + row.decisionNotes : ""}`;

      // Optional: adjust the link to whatever route shows the request in your UI
      await notify({
        tenantId,
        toUid,
        type: S === "Approved" ? "leave.approved" : "leave.rejected",
        title,
        body,
        link: `/self/leave/${row.id}`,           // <-- change if your front-end path is different
        meta: { id: row.id, status: S, type: row.type || "", days: String(row.days || "") },
      });
    }

    res.json(row);
  } catch (e) {
    console.error("leave.decide error:", e);
    res.status(500).json({ error: "Failed to update request" });
  }
};


exports.cancel = async (req, res) => {
  try {
    if (!req.uid) return res.status(401).json({ error: "Unauthenticated" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refLeaves(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = snap.val();
    if (!isElevated(req) && row?.employee?.uid !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (row.status !== "Pending") {
      return res.status(400).json({ error: "Only pending requests can be cancelled" });
    }

    const now = new Date().toISOString();
    await node.update({ status: "Cancelled", updatedAt: now, cancelledAt: now, cancelledBy: req.uid });
    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("leave.cancel error:", e);
    res.status(500).json({ error: "Failed to cancel request" });
  }
};
// Hard-delete a leave request (admin/HR/manager/owner/superadmin)
exports.remove = async (req, res) => {
  try {
    if (!isElevated(req)) return res.status(403).json({ error: "Forbidden" });
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const node = refLeaves(tenantId).child(req.params.id);
    const snap = await node.once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const row = snap.val();

    // Best-effort delete of attachments from Storage
    const atts = Array.isArray(row.attachments) ? row.attachments : Object.values(row.attachments || {});
    for (const a of atts) {
      const p = a?.path;
      if (p) {
        try {
          await bucket.file(p).delete({ ignoreNotFound: true });
        } catch (e) {
          console.warn("leave.remove: failed to delete file", p, e?.message || e);
        }
      }
    }

    // Remove the DB node
    await node.remove();

    // 204 No Content to match the front-end expectation
    return res.status(204).send();
  } catch (e) {
    console.error("leave.remove error:", e);
    return res.status(500).json({ error: "Failed to delete leave request" });
  }
};
