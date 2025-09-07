// server/controllers/auth.js
const fetch = require("node-fetch");

const pickApiKey = () =>
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  process.env.REACT_APP_FIREBASE_API_KEY ||
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  "";

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const apiKey = pickApiKey();
    if (!apiKey) {
      return res.status(500).json({
        error:
          "Missing Firebase Web API key. Set FIREBASE_WEB_API_KEY (or VITE_FIREBASE_API_KEY) on the server.",
      });
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
