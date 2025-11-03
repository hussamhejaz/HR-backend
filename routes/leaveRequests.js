// server/routes/leave.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 12 }, // 10MB / file
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype) || file.mimetype === "application/pdf";
    if (!ok) return cb(new Error("Only images and PDFs are allowed"), false);
    cb(null, true);
  },
});

// Accept common field names (mobile/Postman)
const FIELDS = [
  { name: "attachments", maxCount: 12 },
  { name: "files",       maxCount: 12 },
  { name: "files[]",     maxCount: 12 },
  { name: "images",      maxCount: 12 },
  { name: "image",       maxCount: 12 },
  { name: "photo",       maxCount: 12 },
  { name: "pdfs",        maxCount: 12 },
  { name: "pdf",         maxCount: 12 },
];

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/leaveRequests");

// IMPORTANT: auth + tenant before any routes
router.use(auth, tenant);

// Employee: my own requests
router.get("/mine", ctrl.mine);

// Admin/HR/Manager list all
router.get("/", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.list);

// Create (JSON or multipart). Multer only runs for multipart/form-data automatically.
router.post("/", upload.fields(FIELDS), ctrl.create);

// Read single
router.get("/:id", ctrl.getOne);

// Decisions (approve / reject)
router.patch(
  "/:id/decision",
  requireRole("hr", "manager", "admin", "owner", "superadmin"),
  ctrl.decide
);
router.delete(
  "/:id",
  requireRole("hr", "manager", "admin", "owner", "superadmin"),
  ctrl.remove
);


// Employee cancels own pending request
router.patch("/:id/cancel", ctrl.cancel);

module.exports = router;
