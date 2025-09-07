// server/utils/publicJobsIndex.js
const { db } = require("../config/firebaseAdmin");

const PUBLIC_JOBS_PATH = "public/recruitment/jobs";

const jobPublicShape = (tenantId, jobId, j = {}) => ({
  id: jobId,
  tenantId,
  title: j.title || "",
  department: j.department || "",
  location: j.location || "",
  employmentType: j.employmentType || "",
  description: j.description || "",
  status: (j.status || "").trim(),
  createdAt: j.createdAt || new Date().toISOString(),
  updatedAt: j.updatedAt || new Date().toISOString(),
});

async function publishPublicJob(tenantId, jobId, jobData) {
  const payload = jobPublicShape(tenantId, jobId, jobData);
  await db.ref(`${PUBLIC_JOBS_PATH}/${jobId}`).set(payload);
}

async function unpublishPublicJob(jobId) {
  await db.ref(`${PUBLIC_JOBS_PATH}/${jobId}`).remove();
}

/** Publish “open” jobs; unpublish everything else */
async function syncPublicJob(tenantId, jobId, jobData = {}) {
  const status = String(jobData.status || "").trim().toLowerCase();
  const isHidden = jobData.isPublic === false;
  if (status === "open" && !isHidden) {
    await publishPublicJob(tenantId, jobId, jobData);
  } else {
    await unpublishPublicJob(jobId);
  }
}

module.exports = { publishPublicJob, unpublishPublicJob, syncPublicJob };
