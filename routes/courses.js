// server/routes/courses.js
const router = require("express").Router();
const ctrl   = require("../controllers/courses");

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
