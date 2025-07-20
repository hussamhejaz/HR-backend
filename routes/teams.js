// server/routes/teams.js
const router = require("express").Router();
const ctrl   = require("../controllers/teams");

// No auth middleware here if you’ve disabled it; otherwise uncomment:
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
