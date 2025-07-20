// HR/middlewares/auth.js
const { admin } = require("../config/firebaseAdmin");

module.exports = async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth failed:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
};
