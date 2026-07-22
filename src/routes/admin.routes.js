const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const admin = require("../controllers/admin.controller");
const upload = require("../controllers/questionUpload.controller");
const pkg = require("../controllers/package.controller");
const students = require("../controllers/studentAdmin.controller");

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

// ✅ ADD THIS HERE (before :topicId)
router.get(
  "/questions/search-by-code",
  auth,
  role("admin"),
  admin.searchQuestionByCode
);

router.post("/question", auth, role("admin"), admin.createQuestion);

router.put(
  "/question/:id",
  auth,
  role("admin"),
  admin.updateQuestion
);

router.get(
  "/questions/search",
  auth,
  role("admin"),
  admin.searchQuestions
);

// ❗ KEEP THIS LAST among /questions routes
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

/* Bulk-create + add many questions to a subject at once */
router.post(
  "/set/:setId/section/:sectionName/subject/:subjectId/questions/bulk",
  auth,
  role("admin"),
  admin.bulkAddQuestionsToSubject
);

router.delete(
  "/set/:setId/section/:sectionName/subject/:subjectId/question/:questionId",
  auth,
  role("admin"),
  admin.removeQuestionFromSectionSubject
);

router.post(
  "/set/check-duplicate",
  auth,
  role("admin"),
  admin.checkDuplicateInSet
);


/* STUDENT MANAGEMENT */
router.get("/students", auth, role("admin"), students.getStudents);
router.patch("/student/:id/active", auth, role("admin"), students.toggleStudentActive);
router.delete("/student/:id", auth, role("admin"), students.deleteStudent);

/* PACKAGES (TEST SERIES) */
router.post("/package", auth, role("admin"), pkg.createPackage);
router.get("/packages", auth, role("admin"), pkg.getPackages);
router.get("/package/:id", auth, role("admin"), pkg.getPackageById);
router.patch("/package/:id", auth, role("admin"), pkg.updatePackage);
router.delete("/package/:id", auth, role("admin"), pkg.deletePackage);
router.patch("/package/:id/publish", auth, role("admin"), pkg.togglePublishPackage);
router.post("/package/:id/set/:setId", auth, role("admin"), pkg.addSetToPackage);
router.delete("/package/:id/set/:setId", auth, role("admin"), pkg.removeSetFromPackage);

module.exports = router;