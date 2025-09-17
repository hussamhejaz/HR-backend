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
 * These routes let any authenticated member of the tenant submit and view
 * their own requests. No role needed beyond membership.
 */
router.post("/self/salary-requests", auth, tenant, upload.none(), ctrl.selfCreate);
router.get("/self/salary-requests", auth, tenant, ctrl.selfList);

/**
 * ADMIN / HR dashboard
 * Review and action requests.
 */
router.use(auth, tenant, requireRole("owner", "admin", "hr", "manager", "superadmin"));

router.get("/salary/requests", ctrl.list);
router.get("/salary/requests/:id", ctrl.getOne);
router.post("/salary/requests/:id/decision", upload.none(), ctrl.decide);
router.put("/salary/requests/:id", upload.none(), ctrl.update);

module.exports = router;
