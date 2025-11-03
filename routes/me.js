// server/routes/me.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const me = require("../controllers/me");

// auth only (no tenant middleware)
router.use(auth);
router.get("/", me.profile);

module.exports = router;







