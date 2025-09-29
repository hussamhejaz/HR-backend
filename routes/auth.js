// server/routes/auth.js
const express = require("express");
const router = express.Router();

router.use(express.json());

const ctrl = require("../controllers/auth");

// Public API login for mobile clients (now can store device token)
router.post("/login", ctrl.login);

// Keep the separate fingerprint endpoint (uses auth+tenant middlewares inside controller)
router.post("/store-token", ctrl.storeToken);

module.exports = router;
