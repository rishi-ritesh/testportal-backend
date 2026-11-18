// Backend/src/routes/student.routes.js

const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const test = require("../controllers/test.controller");
const pkg = require("../controllers/package.controller");
const student = require("../middleware/student.middleware");

const {
  startAttempt,
  getAttemptState,
  saveAnswer,
  submitSection,
  pauseAttempt,
  resumeAttempt,
  syncTimer,
  getResult,
  getMyAttempts,
  getNextAttemptInfo
} = require("../controllers/attempt.controller");

const {
  toggleBookmark,
  getBookmarkIds,
  getBookmarks
} = require("../controllers/bookmark.controller");

// Get Test List
router.get("/tests", auth, student, test.getPublishedTests);

// Get Test With Id
router.get(
  "/tests/:id",
  auth,
  student,
  test.getTestById
);

// What will "Start" do for this test (ranked / practice / resume)
router.get(
  "/tests/:id/next-attempt",
  auth,
  student,
  getNextAttemptInfo
);

// Packages (test series)
router.get("/packages", auth, student, pkg.getStudentPackages);
router.get("/packages/:id", auth, student, pkg.getStudentPackageById);

// List My Attempts (history)
router.get(
  "/attempts",
  auth,
  student,
  getMyAttempts
);

// Start-Resume Attempt
router.post(
  "/attempt/start",
  auth,
  student,
  startAttempt
);

// Get Attempt State
router.get(
  "/attempt/:attemptId",
  auth,
  student,
  getAttemptState
);

// Save Answer
router.post(
  "/attempt/save-answer",
  auth,
  student,
  saveAnswer
);

// Submit Section
router.post(
  "/attempt/submit-section",
  auth,
  student,
  submitSection
);

// Pause / Resume Attempt
router.post("/attempt/pause", auth, student, pauseAttempt);
router.post("/attempt/resume", auth, student, resumeAttempt);

// Persist the section timer (heartbeat / tab close)
router.post("/attempt/timer", auth, student, syncTimer);

// Get Result
router.get(
  "/result/:attemptId",
  auth,
  student,
  getResult
);

// Bookmarks
router.get("/bookmarks", auth, student, getBookmarks);
router.get("/bookmarks/ids", auth, student, getBookmarkIds);
router.post("/bookmark/:questionId", auth, student, toggleBookmark);

// Custom practice set (student-only, built from bookmarks, no marks)
const custom = require("../controllers/customSet.controller");

router.get("/custom-set", auth, student, custom.getCustomSet);
router.post("/custom-set/questions", auth, student, custom.addQuestions);
router.delete("/custom-set/questions/:questionId", auth, student, custom.removeQuestion);
router.delete("/custom-set", auth, student, custom.clearSet);
router.put("/custom-set/timer", auth, student, custom.updateTimer);

router.post("/custom-set/start", auth, student, custom.startRun);
router.get("/custom-set/attempt", auth, student, custom.getRunState);
router.post("/custom-set/attempt/save-answer", auth, student, custom.saveRunAnswer);
router.post("/custom-set/attempt/timer", auth, student, custom.syncRunTimer);
router.post("/custom-set/attempt/pause", auth, student, custom.pauseRun);
router.post("/custom-set/attempt/resume", auth, student, custom.resumeRun);
router.post("/custom-set/attempt/submit", auth, student, custom.submitRun);
router.get("/custom-set/result", auth, student, custom.getRunResult);

module.exports = router;