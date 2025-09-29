// server/routes/auth.js
const express = require("express");
const router = express.Router();

router.use(express.json());

const ctrl = require("../controllers/auth");

// Public API login for mobile/web clients
router.post("/login", ctrl.login);

// (kept) Optional endpoint if you ever want to store fingerprint separately
// const auth = require("../middlewares/auth");
// const tenant = require("../middlewares/tenant");
// router.post("/store-token", auth, tenant, ctrl.storeToken);

module.exports = router;
