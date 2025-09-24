// server/routes/salaryRequests.js
const express = require("express");
const multer = require("multer");
const upload = multer();

const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl = require("../controllers/salaryRequests");

const router = express.Router({ mergeParams: true });

/**
 * SELF-SERVICE (employees)
 * Mounted under /api/salary (see server.js)
 * Resulting paths:
 *   POST /api/salary/self/salary-requests
 *   GET  /api/salary/self/salary-requests
 */
router.post("/self/salary-requests", auth, tenant, upload.none(), ctrl.selfCreate);
router.get("/self/salary-requests", auth, tenant, ctrl.selfList);

/**
 * ADMIN / HR dashboard (requires role)
 * Resulting paths:
 *   GET    /api/salary/requests
 *   GET    /api/salary/requests/:id
 *   POST   /api/salary/requests/:id/decision
 *   PATCH  /api/salary/requests/:id
 *   PUT    /api/salary/requests/:id          // optional, kept for compatibility
 */
router.use(auth, tenant, requireRole("owner", "admin", "hr", "manager", "superadmin"));

router.get("/requests", ctrl.list);
router.get("/requests/:id", ctrl.getOne);
router.post("/requests/:id/decision", upload.none(), ctrl.decide);

// Support both PATCH and PUT (frontend uses PATCH)
router.patch("/requests/:id", upload.none(), ctrl.update);
router.put("/requests/:id", upload.none(), ctrl.update);

module.exports = router;
