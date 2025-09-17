// server/routes/salaryGrades.js
const express     = require("express");
const router      = express.Router({ mergeParams: true });

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/salaryGrades");

router.use(auth, tenant);

router.get("/",    requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.list);
router.post("/",   requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.create);
router.get("/:id", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.getOne);
router.put("/:id", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.update);
router.delete("/:id", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.remove);

module.exports = router;
