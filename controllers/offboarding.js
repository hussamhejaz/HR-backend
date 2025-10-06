// server/controllers/offboarding.js
const { db } = require("../config/firebaseAdmin");

/* --------------------------- helpers / wiring --------------------------- */
const getTenantId = (req) =>
  String(
    req.tenantId ||
      req.params.tenantId ||
      req.header("X-Tenant-Id") ||
      req.header("x-tenant-id") ||
      ""
  ).trim();

const refEmployees   = (tenantId) => db.ref(`tenants/${tenantId}/employees`);
const refOffboarding = (tenantId) => db.ref(`tenants/${tenantId}/offboarding`);
const asArray = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

const isValidDate = (s) => !Number.isNaN(new Date(String(s)).valueOf());
const toBool = (v) => (typeof v === "boolean" ? v : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const VALID_STATUS = new Set(["Active", "Completed", "Canceled"]);

/* ----------------------------- READ HELPERS ----------------------------- */
async function getEmployeeById(tenantId, employeeId) {
  if (!employeeId) return null;
  const snap = await refEmployees(tenantId).child(employeeId).once("value");
  if (!snap.exists()) return null;
  return { id: snap.key, ...snap.val() };
}

async function getOffbNode(tenantId, id) {
  const node = refOffboarding(tenantId).child(id);
  const snap = await node.once("value");
  if (!snap.exists()) return { node, snap: null, row: null };
  return { node, snap, row: { id: snap.key, ...snap.val() } };
}

/* --------------------------------- API --------------------------------- */

/**
 * POST /api/offboarding
 * body: {
 *   employeeId, reason, lastDay (YYYY-MM-DD), handoverTo, noticeServed (bool),
 *   checklist: { assetsReturned, emailDisabled, payrollCleared, accessRevoked, exitInterviewDone },
 *   notes, updateEmployee (bool)
 * }
 */
exports.create = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const {
      employeeId,
      reason = "",
      lastDay,
      handoverTo = "",
      noticeServed = false,
      checklist = {},
      notes = "",
      updateEmployee = false,
    } = req.body || {};

    if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
    if (!lastDay || !isValidDate(lastDay)) {
      return res.status(400).json({ error: "lastDay must be a valid date (YYYY-MM-DD)" });
    }

    const emp = await getEmployeeById(tenantId, employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found for this tenant" });

    if (emp.startDate && isValidDate(emp.startDate) && new Date(lastDay) < new Date(emp.startDate)) {
      return res.status(400).json({ error: "lastDay cannot be before employee startDate" });
    }

    const now = new Date().toISOString();
    const payload = {
      employeeId,
      employee: {
        id: emp.id,
        uid: emp.uid || "",
        fullName:
          `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.fullName || emp.name || "",
        email: emp.email || "",
        phone: emp.phone || "",
        roleTitle: emp.role || "",
        departmentId: emp.departmentId || "",
        department: emp.department || "",
        teamId: emp.teamId || "",
        teamName: emp.teamName || "",
        startDate: emp.startDate || null,
      },
      reason: String(reason || "").trim(),
      lastDay: String(lastDay),
      handoverTo: String(handoverTo || "").trim(),
      noticeServed: toBool(noticeServed),
      checklist: {
        assetsReturned: toBool(checklist.assetsReturned),
        emailDisabled: toBool(checklist.emailDisabled),
        payrollCleared: toBool(checklist.payrollCleared),
        accessRevoked: toBool(checklist.accessRevoked),
        exitInterviewDone: toBool(checklist.exitInterviewDone),
      },
      notes: String(notes || "").trim(),
      status: "Active", // ← match UI
      createdAt: now,
      updatedAt: now,
      createdBy: { uid: req.uid || "", email: req.user?.email || "" },
    };

    const ref = await refOffboarding(tenantId).push(payload);

    if (updateEmployee) {
      const patch = {
        status: "Offboarded",
        endDate: payload.lastDay,
        updatedAt: now,
        updatedBy: { uid: req.uid || "", email: req.user?.email || "" },
      };
      await refEmployees(tenantId).child(employeeId).update(patch);
    }

    const snap = await ref.once("value");
    res.status(201).json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("offboarding.create error:", e);
    res.status(500).json({ error: "Failed to create offboarding record" });
  }
};

/**
 * GET /api/offboarding
 * Optional query: employeeId=<id>
 */
exports.list = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { employeeId } = req.query;
    const snap = await refOffboarding(tenantId).once("value");
    let rows = asArray(snap.val() || {});
    if (employeeId) rows = rows.filter((r) => r.employeeId === String(employeeId));
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows);
  } catch (e) {
    console.error("offboarding.list error:", e);
    res.status(500).json({ error: "Failed to load offboarding records" });
  }
};

/**
 * GET /api/offboarding/:id
 */
exports.getOne = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { node, row } = await getOffbNode(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    console.error("offboarding.getOne error:", e);
    res.status(500).json({ error: "Failed to load offboarding record" });
  }
};

/**
 * PUT /api/offboarding/:id
 * body may include: reason, lastDay, handoverTo, noticeServed, checklist, notes, status
 */
exports.update = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { node, row } = await getOffbNode(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });

    const {
      reason,
      lastDay,
      handoverTo,
      noticeServed,
      checklist,
      notes,
      status,
    } = req.body || {};

    // validate lastDay if provided
    if (lastDay && !isValidDate(lastDay)) {
      return res.status(400).json({ error: "lastDay must be a valid date (YYYY-MM-DD)" });
    }
    // guard lastDay against employee startDate if available
    if (lastDay && row.employee?.startDate && isValidDate(row.employee.startDate)) {
      if (new Date(lastDay) < new Date(row.employee.startDate)) {
        return res.status(400).json({ error: "lastDay cannot be before employee startDate" });
      }
    }

    // validate status if provided
    if (typeof status !== "undefined" && !VALID_STATUS.has(String(status))) {
      return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUS].join(", ")}` });
    }

    const now = new Date().toISOString();
    const patch = { updatedAt: now };

    if (typeof reason !== "undefined") patch.reason = String(reason || "").trim();
    if (typeof lastDay !== "undefined") patch.lastDay = String(lastDay || "");
    if (typeof handoverTo !== "undefined") patch.handoverTo = String(handoverTo || "").trim();
    if (typeof noticeServed !== "undefined") patch.noticeServed = toBool(noticeServed);
    if (typeof notes !== "undefined") patch.notes = String(notes || "").trim();
    if (typeof status !== "undefined") patch.status = String(status);

    if (typeof checklist === "object" && checklist) {
      patch.checklist = {
        assetsReturned: toBool(checklist.assetsReturned ?? row.checklist?.assetsReturned),
        emailDisabled: toBool(checklist.emailDisabled ?? row.checklist?.emailDisabled),
        payrollCleared: toBool(checklist.payrollCleared ?? row.checklist?.payrollCleared),
        accessRevoked: toBool(checklist.accessRevoked ?? row.checklist?.accessRevoked),
        exitInterviewDone: toBool(checklist.exitInterviewDone ?? row.checklist?.exitInterviewDone),
      };
    }

    await node.update(patch);
    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("offboarding.update error:", e);
    res.status(500).json({ error: "Failed to update offboarding record" });
  }
};
/**
 * PUT /api/offboarding/:id
 * body may include: reason, lastDay, handoverTo, noticeServed, checklist, notes, status
 */
