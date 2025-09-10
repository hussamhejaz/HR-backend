// config/firebaseAdmin.js
require("dotenv").config();
const admin = require("firebase-admin");

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require("../serviceAccountKey.json");
}

// Prefer explicit env bucket; otherwise default to <project_id>.appspot.com
const projectId = serviceAccount.project_id || process.env.GCLOUD_PROJECT;
const inferredBucket = projectId ? `${projectId}.appspot.com` : undefined;
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET || inferredBucket;

if (!storageBucket) {
  throw new Error(
    "FIREBASE_STORAGE_BUCKET is not set and project_id could not be inferred. " +
    "Set FIREBASE_STORAGE_BUCKET, e.g. my-project.appspot.com"
  );
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL, // e.g. https://<project>-default-rtdb.firebaseio.com
  storageBucket,                                  // <- REQUIRED
});

// RTDB + Storage
const db = admin.database();
// Uses the default bucket configured above
const bucket = admin.storage().bucket();

console.log("[firebaseAdmin] projectId =", projectId);
console.log("[firebaseAdmin] storageBucket =", storageBucket);

module.exports = { admin, db, bucket };
