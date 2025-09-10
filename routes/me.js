// server/routes/me.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const me = require("../controllers/me");

// IMPORTANT: auth only (no tenant middleware here)
router.use(auth);

router.get("/", me.profile);        // returns memberships + currentTenantId

module.exports = router;
