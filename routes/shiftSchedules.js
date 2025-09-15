const express     = require("express");
const router      = express.Router({ mergeParams: true });

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/shiftSchedules");

/* -------------------- inline validators (no extra deps) -------------------- */

const bad = (res, msg) => res.status(400).json({ error: msg });

const isValidDate = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(new Date(s).valueOf());

const isValidTime = (s) => {
  if (typeof s !== "string" || !/^\d{2}:\d{2}$/.test(s)) return false;
  const [hh, mm] = s.split(":").map((x) => Number(x));
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
};

function validateListQuery(req, res, next) {
  const { from, to, published, acknowledged, employeeId, limit } = req.query;

  if (from && !isValidDate(from)) return bad(res, "Invalid 'from' (YYYY-MM-DD)");
  if (to && !isValidDate(to)) return bad(res, "Invalid 'to' (YYYY-MM-DD)");

  if (published !== undefined && !["true", "false"].includes(String(published))) {
    return bad(res, "Invalid 'published' (true|false)");
  }
  if (acknowledged !== undefined && !["true", "false"].includes(String(acknowledged))) {
    return bad(res, "Invalid 'acknowledged' (true|false)");
  }
  if (employeeId !== undefined && String(employeeId).trim() === "") {
    return bad(res, "Invalid 'employeeId'");
  }
  if (limit !== undefined) {
    const n = Number.parseInt(limit, 10);
    if (Number.isNaN(n) || n <= 0) return bad(res, "Invalid 'limit' (positive integer)");
  }
  next();
}

function validateCreate(req, res, next) {
  const { date, startTime, endTime, employeeId } = req.body || {};
  if (!isValidDate(date)) return bad(res, "date (YYYY-MM-DD) is required");
  if (!isValidTime(startTime)) return bad(res, "startTime (HH:MM) is required");
  if (!isValidTime(endTime)) return bad(res, "endTime (HH:MM) is required");
  if (startTime >= endTime) return bad(res, "endTime must be after startTime");
  if (!employeeId || String(employeeId).trim() === "") {
    return bad(res, "employeeId is required");
  }
  next();
}

function validateUpdate(req, res, next) {
  const { date, startTime, endTime, published, employeeId } = req.body || {};
  if (date !== undefined && !isValidDate(date)) return bad(res, "Invalid date (YYYY-MM-DD)");
  if (startTime !== undefined && !isValidTime(startTime)) return bad(res, "Invalid startTime (HH:MM)");
  if (endTime !== undefined && !isValidTime(endTime)) return bad(res, "Invalid endTime (HH:MM)");
  if (startTime !== undefined && endTime !== undefined && startTime >= endTime) {
    return bad(res, "endTime must be after startTime");
  }
  if (published !== undefined && typeof published !== "boolean") {
    return bad(res, "published must be boolean");
  }
  if (employeeId !== undefined && String(employeeId).trim() === "") {
    return bad(res, "Invalid employeeId");
  }
  next();
}

function validateAck(req, res, next) {
  const { acknowledged } = req.body || {};
  if (acknowledged === undefined) return bad(res, "acknowledged (boolean) is required");
  if (typeof acknowledged !== "boolean") return bad(res, "acknowledged must be boolean");
  next();
}

/* -------------------- routes -------------------- */

router.use(auth, tenant);

// List the current user's assigned shifts
router.get("/mine", validateListQuery, ctrl.mine);

// Elevated list of all shifts
router.get("/", requireRole("hr", "manager", "admin", "owner", "superadmin"), validateListQuery, ctrl.list);

// Create shift (elevated)
router.post("/", requireRole("hr", "manager", "admin", "owner", "superadmin"), validateCreate, ctrl.create);

// Read one shift (employee can read own, elevated can read any)
router.get("/:id", ctrl.getOne);

// Update shift (elevated)
router.put("/:id", requireRole("hr", "manager", "admin", "owner", "superadmin"), validateUpdate, ctrl.update);

// Employee acknowledges (or un-acknowledges) assigned shift, with optional note
router.patch("/:id/ack", validateAck, ctrl.acknowledge);

// Delete shift (elevated)
router.delete("/:id", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.remove);

module.exports = router;
