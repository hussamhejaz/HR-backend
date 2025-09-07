// server/routes/jobs.js
const router = require("express").Router();
const ctrl = require("../controllers/jobs");
const auth = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");

router.use(auth, tenant);

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
