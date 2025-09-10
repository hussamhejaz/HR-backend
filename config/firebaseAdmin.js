// config/firebaseAdmin.js
require("dotenv").config();
const admin = require("firebase-admin");

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require("../serviceAccountKey.json");
}

// IMPORTANT: use the same bucket you see in Firebase Storage
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  `${serviceAccount.project_id}.firebasestorage.app`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  storageBucket, // <-- forces the bucket
});

const db = admin.database();
// Also pass the name explicitly so there’s no fallback to appspot.com
const bucket = admin.storage().bucket(storageBucket);

// Helpful startup logs
console.log("[firebaseAdmin] configured bucket:", storageBucket);
bucket
  .exists()
  .then(([exists]) =>
    console.log("[firebaseAdmin] bucket exists:", exists)
  )
  .catch((e) =>
    console.error("[firebaseAdmin] storage bucket check FAILED:", e.message)
  );

module.exports = { admin, db, bucket };
