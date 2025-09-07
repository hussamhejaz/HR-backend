// server/routes/publicRecruitment.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/publicRecruitment");

// Public, no auth
router.get("/recruitment/jobs", ctrl.listJobs);
router.get("/recruitment/jobs/:jobId", ctrl.getJob);
router.post("/recruitment/jobs/:jobId/apply", express.json(), ctrl.apply);

module.exports = router;
