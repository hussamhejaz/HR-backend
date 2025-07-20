// server/config/firebaseAdmin.js
require("dotenv").config();
const admin = require("firebase-admin");

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // In CI / Render: we’ve stored the JSON string in this env var
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON", err);
    process.exit(1);
  }
} else {
  // Local dev: read your file (but this file should be gitignored)
  serviceAccount = require("../serviceAccountKey.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();    // or .firestore()
module.exports = { admin, db };
