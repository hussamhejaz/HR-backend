// server/routes/tenants.js
const express = require("express");
const router = express.Router();


const ctrl = require("../controllers/tenants");

router.post("/register", ctrl.register);  // must be a function
router.get("/", ctrl.list);
router.get("/:tenantId", ctrl.getOne);
router.patch("/:tenantId", ctrl.update);
router.delete("/:tenantId", ctrl.remove);

module.exports = router;
