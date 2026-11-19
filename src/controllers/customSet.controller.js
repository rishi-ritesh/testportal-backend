// Backend/src/controllers/customSet.controller.js
//
// Student-only custom practice set built from bookmarks. Nothing here touches
// SetPaper / Attempt / AttemptAnswer, so ranked and practice tests, rankings
// and the admin panel are unaffected.
//
// The server stores the set and the student's answers + time, but does NOT
// grade anything: after submit it returns the correct option next to the
// student's choice and the browser works out Correct / Incorrect / Skipped /
// Unseen. No marks anywhere.

const mongoose = require("mongoose");

const CustomSet = require("../models/CustomSet");
const Bookmark = require("../models/Bookmark");
const Question = require("../models/Question");

const { LIMITS } = CustomSet;
const SECTION_NAME = "Custom Practice Set";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);

const LOCKED_MESSAGE =
  "Your custom set has a test in progress. Finish or submit it before changing the set.";

// =========================
// HELPERS
// =========================

// The student's one set, created empty on first use.
async function getOrCreateSet(userId) {
  return CustomSet.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Load the bank questions behind the set, keyed by id. Missing ids (deleted
// from the bank) are simply absent from the map.
async function loadQuestions(ids) {
  if (!ids.length) return new Map();
  const docs = await Question.find({ _id: { $in: ids } })
    .populate("subjectId", "name")
    .populate("topicId", "name");
  return new Map(docs.map((q) => [String(q._id), q]));
}

// Everything the "My Custom Set" page needs.
async function buildSetView(set) {
  const byId = await loadQuestions(set.questionIds);

  const questions = set.questionIds.map((id) => {
    const q = byId.get(String(id));
    const available = Boolean(q && q.isActive);
    return {
      questionId: id,
      available,
      questionCode: q?.questionCode || "",
      subjectName: q?.subjectId?.name || "",
      topicName: q?.topicId?.name || "",
      questionText: {
        english: q?.question?.en || "",
        hindi: q?.question?.hi || ""
      }
    };
  });

  const availableCount = questions.filter((q) => q.available).length;
  const run = set.run;

  return {
    questions,
    secondsPerQuestion: set.secondsPerQuestion,
    limits: LIMITS,
    counts: {
      total: questions.length,
      available: availableCount,
      unavailable: questions.length - availableCount,
      // how many more (available) questions are needed before Start works
      needed: Math.max(0, LIMITS.MIN_QUESTIONS - availableCount),
      // how many more can be added before hitting the maximum
      room: Math.max(0, LIMITS.MAX_QUESTIONS - questions.length)
    },
    // timer for a run started now (only available questions are used)
    totalSeconds: availableCount * set.secondsPerQuestion,
    locked: set.isLocked(),
    run: run
      ? {
          status: run.status,
          questionCount: run.questions.length,
          totalSeconds: run.totalSeconds,
          remainingSeconds: run.remainingSeconds,
          startedAt: run.startedAt,
          submittedAt: run.submittedAt
        }
      : null
  };
}

// Find the student's set with a run that is still going (in progress/paused).
// ----- one open test screen per run (same rules as ranked/practice) -----
const SESSION_LIVE_MS = 30 * 1000;
const OTHER_SESSION = {
  code: "OTHER_SESSION",
  message: "This test was opened in another tab or device."
};
const isOtherSession = (storedId, sentId) =>
  Boolean(sentId && storedId && String(sentId) !== String(storedId));

// true when this request comes from a screen that has been replaced
async function runSessionConflict(userId, sessionId) {
  if (!sessionId) return false;
  const set = await CustomSet.findOne({ userId }).select("run.sessionId");
  return isOtherSession(set?.run?.sessionId, sessionId);
}

async function findActiveRun(userId) {
  const set = await CustomSet.findOne({ userId });
  if (!set || !set.run) return { set, error: [404, "No custom practice test found"] };
  if (set.run.status === "submitted") {
    return { set, error: [403, "This custom practice test is already submitted"] };
  }
  return { set };
}

// =========================
// SET MANAGEMENT
// =========================

exports.getCustomSet = async (req, res) => {
  try {
    const set = await getOrCreateSet(req.user.id);
    res.json(await buildSetView(set));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Add one or more bookmarked questions. Body: { questionIds: [...] }
exports.addQuestions = async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.questionIds) ? req.body.questionIds : [];
    const ids = [...new Set(raw.map(String))];

    if (!ids.length) {
      return res.status(400).json({ message: "Choose at least one question to add" });
    }
    if (!ids.every(isId)) {
      return res.status(400).json({ message: "Invalid question id" });
    }

    const set = await getOrCreateSet(req.user.id);
    if (set.isLocked()) return res.status(409).json({ message: LOCKED_MESSAGE });

    const already = new Set(set.questionIds.map(String));
    const fresh = ids.filter((id) => !already.has(id));
    if (!fresh.length) {
      return res.status(400).json({ message: "These questions are already in your set" });
    }

    const room = LIMITS.MAX_QUESTIONS - set.questionIds.length;
    if (fresh.length > room) {
      return res.status(400).json({
        message:
          room === 0
            ? `Your set already has the maximum of ${LIMITS.MAX_QUESTIONS} questions`
            : `You can add only ${room} more question${room === 1 ? "" : "s"} (maximum ${LIMITS.MAX_QUESTIONS})`
      });
    }

    // must be the student's own bookmarks, and still active in the bank
    const bookmarked = await Bookmark.find({
      userId: req.user.id,
      questionId: { $in: fresh }
    }).distinct("questionId");
    if (bookmarked.length !== fresh.length) {
      return res.status(400).json({ message: "Only bookmarked questions can be added" });
    }

    const activeCount = await Question.countDocuments({ _id: { $in: fresh }, isActive: true });
    if (activeCount !== fresh.length) {
      return res.status(400).json({ message: "Some of these questions are no longer available" });
    }

    set.questionIds.push(...fresh);
    await set.save();

    res.json(await buildSetView(set));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.removeQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    if (!isId(questionId)) return res.status(400).json({ message: "Invalid question id" });

    const set = await getOrCreateSet(req.user.id);
    if (set.isLocked()) return res.status(409).json({ message: LOCKED_MESSAGE });

    set.questionIds.pull(questionId);
    await set.save();

    res.json(await buildSetView(set));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Empty the set. The last result goes with it.
exports.clearSet = async (req, res) => {
  try {
    const set = await getOrCreateSet(req.user.id);
    if (set.isLocked()) return res.status(409).json({ message: LOCKED_MESSAGE });

    set.questionIds = [];
    set.run = null;
    await set.save();

    res.json(await buildSetView(set));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Body: { secondsPerQuestion }  (10..180, whole seconds)
exports.updateTimer = async (req, res) => {
  try {
    const value = Number(req.body?.secondsPerQuestion);
    if (
      !Number.isInteger(value) ||
      value < LIMITS.MIN_SECONDS_PER_QUESTION ||
      value > LIMITS.MAX_SECONDS_PER_QUESTION
    ) {
      return res.status(400).json({
        message: `Time per question must be a whole number between ${LIMITS.MIN_SECONDS_PER_QUESTION} and ${LIMITS.MAX_SECONDS_PER_QUESTION} seconds`
      });
    }

    const set = await getOrCreateSet(req.user.id);
    if (set.isLocked()) return res.status(409).json({ message: LOCKED_MESSAGE });

    set.secondsPerQuestion = value;
    await set.save();

    res.json(await buildSetView(set));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// TAKING THE TEST
// =========================

// Start (or resume) the test. A test that's already running is resumed; a
// previously submitted one is REPLACED (old result deleted) — the page warns
// the student before calling this.
exports.startRun = async (req, res) => {
  try {
    const set = await getOrCreateSet(req.user.id);

    if (set.isLocked()) {
      return res.json({ message: "Resuming custom practice test", status: set.run.status });
    }

    const byId = await loadQuestions(set.questionIds);
    const usable = set.questionIds
      .map((id) => byId.get(String(id)))
      .filter((q) => q && q.isActive);

    if (usable.length < LIMITS.MIN_QUESTIONS) {
      const needed = LIMITS.MIN_QUESTIONS - usable.length;
      return res.status(400).json({
        message: `Add ${needed} more question${needed === 1 ? "" : "s"} to start (minimum ${LIMITS.MIN_QUESTIONS})`,
        needed
      });
    }

    // copy each question; shuffle its options and relabel them A, B, C…
    const questions = usable.map((q, i) => {
      const shuffled = shuffle(q.options || []);
      let correctKey = null;
      const options = shuffled.map((opt, k) => {
        const key = LETTERS[k];
        if (opt.key === q.correctAnswer) correctKey = key;
        return { key, text: { english: opt.text?.en || "", hindi: opt.text?.hi || "" } };
      });
      return {
        questionId: q._id,
        questionNumber: i + 1,
        question: { english: q.question?.en || "", hindi: q.question?.hi || "" },
        options,
        correctKey,
        explanation: { english: q.explanation?.en || "", hindi: q.explanation?.hi || "" },
        subjectName: q.subjectId?.name || "",
        topicName: q.topicId?.name || ""
      };
    });

    const totalSeconds = questions.length * set.secondsPerQuestion;

    set.run = {
      status: "in_progress",
      secondsPerQuestion: set.secondsPerQuestion,
      totalSeconds,
      remainingSeconds: totalSeconds,
      startedAt: new Date(),
      currentQuestionId: questions[0].questionId,
      questions,
      // the first question is on screen as soon as the test opens
      answers: questions.map((q, i) => ({ questionId: q.questionId, visited: i === 0 }))
    };
    await set.save();

    res.status(201).json({ message: "Custom practice test started", status: "in_progress" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Register (or take over) the test screen for this run.
// Body: { sessionId, takeover }
exports.registerRunSession = async (req, res) => {
  try {
    const { sessionId, takeover } = req.body || {};
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const { set, error } = await findActiveRun(req.user.id);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const run = set.run;
    const otherIsLive =
      isOtherSession(run.sessionId, sessionId) &&
      run.sessionSeenAt &&
      Date.now() - run.sessionSeenAt.getTime() < SESSION_LIVE_MS;

    if (otherIsLive && !takeover) {
      return res.status(409).json(OTHER_SESSION);
    }

    await CustomSet.updateOne(
      { _id: set._id, "run.status": { $in: ["in_progress", "paused"] } },
      { $set: { "run.sessionId": sessionId, "run.sessionSeenAt": new Date() } }
    );

    const maxSeq = run.answers.reduce((m, a) => Math.max(m, a.clientSeq || 0), 0);
    res.json({ ok: true, maxSeq });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// State for the test screen, in the same shape the ranked/practice attempt
// screen already reads (one section, whole-set timer). Never includes the
// correct answers.
exports.getRunState = async (req, res) => {
  try {
    const set = await CustomSet.findOne({ userId: req.user.id });
    const run = set?.run;
    if (!run) return res.status(404).json({ message: "No custom practice test found" });

    const sectionQuestions = run.questions.map((q) => ({
      questionId: q.questionId,
      questionNumber: q.questionNumber,
      sectionQuestionNumber: q.questionNumber,
      question: q.question,
      options: q.options,
      subjectName: q.subjectName,
      topicName: q.topicName
    }));

    res.json({
      attemptId: "custom",
      attemptType: "custom",
      status: run.status === "submitted" ? "completed" : run.status,
      startedAt: run.startedAt,
      currentSectionIndex: 0,
      currentQuestionId: run.currentQuestionId,
      testSnapshot: {
        sections: [{ sectionId: "1", sectionName: SECTION_NAME, questions: sectionQuestions }]
      },
      sectionDurations: [
        { sectionId: "1", sectionName: SECTION_NAME, durationMinutes: run.totalSeconds / 60 }
      ],
      currentSectionRemainingSeconds: run.remainingSeconds,
      paused: run.status === "paused",
      answers: run.answers
        .filter((a) => a.visited || a.selectedOption)
        .map((a) => ({
          questionId: a.questionId,
          selectedOption: a.selectedOption,
          answerStatus: a.selectedOption ? "answered" : "skipped",
          markedForReview: a.markedForReview
        }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Save the student's choice + time on a question. Body matches what the test
// screen already sends: { questionId, selectedOption, markedForReview,
// timeSpent, toQuestionNumber }. Uses one atomic update so a quick option
// click and a navigation save can't overwrite each other's time.
exports.saveRunAnswer = async (req, res) => {
  try {
    const {
      questionId,
      selectedOption,
      markedForReview,
      timeSpent,
      toQuestionNumber,
      saveType,
      seq,
      sessionId
    } = req.body || {};
    // "timer" = time-only save (heartbeat / tab hidden): adds time only
    const timeOnly = saveType === "timer";
    const clientSeq = typeof seq === "number" && Number.isFinite(seq) ? seq : null;

    if (!isId(questionId)) return res.status(400).json({ message: "Invalid question id" });

    const { set, error } = await findActiveRun(req.user.id);
    if (error) return res.status(error[0]).json({ message: error[1] });
    if (isOtherSession(set.run.sessionId, sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    const run = set.run;
    const q = run.questions.find((x) => String(x.questionId) === String(questionId));
    if (!q) return res.status(404).json({ message: "Question is not in this test" });

    const choice = selectedOption == null || selectedOption === "" ? null : String(selectedOption);
    if (choice && !q.options.some((o) => o.key === choice)) {
      return res.status(400).json({ message: "Invalid option" });
    }

    // whole seconds, never negative, never more than the whole test
    const seconds = Math.min(
      Math.max(0, Math.floor(Number(timeSpent) || 0)),
      run.totalSeconds
    );

    const $set = timeOnly
      ? { "run.answers.$[a].visited": true }
      : {
          "run.answers.$[a].selectedOption": choice,
          "run.answers.$[a].markedForReview": Boolean(markedForReview),
          "run.answers.$[a].visited": true
        };
    if (clientSeq != null) $set["run.answers.$[a].clientSeq"] = clientSeq;
    const arrayFilters = [{ "a.questionId": q.questionId }];

    // moving to another question → that one is now on screen (seen)
    if (toQuestionNumber != null && !timeOnly) {
      const target = run.questions.find((x) => x.questionNumber === Number(toQuestionNumber));
      if (target) {
        $set["run.currentQuestionId"] = target.questionId;
        if (String(target.questionId) !== String(q.questionId)) {
          $set["run.answers.$[t].visited"] = true;
          arrayFilters.push({ "t.questionId": target.questionId });
        }
      }
    }

    const filter = { _id: set._id, "run.status": { $in: ["in_progress", "paused"] } };
    if (clientSeq != null) {
      // only a save newer than the one stored for this question applies
      filter["run.answers"] = {
        $elemMatch: {
          questionId: q.questionId,
          $or: [{ clientSeq: null }, { clientSeq: { $lt: clientSeq } }]
        }
      };
    }

    const result = await CustomSet.updateOne(
      filter,
      { $set, $inc: { "run.answers.$[a].timeSpent": seconds } },
      { arrayFilters }
    );

    if (!result.matchedCount) {
      const now = await CustomSet.findOne({ _id: set._id }).select("run.status");
      if (clientSeq != null && now?.run && now.run.status !== "submitted") {
        // an older (or repeated) save — the stored one is newer, keep it
        return res.json({ ok: true, ignored: true });
      }
      return res.status(403).json({ message: "This custom practice test is already submitted" });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// The timer can only go DOWN on the server ($min), so a stale or tampered
// value can never add time back.
function remainingUpdate(remainingSeconds) {
  return typeof remainingSeconds === "number" && Number.isFinite(remainingSeconds)
    ? { "run.remainingSeconds": Math.max(0, Math.floor(remainingSeconds)) }
    : null;
}

// Heartbeat / tab close. Body: { remainingSeconds }
exports.syncRunTimer = async (req, res) => {
  try {
    const $min = remainingUpdate(req.body?.remainingSeconds);
    const { sessionId, release } = req.body || {};
    // a screen with a sessionId may send just a heartbeat / release
    if (!$min && !sessionId) return res.status(400).json({ message: "remainingSeconds is required" });
    if (await runSessionConflict(req.user.id, sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    if ($min) {
      await CustomSet.updateOne(
        { userId: req.user.id, "run.status": { $in: ["in_progress", "paused"] } },
        { $min }
      );
    }

    // heartbeat keeps this screen "live"; a closing tab / Save & Exit
    // (release) frees it. A heartbeat only counts while the run is not
    // paused, so one still on its way when the student exited can't undo
    // the release (Save & Exit pauses first).
    if (sessionId) {
      await CustomSet.updateOne(
        release
          ? { userId: req.user.id, "run.sessionId": sessionId, "run.status": { $in: ["in_progress", "paused"] } }
          : { userId: req.user.id, "run.sessionId": sessionId, "run.status": "in_progress" },
        { $set: { "run.sessionSeenAt": release ? null : new Date() } }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.pauseRun = async (req, res) => {
  try {
    const { set, error } = await findActiveRun(req.user.id);
    if (error) return res.status(error[0]).json({ message: error[1] });
    if (isOtherSession(set.run.sessionId, req.body?.sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    const update = { $set: { "run.status": "paused" } };
    if (set.run.status !== "paused") update.$set["run.pausedAt"] = new Date();
    const $min = remainingUpdate(req.body?.remainingSeconds);
    if ($min) update.$min = $min;

    const updated = await CustomSet.findOneAndUpdate(
      { _id: set._id, "run.status": { $in: ["in_progress", "paused"] } },
      update,
      { new: true }
    );
    if (!updated) {
      return res.status(403).json({ message: "This custom practice test is already submitted" });
    }

    res.json({
      message: "Paused",
      paused: true,
      currentSectionRemainingSeconds: updated.run.remainingSeconds
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resumeRun = async (req, res) => {
  try {
    if (await runSessionConflict(req.user.id, req.body?.sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    const updated = await CustomSet.findOneAndUpdate(
      { userId: req.user.id, "run.status": { $in: ["in_progress", "paused"] } },
      { $set: { "run.status": "in_progress", "run.pausedAt": null } },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ message: "No custom practice test in progress" });
    }

    res.json({
      message: "Resumed",
      paused: false,
      currentSectionRemainingSeconds: updated.run.remainingSeconds
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Submit by the student, or automatically when the timer hits 0.
// Body: { remainingSeconds }. Returns the shape the test screen expects.
exports.submitRun = async (req, res) => {
  try {
    if (await runSessionConflict(req.user.id, req.body?.sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    const $min = remainingUpdate(req.body?.remainingSeconds);
    const update = {
      $set: { "run.status": "submitted", "run.submittedAt": new Date(), "run.pausedAt": null }
    };
    if ($min) update.$min = $min;

    const updated = await CustomSet.findOneAndUpdate(
      { userId: req.user.id, "run.status": { $in: ["in_progress", "paused"] } },
      update,
      { new: true }
    );

    if (!updated) {
      // already submitted (e.g. double click / auto-submit race) → fine
      const set = await CustomSet.findOne({ userId: req.user.id });
      if (set?.run?.status === "submitted") {
        return res.json({ attempt: { status: "completed" } });
      }
      return res.status(404).json({ message: "No custom practice test in progress" });
    }

    if (updated.run.remainingSeconds === 0 && !updated.run.autoSubmitted) {
      updated.run.autoSubmitted = true;
      await updated.save();
    }

    res.json({ attempt: { status: "completed" } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// After submit only: every question with the correct option, the student's
// choice, whether it was opened, and time spent. The browser decides
// Correct / Incorrect / Skipped / Unseen — no marks are calculated here.
exports.getRunResult = async (req, res) => {
  try {
    const set = await CustomSet.findOne({ userId: req.user.id });
    const run = set?.run;
    if (!run) return res.status(404).json({ message: "No custom practice result found" });
    if (run.status !== "submitted") {
      return res.status(403).json({ message: "Submit the test to see the result" });
    }

    const answers = new Map(run.answers.map((a) => [String(a.questionId), a]));

    res.json({
      startedAt: run.startedAt,
      submittedAt: run.submittedAt,
      autoSubmitted: run.autoSubmitted,
      secondsPerQuestion: run.secondsPerQuestion,
      totalSeconds: run.totalSeconds,
      remainingSeconds: run.remainingSeconds,
      timeTakenSeconds: Math.max(0, run.totalSeconds - (run.remainingSeconds || 0)),
      questions: run.questions.map((q) => {
        const a = answers.get(String(q.questionId)) || {};
        return {
          questionId: q.questionId,
          questionNumber: q.questionNumber,
          question: q.question,
          options: q.options,
          correctOption: q.correctKey,
          explanation: q.explanation,
          subjectName: q.subjectName,
          topicName: q.topicName,
          selectedOption: a.selectedOption || null,
          visited: Boolean(a.visited),
          markedForReview: Boolean(a.markedForReview),
          // never more than the whole test lasted
          timeSpent: Math.min(a.timeSpent || 0, run.totalSeconds)
        };
      })
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
