// server/controllers/offers.js
const { db } = require("../config/firebaseAdmin");
const REF = db.ref("offers");

exports.list = async (req, res) => {
  const snap = await REF.once("value");
  const data = snap.val() || {};
  res.json(Object.entries(data).map(([id, o]) => ({ id, ...o })));
};

exports.getOne = async (req, res) => {
  const snap = await REF.child(req.params.id).once("value");
  if (!snap.exists()) return res.status(404).json({ error: "Not found" });
  res.json({ id: snap.key, ...snap.val() });
};

exports.create = async (req, res) => {
  const ref = await REF.push(req.body);
  const snap = await ref.once("value");
  res.status(201).json({ id: snap.key, ...snap.val() });
};

exports.update = async (req, res) => {
  await REF.child(req.params.id).update(req.body);
  const snap = await REF.child(req.params.id).once("value");
  res.json({ id: snap.key, ...snap.val() });
};

exports.remove = async (req, res) => {
  await REF.child(req.params.id).remove();
  res.status(204).end();
};
