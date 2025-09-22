// server/routes/attendance.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl = require("../controllers/attendanceQr");

// All attendance routes require auth + tenant
router.use(auth, tenant);

/**
 * Admin QR management
 * allowed roles: owner, admin, hr, manager, superadmin
 */
router.use("/qr", requireRole("owner", "admin", "hr", "manager", "superadmin"));
router.get("/qr", ctrl.list);
router.post("/qr", ctrl.create);
router.delete("/qr/:token", ctrl.revoke);

/**
 * Scanner endpoint (phone/iPad at the gate)
 * any authenticated user may scan; you can tighten with requireRole if needed
 */
router.post("/scan", ctrl.scan);

module.exports = router;
