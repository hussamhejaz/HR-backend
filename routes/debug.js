// server/routes/debug.js
const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");

router.use(auth, tenant);

router.get("/whoami", (req, res) => {
  res.json({
    uid: req.uid,
    tenantId: req.tenantId,
    tenantRole: req.tenantRole,
    headerTenant: req.header("x-tenant-id") || null,
  });
});

module.exports = router;
