// server/controllers/auth.js
const fetch = require("node-fetch");

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing FIREBASE_WEB_API_KEY" });
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const data = await r.json();

    if (!r.ok) {
      const msg = data?.error?.message || "Login failed";
      return res.status(401).json({ error: msg });
    }

    // return Firebase ID token; your clients will store it as fb_id_token
    res.json({
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      localId: data.localId,
      email: data.email,
    });
  } catch (e) {
    console.error("auth.login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
};
