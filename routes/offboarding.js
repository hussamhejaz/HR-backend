// server/routes/offboarding.js
const router = require("express").Router();
const ctrl = require("../controllers/offboarding");

const authenticate = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");

router.use(authenticate, tenant);

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
