// server/routes/departments.js
const router = require("express").Router();
const ctrl   = require("../controllers/departments");

// If you have auth middleware and want to disable it temporarily, comment it out:
// const authenticate = require("../middlewares/auth");
// router.use(authenticate);

router
  .route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router
  .route("/:id")
  .get(ctrl.getOne)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
