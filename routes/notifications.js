const express = require("express");
const router  = express.Router({ mergeParams: true });

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/notifications");

// All notification endpoints require auth + tenant
router.use(auth, tenant);

/* -------------------------- Device token endpoints -------------------------- */
router.post("/tokens",        ctrl.registerToken);   // register/update a token for current user
router.get("/tokens/mine",    ctrl.listMyTokens);    // list my tokens

// DELETE by explicit id
router.delete("/tokens/:id",  ctrl.deleteToken);
// DELETE by body.token (no :id in path)
router.delete("/tokens",      ctrl.deleteToken);

/* ----------------------------- Send notifications -------------------------- */
router.post("/test", ctrl.sendTestToMe);

router.post(
  "/send",
  requireRole("hr", "manager", "admin", "owner", "superadmin"),
  ctrl.send
);

module.exports = router;
