// server/routes/tenants.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/tenants");

// guards *only* for non-register endpoints
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

// public bootstrap (optional — keep as-is if you want it public)
router.post("/register", ctrl.register);

// ✅ superadmin-only area
router.use(auth, requireRole("superadmin"));

router.get("/", ctrl.list);
router.get("/:tenantId", ctrl.getOne);
router.patch("/:tenantId", ctrl.update);
router.delete("/:tenantId", ctrl.remove);

module.exports = router;
