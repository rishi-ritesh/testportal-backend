const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const test = require("../controllers/test.controller");

/* CREATE MOCK */
router.post("/createMock", auth, role("admin"), test.createTest);

/* PUBLISH / UNPUBLISH */
router.patch("/:id/publish", auth, role("admin"), test.publishTest);
router.patch("/:id/unpublish", auth, role("admin"), test.unpublishTest);

module.exports = router;
