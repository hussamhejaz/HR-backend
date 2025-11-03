// server/routes/superadmin.js
const express = require("express");
const router = express.Router({ mergeParams: true });

const admin = require("firebase-admin");
const { db } = require("../config/firebaseAdmin");

const auth = require("../middlewares/auth");            // verifies Firebase ID token, sets req.uid, req.user
const requireSuperadmin = require("../middlewares/superadmin");
const tenantsCtrl = require("../controllers/tenants"); // we’ll reuse its register/list handlers

/**
 * POST /api/superadmin/bootstrap
 * Body: { emailOrUid }
 * Header: X-Setup-Token: process.env.SUPERADMIN_BOOTSTRAP_TOKEN
 *
 * Promote a user to superadmin (one-time/occasional; don’t expose in UI).
 */
router.post("/bootstrap", async (req, res) => {
  try {
    const token = req.header("X-Setup-Token");
    if (!token || token !== process.env.SUPERADMIN_BOOTSTRAP_TOKEN) {
      return res.status(403).json({ error: "Forbidden (invalid setup token)" });
    }

    const { emailOrUid } = req.body || {};
    if (!emailOrUid) return res.status(400).json({ error: "emailOrUid is required" });

    // Resolve user by email or uid
    let userRecord = null;
    if (emailOrUid.includes("@")) {
      userRecord = await admin.auth().getUserByEmail(emailOrUid);
    } else {
      userRecord = await admin.auth().getUser(emailOrUid);
    }

    // Add custom claim
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      ...(userRecord.customClaims || {}),
      superadmin: true,
    });

    // Mirror in DB for quick checks / fallback
    await db.ref(`users/${userRecord.uid}/profile`).update({
      isSuperadmin: true,
      updatedAt: Date.now(),
    });

    return res.json({ ok: true, uid: userRecord.uid, email: userRecord.email, superadmin: true });
  } catch (e) {
    console.error("superadmin.bootstrap error:", e);
    return res.status(500).json({ error: "Failed to promote user" });
  }
});

/**
 * GET /api/superadmin/me
 * Verifies the caller is superadmin (used by SuperPrivateRoute)
 */
router.get("/me", auth, requireSuperadmin, async (req, res) => {
  res.json({ ok: true, uid: req.uid, superadmin: true });
});

/**
 * SUPERADMIN Tenant admin endpoints
 * These are what your React superadmin UI calls:
 *   GET  /api/superadmin/tenants
 *   POST /api/superadmin/tenants/register
 */
router.get("/tenants", auth, requireSuperadmin, tenantsCtrl.list);

// Reuse the same tenants controller "register", but gate it behind superadmin
router.post("/tenants/register", auth, requireSuperadmin, tenantsCtrl.register);

module.exports = router;
