// server/routes/resignations.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 15 }, // 10MB / file, max 15 files
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype) || file.mimetype === "application/pdf";
    if (!ok) return cb(new Error("Only images and PDFs are allowed"), false);
    cb(null, true);
  },
});

// common field names (mobile/web)
const FIELDS = [
  { name: "attachments", maxCount: 15 },
  { name: "files",       maxCount: 15 },
  { name: "files[]",     maxCount: 15 },
  { name: "images",      maxCount: 15 },
  { name: "image",       maxCount: 15 },
  { name: "photo",       maxCount: 15 },
  { name: "pdfs",        maxCount: 15 },
  { name: "pdf",         maxCount: 15 },
];

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/resignations");

// global: auth + tenant required for everything here
router.use(auth, tenant);

/* ------------------------ employee self-service ------------------------ */
// create (JSON or multipart form-data)
router.post("/", upload.fields(FIELDS), ctrl.create);
// my own submissions
router.get("/mine", ctrl.mine);
// cancel while Pending
router.patch("/:id/cancel", ctrl.cancel);

/* -------------------------- HR/Admin dashboard ------------------------- */
router.use(requireRole("hr", "manager", "admin", "owner", "superadmin"));

router.get("/", ctrl.list);
router.get("/:id", ctrl.getOne);
router.patch("/:id/decision", ctrl.decide);

module.exports = router;