exports.update = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { node, row } = await getOffbNode(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });

    const {
      reason,
      lastDay,
      handoverTo,
      noticeServed,
      checklist,
      notes,
      status, // "Active" | "Completed" | "Canceled"
    } = req.body || {};

    // Validate lastDay if provided
    if (lastDay && !isValidDate(lastDay)) {
      return res.status(400).json({ error: "lastDay must be a valid date (YYYY-MM-DD)" });
    }
    // Guard: lastDay should not be before employee startDate
    if (lastDay && row.employee?.startDate && isValidDate(row.employee.startDate)) {
      if (new Date(lastDay) < new Date(row.employee.startDate)) {
        return res.status(400).json({ error: "lastDay cannot be before employee startDate" });
      }
    }

    // Validate status if provided
    if (typeof status !== "undefined" && !VALID_STATUS.has(String(status))) {
      return res.status(400).json({
        error: `status must be one of: ${[...VALID_STATUS].join(", ")}`,
      });
    }

    const now = new Date().toISOString();
    const patch = { updatedAt: now };

    if (typeof reason !== "undefined") patch.reason = String(reason || "").trim();
    if (typeof lastDay !== "undefined") patch.lastDay = String(lastDay || "");
    if (typeof handoverTo !== "undefined") patch.handoverTo = String(handoverTo || "").trim();
    if (typeof noticeServed !== "undefined") patch.noticeServed = toBool(noticeServed);
    if (typeof notes !== "undefined") patch.notes = String(notes || "").trim();
    if (typeof status !== "undefined") patch.status = String(status);

    if (typeof checklist === "object" && checklist) {
      patch.checklist = {
        assetsReturned: toBool(checklist.assetsReturned ?? row.checklist?.assetsReturned),
        emailDisabled: toBool(checklist.emailDisabled ?? row.checklist?.emailDisabled),
        payrollCleared: toBool(checklist.payrollCleared ?? row.checklist?.payrollCleared),
        accessRevoked: toBool(checklist.accessRevoked ?? row.checklist?.accessRevoked),
        exitInterviewDone: toBool(checklist.exitInterviewDone ?? row.checklist?.exitInterviewDone),
      };
    }

    // Persist record changes
    await node.update(patch);

    // ------- OPTIONAL: keep employee in sync with status -------
    // We use the latest effective lastDay (new one if provided, else existing)
    const effectiveLastDay = typeof patch.lastDay !== "undefined" ? patch.lastDay : row.lastDay;
    const empId = row.employeeId;
    if (empId) {
      if (typeof status !== "undefined") {
        if (status === "Completed") {
          // Mark employee offboarded and set endDate
          await refEmployees(tenantId).child(empId).update({
            status: "Offboarded",
            endDate: effectiveLastDay || row.lastDay || "",
            updatedAt: now,
            updatedBy: { uid: req.uid || "", email: req.user?.email || "" },
          });
        } else if (status === "Canceled") {
          // Revert employee back to active and clear endDate
          await refEmployees(tenantId).child(empId).update({
            status: "Active",
            endDate: "",
            updatedAt: now,
            updatedBy: { uid: req.uid || "", email: req.user?.email || "" },
          });
        }
        // If status is set back to "Active", we leave employee as-is (up to your policy).
      } else if (
        // If just lastDay changed while record is already Completed, keep employee endDate in sync
        typeof lastDay !== "undefined" &&
        String(row.status) === "Completed"
      ) {
        await refEmployees(tenantId).child(empId).update({
          endDate: effectiveLastDay || "",
          updatedAt: now,
          updatedBy: { uid: req.uid || "", email: req.user?.email || "" },
        });
      }
    }
    // -----------------------------------------------------------

    const after = await node.once("value");
    res.json({ id: after.key, ...after.val() });
  } catch (e) {
    console.error("offboarding.update error:", e);
    res.status(500).json({ error: "Failed to update offboarding record" });
  }
};
