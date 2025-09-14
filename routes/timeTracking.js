// server/routes/timeTracking.js
const express     = require("express");
const router      = express.Router({ mergeParams: true });

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/timeTracking");

router.use(auth, tenant);

// Employee: my own time entries
router.get("/mine", ctrl.mine);

// Summary
router.get("/summary", ctrl.summary);

// Admin/HR/Manager list all
router.get("/", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.list);

// Create (employee, or elevated on behalf using employeeId)
router.post("/", ctrl.create);

// Single entry
router.get("/:id", ctrl.getOne);

// Update (owner or elevated)
router.put("/:id", ctrl.update);

// Approve/Reject (elevated only)
router.patch("/:id/decision",
  requireRole("hr", "manager", "admin", "owner", "superadmin"),
  ctrl.decide
);

// NEW: progress (completed / not + note) — owner or elevated
router.patch("/:id/progress", ctrl.progress);

// Delete (owner pending, or elevated)
router.delete("/:id", ctrl.remove);

module.exports = router;
