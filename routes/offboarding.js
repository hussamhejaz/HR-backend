// server/routes/offboarding.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth   = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");

const ctrl = require("../controllers/offboarding");

// Require auth + tenant for all offboarding actions
router.use(auth, tenant);

// Create new offboarding record (matches your form)
router.post("/", ctrl.create);

// List offboarding records (optionally by employeeId)
router.get("/", ctrl.list);

// Get one
router.get("/:id", ctrl.getOne);

// Update (PUT) — fixes your 404 on /api/offboarding/:id
router.put("/:id", ctrl.update);

module.exports = router;
