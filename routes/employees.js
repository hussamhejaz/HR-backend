// server/routes/employees.js

const router = require("express").Router();
// const authenticate = require("../middlewares/auth");  // ← disabled for now
const ctrl = require("../controllers/employees");

// Temporarily turn off auth checks
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

