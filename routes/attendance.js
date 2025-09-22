const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");

const qr  = require("../controllers/attendanceQr");
const att = require("../controllers/attendance");

// All attendance routes require auth + tenant resolution
router.use(auth, tenant);

/* ---------------- Employee actions (NO role gate) ---------------- */
router.post("/check-in",  att.checkIn);     // body: { token?, lat?, lng?, note? }
router.post("/check-out", att.checkOut);    // body: { token?, lat?, lng?, note? }
router.get("/me",         att.myAttendance);

/* ---------------- Unified scanner (NO role gate) ----------------- */
// body: { token, action: "in" | "out" }
router.post("/scan", qr.scan);

/* ---------------- Admin QR management (ROLE-GATED) --------------- */
router.use("/qr", requireRole("owner", "admin", "hr", "manager", "superadmin"));
router.get("/qr",           qr.list);    // ?siteId=&active=1
router.post("/qr",          qr.create);  // { siteId, label?, expiresAt?, maxUses? }
router.delete("/qr/:token", qr.revoke);

module.exports = router;
