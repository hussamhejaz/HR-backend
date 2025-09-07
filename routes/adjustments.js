// server/routes/adjustments.js
const router = require("express").Router();
const ctrl   = require("../controllers/adjustments");

// Example: /api/:tenantId/payroll/adjustments
router.get("/:tenantId/payroll/adjustments", ctrl.list);
router.post("/:tenantId/payroll/adjustments", ctrl.create);
router.get("/:tenantId/payroll/adjustments/:id", ctrl.getOne);
router.put("/:tenantId/payroll/adjustments/:id", ctrl.update);
router.delete("/:tenantId/payroll/adjustments/:id", ctrl.remove);


module.exports = router;
