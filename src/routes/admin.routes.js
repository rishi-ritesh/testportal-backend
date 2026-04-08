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

/* QUESTIONS */
router.post("/question", auth, role("admin"), admin.createQuestion);
router.get(
  "/questions/search",
  auth,
  role("admin"),
  admin.searchQuestions
);
router.get("/questions/:topicId", auth, role("admin"), admin.getQuestionsByTopic);
router.delete("/question/:id", auth, role("admin"), admin.deleteQuestion);


/* SET PAPER */
router.post("/set", auth, role("admin"), admin.createSet);
router.get("/sets", auth, role("admin"), admin.getSets);
router.delete("/set/:id", auth, role("admin"), admin.deleteSet);
router.patch(
  "/set/:id/publish",
  auth,
  role("admin"),
  admin.togglePublishSet
);
router.get("/set/:id", auth, role("admin"), admin.getSetById);


/* ADD SECTIONS TO SET PAPER */
router.post("/set/:setId/section", auth, role("admin"), admin.addSectionToSet);

/* ADD SUBJECTS TO THE SECTION */
router.post(
  "/set/:setId/section/:sectionName/subject",
  auth,
  role("admin"),
  admin.addSubjectToSection
);

/* Add Question To Subject Inside Section */
router.post(
  "/set/:setId/section/:sectionName/subject/:subjectId/question",
  auth,
  role("admin"),
  admin.addQuestionToSectionSubject
);

router.delete(
  "/set/:setId/section/:sectionName/subject/:subjectId/question/:questionId",
  auth,
  role("admin"),
  admin.removeQuestionFromSectionSubject
);

module.exports = router;
