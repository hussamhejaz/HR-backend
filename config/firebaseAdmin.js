// HR/config/firebaseAdmin.js
require("dotenv").config();              // loads HR/.env
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();   // use .firestore() if you prefer Firestore
module.exports = { admin, db };
