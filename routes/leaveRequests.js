// server/routes/leaveRequests.js
const router = require("express").Router();
const ctrl = require("../controllers/leaveRequests");
const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");

// All endpoints require auth + tenant
router.use(auth, tenant);

// Employee (and above)
router.get("/mine",             requireRole("employee", "hr", "manager", "admin", "superadmin"), ctrl.mine);
router.post("/",                requireRole("employee", "hr", "manager", "admin", "superadmin"), ctrl.create);
router.get("/:id",              requireRole("employee", "hr", "manager", "admin", "superadmin"), ctrl.getOne);
router.patch("/:id/cancel",     requireRole("employee", "hr", "manager", "admin", "superadmin"), ctrl.cancel);

// HR/Manager/Admin views + decisions
router.get("/",                 requireRole("hr", "manager", "admin", "superadmin"), ctrl.list);
router.patch("/:id/decision",   requireRole("hr", "manager", "admin", "superadmin"), ctrl.decide);

module.exports = router;
