// server/controllers/publicRecruitment.js
const { db } = require("../config/firebaseAdmin");

const PUBLIC_JOBS_PATH = "public/recruitment/jobs";
const refPublicJobs = () => db.ref(PUBLIC_JOBS_PATH);

// GET /public/recruitment/jobs
exports.listJobs = async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const department = (req.query.department || "").toString().trim().toLowerCase();
    const location   = (req.query.location   || "").toString().trim().toLowerCase();
    const empType    = (req.query.employmentType || "").toString().trim().toLowerCase();

    const snap = await refPublicJobs().once("value");
    const data = snap.val() || {};
    let list = Object.entries(data).map(([id, j]) => ({ id, ...j }));

    // defensive: public index is “open” only
    list = list.filter(j => String(j.status || "").trim().toLowerCase() === "open");

    if (q) list = list.filter(j =>
      [j.title, j.department, j.location, j.employmentType, j.description]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
    if (department)  list = list.filter(j => (j.department || "").toLowerCase() === department);
    if (location)    list = list.filter(j => (j.location   || "").toLowerCase() === location);
    if (empType)     list = list.filter(j => (j.employmentType || "").toLowerCase() === empType);

    list.sort((a, b) =>
      (b.createdAt ? Date.parse(b.createdAt) : 0) -
      (a.createdAt ? Date.parse(a.createdAt) : 0)
    );

    res.json(list);
  } catch (e) {
    console.error("publicRecruitment.listJobs error:", e);
    res.status(500).json({ error: "Failed to load jobs" });
  }
};

// GET /public/recruitment/jobs/:jobId
exports.getJob = async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const snap = await refPublicJobs().child(jobId).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const job = { id: snap.key, ...snap.val() };
    if (String(job.status || "").trim().toLowerCase() !== "open") {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(job);
  } catch (e) {
    console.error("publicRecruitment.getJob error:", e);
    res.status(500).json({ error: "Failed to load job" });
  }
};

// POST /public/recruitment/jobs/:jobId/apply
// body: { firstName, lastName, email, phone?, resumeUrl?, coverLetter? }
exports.apply = async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const jsnap = await refPublicJobs().child(jobId).once("value");
    if (!jsnap.exists()) return res.status(404).json({ error: "Job not found" });

    const job = jsnap.val();
    const tenantId = job.tenantId;
    if (!tenantId) return res.status(400).json({ error: "Job missing tenantId" });

    const {
      firstName = "",
      lastName  = "",
      email     = "",
      phone     = "",
      resumeUrl = "",
      coverLetter = "",
    } = req.body || {};

    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      return res.status(400).json({ error: "firstName, lastName, and email are required" });
    }

    const now = new Date().toISOString();
    const application = {
      jobId,
      jobTitle: job.title || "",
      tenantId,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.trim(),
      phone:     String(phone || "").trim(),
      resumeUrl,
      coverLetter,
      status: "Applied",
      source: "Careers Portal",
      createdAt: now,
      updatedAt: now,
    };

    // ✅ Write where admin API reads from:
    const node = db.ref(`tenants/${tenantId}/recruitment/applicants`).push();
    await node.set(application);
    const saved = (await node.once("value")).val();

    res.status(201).json({ id: node.key, ...saved });
  } catch (e) {
    console.error("publicRecruitment.apply error:", e);
    res.status(500).json({ error: "Failed to submit application" });
  }
};
