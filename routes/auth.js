// server/routes/auth.js
const express = require("express");
const router = express.Router();

router.use(express.json());
const ctrl = require("../controllers/auth");

// Public API login for mobile clients
router.post("/login", ctrl.login);

module.exports = router;
