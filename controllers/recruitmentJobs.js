const { db } = require("../config/firebaseAdmin");
const { syncPublicJob, unpublishPublicJob } = require("../utils/publicJobsIndex");

// tenant collection
const refJobs = (tenantId) => db.ref(`tenants/${tenantId}/recruitment/jobs`);

// LIST (protected, tenant-scoped)
exports.list = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const snap = await refJobs(tenantId).once("value");
    const data = snap.val() || {};
    const list = Object.entries(data).map(([id, j]) => ({ id, ...j }));
    list.sort((a, b) =>
      (b.createdAt ? Date.parse(b.createdAt) : 0) -
      (a.createdAt ? Date.parse(a.createdAt) : 0)
    );
    res.json(list);
  } catch (e) {
    console.error("recruitmentJobs.list error:", e);
    res.status(500).json({ error: "Failed to load jobs" });
  }
};

// GET ONE (protected)
exports.getOne = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = req.params.id;
    const snap = await refJobs(tenantId).child(id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.key, ...snap.val() });
  } catch (e) {
    console.error("recruitmentJobs.getOne error:", e);
    res.status(500).json({ error: "Failed to load job" });
  }
};

// CREATE (protected) – sync public index
exports.create = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const body = req.body || {};
    const now = new Date().toISOString();

    const payload = {
      title: (body.title || "").trim(),
      department: body.department || "",
      location: body.location || "",
      employmentType: body.employmentType || "",
      description: body.description || "",
      status: (body.status || "open").trim(),
      isPublic: body.isPublic !== false, // default true
      createdAt: now,
      updatedAt: now,
    };

    const node = await refJobs(tenantId).push(payload);
    const snap = await node.once("value");
    const saved = { id: snap.key, ...snap.val() };

    await syncPublicJob(tenantId, saved.id, saved);
    res.status(201).json(saved);
  } catch (e) {
    console.error("recruitmentJobs.create error:", e);
    res.status(500).json({ error: "Failed to create job" });
  }
};

// UPDATE (protected) – re-sync public index
exports.update = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = req.params.id;
    const patch = { ...req.body, updatedAt: new Date().toISOString() };

    await refJobs(tenantId).child(id).update(patch);
    const snap = await refJobs(tenantId).child(id).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });

    const updated = { id: snap.key, ...snap.val() };
    await syncPublicJob(tenantId, updated.id, updated);

    res.json(updated);
  } catch (e) {
    console.error("recruitmentJobs.update error:", e);
    res.status(500).json({ error: "Failed to update job" });
  }
};

// DELETE (protected) – unpublish
exports.remove = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = req.params.id;

    await refJobs(tenantId).child(id).remove();
    await unpublishPublicJob(id);

    res.status(204).end();
  } catch (e) {
    console.error("recruitmentJobs.remove error:", e);
    res.status(500).json({ error: "Failed to delete job" });
  }
};
