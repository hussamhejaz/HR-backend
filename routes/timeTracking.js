// server/routes/timeTracking.js
const router = require("express").Router();
const ctrl   = require("../controllers/timeTracking");

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.get("/summary", ctrl.summary);

router.route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;

