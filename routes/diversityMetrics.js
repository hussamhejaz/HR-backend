// server/routes/diversityMetrics.js
const router = require("express").Router();
const ctrl   = require("../controllers/diversityMetrics");

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
