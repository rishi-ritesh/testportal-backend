const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const admin = require("../controllers/admin.controller");
const upload = require("../controllers/questionUpload.controller");

/* SUBJECTS */
router.post("/subject", auth, role("admin"), admin.createSubject);
router.get("/subjects", auth, role("admin"), admin.getSubjects);
router.delete("/subject/:id", auth, role("admin"), admin.deleteSubject);

/* TOPICS */
router.post("/topic", auth, role("admin"), admin.createTopic);
router.get("/topics/:subjectId", auth, role("admin"), admin.getTopicsBySubject);
router.delete("/topic/:id", auth, role("admin"), admin.deleteTopic);


/* Bulk Upload */
router.post("/questions/bulk-upload", auth, role("admin"), upload.bulkUploadQuestions);

module.exports = router;
