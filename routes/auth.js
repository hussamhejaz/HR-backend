// server/routes/auth.js
const express = require("express");
const router = express.Router();

router.use(express.json());

const ctrl = require("../controllers/auth");
const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");

// Public API login for mobile clients
router.post("/login", ctrl.login);

// Store a hashed fingerprint of the current ID token
router.post("/store-token", auth, tenant, ctrl.storeToken);

module.exports = router;
