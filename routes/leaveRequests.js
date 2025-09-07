// routes/leaveRequests.js
const router = require("express").Router();
const ctrl   = require("../controllers/leaveRequests");

router.route("/")
  .get(ctrl.list)
  .post(ctrl.create);

router.route("/:id")
  .get(ctrl.getOne)
  .patch(ctrl.update)  // allow partial updates (Approve/Reject)
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
