// server/routes/public.js
const express = require("express");
const router = express.Router();

const pubRec = require("../controllers/publicRecruitment");

// No auth middleware here — public endpoints
router.get("/recruitment/jobs", pubRec.listJobs);
router.get("/recruitment/jobs/:jobId", pubRec.getJob);

module.exports = router;
