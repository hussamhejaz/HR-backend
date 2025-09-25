// server/routes/adjustments.js
const router = require("express").Router({ mergeParams: true });
const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const ctrl = require("../controllers/adjustments");

// All adjustments endpoints require auth + tenant
router.use(auth, tenant);

// Mounted at: /api/payroll/adjustments
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

// Bulk create: POST /api/payroll/adjustments/bulk
router.post("/bulk", ctrl.bulkCreate);

module.exports = router;
