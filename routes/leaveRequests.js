// server/routes/leaveRequests.js
const express     = require("express");
const router      = express.Router({ mergeParams: true });

const multer      = require("multer");
const upload      = multer(); // in-memory; we base64 for demo

const auth        = require("../middlewares/auth");
const tenant      = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");
const ctrl        = require("../controllers/leaveRequests");

// auth + tenant for everything on this router
router.use(auth, tenant);

// Employee: my own requests
router.get("/mine", ctrl.mine);

// Admin/HR/Manager list all
router.get("/", requireRole("hr", "manager", "admin", "owner", "superadmin"), ctrl.list);

// Create (JSON or multipart with attachments)
router.post(
  "/",
  upload.fields([
    { name: "attachments", maxCount: 12 },
    { name: "images",      maxCount: 12 },
    { name: "photo",       maxCount: 3  },
    { name: "pdfs",        maxCount: 12 },
  ]),
  ctrl.create
);

// Read single
router.get("/:id", ctrl.getOne);

// Decisions (approve / reject)
router.patch(
  "/:id/decision",
  requireRole("hr", "manager", "admin", "owner", "superadmin"),
  ctrl.decide
);

// Employee cancels own pending request
router.patch("/:id/cancel", ctrl.cancel);

module.exports = router;
