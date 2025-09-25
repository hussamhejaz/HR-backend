// server/routes/attendance.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const requireRole = require("../middlewares/requireRole");

// Controllers
const qr  = require("../controllers/attendanceQr");
const att = require("../controllers/attendance");

/* ---------------------- debug what we import (optional) --------------------- */
try {
  console.log("[attendanceQr exports]", Object.keys(qr));
  console.log("[attendance    exports]", Object.keys(att));
} catch (e) {
  console.log("[attendance routes] failed to list controller keys", e);
}

/* ---------------------- resolver for alt controller names ------------------- */
function resolve(fnA, fnB, label) {
  const picked = fnA || fnB;
  if (typeof picked !== "function") {
    throw new Error(
      `[attendance routes] Missing controller function for ${label}. ` +
      `Expected one of: ${label} or ${label}Qr. ` +
      `Found attendanceQr exports: ${JSON.stringify(Object.keys(qr))}`
    );
  }
  return picked;
}

const listQr   = resolve(qr.list,   qr.listQr,   "list");
const createQr = resolve(qr.create, qr.issueQr,  "create");
const revokeQr = resolve(qr.revoke, qr.revokeQr, "revoke");
const scanQr   = resolve(qr.scan,   null,        "scan");

/* ---------------------- assert required handlers exist ---------------------- */
if (typeof att.checkIn !== "function")   throw new Error("[attendance routes] attendance.checkIn is not a function");
if (typeof att.checkOut !== "function")  throw new Error("[attendance routes] attendance.checkOut is not a function");
if (typeof att.myAttendance !== "function") throw new Error("[attendance routes] attendance.myAttendance is not a function");
if (typeof att.listRange !== "function") throw new Error("[attendance routes] attendance.listRange is not a function");

/* ---------------- global guards: auth + tenant resolution first ------------- */
router.use(auth, tenant);

/* ---------------- Employee actions (NO role gate) ---------------- */
router.post("/check-in",  att.checkIn);
router.post("/check-out", att.checkOut);
router.get("/me",         att.myAttendance);

/* ---------------- Optional unified scanner (NO role gate) -------- */
router.post("/scan", scanQr);

/* ---------------- Admin list ---------------- */
router.get(
  "/range",
  requireRole("owner", "admin", "hr", "manager", "superadmin"),
  att.listRange
);

/* ✅ Back-compat alias so UI may call GET /api/attendance (no trailing path) */
router.get(
  "/",
  requireRole("owner", "admin", "hr", "manager", "superadmin"),
  att.listRange
);

/* ---------------- Admin QR management (ROLE-GATED) --------------- */
router.use("/qr", requireRole("owner", "admin", "hr", "manager", "superadmin"));
router.get("/qr",           listQr);
router.post("/qr",          createQr);
router.delete("/qr/:token", revokeQr);

module.exports = router;
