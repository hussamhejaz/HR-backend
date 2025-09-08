// server/routes/me.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const me = require("../controllers/me");

// Auth + tenant required, but NO admin-only gate here
router.use(auth, tenant);

router.get("/", me.profile);

module.exports = router;
