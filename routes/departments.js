// server/routes/departments.js
const router = require("express").Router({ mergeParams: true });
const auth   = require("../middlewares/auth");
const tenant = require("../middlewares/tenant");
const ctrl   = require("../controllers/departments");

router.use(auth, tenant);

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
