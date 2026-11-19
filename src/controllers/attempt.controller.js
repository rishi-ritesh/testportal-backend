// Backend/src/controllers/attempt.controller.js

const Attempt = require("../models/Attempt");
const SetPaper = require("../models/SetPaper");
const AttemptAnswer = require("../models/AttemptAnswer");
const Question = require("../models/Question");
const Package = require("../models/Package");

// =========================
// LIVE RANK HELPER
// =========================
// Recomputes rank/percentile for a FIRST attempt against the current
// first-attempt pool, so it stays correct as better performers finish.
// Returns nulls for tests with no participants.
async function computeFirstAttemptRank(testId, finalScore) {

  const totalParticipants =
    await Attempt.countDocuments({
      testId,
      attemptType: "ranked",
      status: "completed"
    });

  if (totalParticipants === 0) {
    return { rank: null, percentile: null, totalParticipants: 0 };
  }

  const better =
    await Attempt.countDocuments({
      testId,
      attemptType: "ranked",
      status: "completed",
      finalScore: { $gt: finalScore }
    });

  const rank = better + 1;

  const percentile = Number(
    (
      ((totalParticipants - rank) / totalParticipants) * 100
    ).toFixed(2)
  );

  return { rank, percentile, totalParticipants };
}

// =========================
// RESPONSE FORMATTERS
// =========================

// Flatten a stored testSnapshot into the shape the attempt screen expects.
function formatSnapshotSections(sections) {
  return (sections || []).map((section) => ({
    sectionId: section.sectionId,
    sectionName: section.sectionName,
    questions: section.questions.map((q) => ({
      questionId: q.questionId,
      questionNumber: q.questionNumber,
      sectionQuestionNumber: q.sectionQuestionNumber,
      question: q.question,
      options: q.options,
      subject: { id: q.subjectId, name: q.subjectName },
      topic: { id: q.topicId, name: q.topicName }
    }))
  }));
}

// Answer fields that are SAFE to send back to a student during a live attempt.
// Never expose correctAnswer / isCorrect / marksAwarded here — that would let
// anyone reading the network response see the answer key mid-test.
function publicAnswer(a) {
  return {
    _id: a._id,
    questionId: a.questionId,
    questionNumber: a.questionNumber,
    selectedOption: a.selectedOption,
    answerStatus: a.answerStatus,
    markedForReview: a.markedForReview,
    timeSpent: a.timeSpent
  };
}

// Duration (minutes) configured for a section, matched by name from SetPaper.
function sectionDurationMinutes(setPaper, sectionName) {
  const config = setPaper?.sections?.find((s) => s.name === sectionName);
  return config?.duration || 0;
}

// Full section length in seconds (null = untimed). Used to seed the clock when
// a section starts; from then on the client owns the countdown and syncs it.
function fullSectionSeconds(setPaper, sectionName) {
  const min = sectionDurationMinutes(setPaper, sectionName);
  return min > 0 ? min * 60 : null;
}

function buildAttemptPayload(attempt) {
  return {
    _id: attempt._id,
    attemptType: attempt.attemptType,
    status: attempt.status,
    startedAt: attempt.startedAt,
    currentSectionIndex: attempt.currentSectionIndex,
    currentQuestionId: attempt.currentQuestionId,
    sections: formatSnapshotSections(attempt.testSnapshot.sections)
  };
}

exports.startAttempt = async (req, res) => {
  try {

    const { testId } = req.body;

    // ✅ validation
    if (!testId) {
      return res.status(400).json({
        message: "testId is required"
      });
    }

    // ✅ fetch published test
    const test = await SetPaper.findOne({
      _id: testId,
      isPublished: true
    })
      .populate("sections.subjects.subjectId")
      .populate({
        path: "sections.subjects.questions.questionId",
        populate: {
          path: "topicId"
        }
      });

    if (!test) {
      return res.status(404).json({
        message: "Test not found"
      });
    }

    // ✅ snapshot generation
    let questionNumber = 1;

    const snapshotSections = test.sections.map(
      (section, sectionIndex) => {

        const questions = [];

        // ✅ section-wise numbering
        let sectionQuestionNumber = 1;

        section.subjects.forEach((subject) => {

          subject.questions.forEach((q) => {

            questions.push({
              questionId: q.questionId._id,

              question: {
                english:
                  q.questionId.question?.en || "",

                hindi:
                  q.questionId.question?.hi || ""
              },

              options:
                q.questionId.options.map((opt) => ({
                  key: opt.key,

                  text: {
                    english:
                      opt.text?.en || "",

                    hindi:
                      opt.text?.hi || ""
                  }
                })),

              subjectId: subject.subjectId._id,

              subjectName:
                subject.subjectId.name,

              topicId:
                q.questionId.topicId?._id,

              topicName:
                q.questionId.topicId?.name,

              questionNumber,

              sectionQuestionNumber
            });

            questionNumber++;
            sectionQuestionNumber++;
          });

        });

        return {
          sectionId: String(sectionIndex + 1),

          sectionName: section.name,

          questions
        };
      }
    );

    // =========================
    // RESOLVE / CREATE ATTEMPT
    // =========================
    // Two attempt roles per user+test:
    //   "ranked"   – the first attempt; the only one counted for ranking.
    //   "practice" – a single unranked retake for improvement analysis.
    // In-progress attempts are always resumed (network-safe). A new
    // practice run only overwrites a previously COMPLETED practice attempt.

    // seconds for the first section (client owns the countdown from here)
    const firstSectionSeconds = (() => {
      const d = test.sections?.[0]?.duration || 0;
      return d > 0 ? d * 60 : null;
    })();

    const createAttempt = (attemptType) =>
      Attempt.create({
        userId: req.user.id,
        testId: test._id,
        attemptType,
        status: "in_progress",
        startedAt: new Date(),
        lastActiveAt: new Date(),
        sectionRemainingSeconds: firstSectionSeconds,
        pausedAt: null,
        currentSectionIndex: 0,
        currentQuestionId:
          snapshotSections[0]?.questions[0]?.questionId || null,
        testSnapshot: { sections: snapshotSections }
      });

    const rankedAttempt = await Attempt.findOne({
      userId: req.user.id,
      testId: test._id,
      attemptType: "ranked"
    });

    // 1) No ranked attempt yet → this first attempt becomes the ranked one
    if (!rankedAttempt) {
      const created = await createAttempt("ranked");
      return res.status(201).json({
        message: "Ranked attempt started",
        attempt: buildAttemptPayload(created)
      });
    }

    // 2) Ranked attempt still in progress → resume it
    if (rankedAttempt.status !== "completed") {
      return res.status(200).json({
        message: "Resuming ranked attempt",
        attempt: buildAttemptPayload(rankedAttempt)
      });
    }

    // 3) Ranked attempt is done → everything beyond is PRACTICE
    const practiceAttempt = await Attempt.findOne({
      userId: req.user.id,
      testId: test._id,
      attemptType: "practice"
    });

    //    a) practice in progress → resume it
    if (practiceAttempt && practiceAttempt.status !== "completed") {
      return res.status(200).json({
        message: "Resuming practice attempt",
        attempt: buildAttemptPayload(practiceAttempt)
      });
    }

    //    b) previous practice completed → overwrite it (answers + doc)
    if (practiceAttempt) {
      await AttemptAnswer.deleteMany({
        attemptId: practiceAttempt._id
      });
      await Attempt.deleteOne({ _id: practiceAttempt._id });
    }

    //    c) start a fresh practice attempt
    const practice = await createAttempt("practice");

    return res.status(201).json({
      message: "Practice attempt started",
      attempt: buildAttemptPayload(practice)
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });
  }
};

// Get Attempt State
exports.getAttemptState = async (req, res) => {
  try {

    const { attemptId } = req.params;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      userId: req.user.id
    });

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found"
      });
    }

    // ✅ section durations come from the live SetPaper config
    // (testSnapshot intentionally stores only question content).
    // Matched to snapshot sections by name so the client can run timers.
    const setPaper = await SetPaper.findById(attempt.testId);

    const sectionDurations =
      (attempt.testSnapshot?.sections || []).map((section) => ({
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        durationMinutes: sectionDurationMinutes(setPaper, section.sectionName)
      }));

    // The stored remaining time for the CURRENT section. The client counts it
    // down and syncs it back, so a reload/resume continues from here (time only
    // passes while the student is actually on the test). Seed it the first time.
    const currentSection =
      attempt.testSnapshot?.sections?.[attempt.currentSectionIndex];

    let currentSectionRemainingSeconds = attempt.sectionRemainingSeconds;
    if (currentSectionRemainingSeconds == null && currentSection) {
      currentSectionRemainingSeconds = fullSectionSeconds(
        setPaper,
        currentSection.sectionName
      );
      if (currentSectionRemainingSeconds != null && attempt.status !== "completed") {
        attempt.sectionRemainingSeconds = currentSectionRemainingSeconds;
        await attempt.save();
      }
    }

    // ✅ previously saved answers, so the UI can restore selections,
    // skipped/marked states and the question palette on reload/resume.
    const savedAnswers = await AttemptAnswer.find({
      attemptId: attempt._id,
      userId: req.user.id
    }).select(
      "questionId questionNumber selectedOption answerStatus markedForReview"
    );

    const answers = savedAnswers.map((a) => ({
      questionId: a.questionId,
      questionNumber: a.questionNumber,
      selectedOption: a.selectedOption,
      answerStatus: a.answerStatus,
      markedForReview: a.markedForReview
    }));

    res.json({
      attemptId: attempt._id,

      attemptType: attempt.attemptType,

      status: attempt.status,

      startedAt: attempt.startedAt,
      lastActiveAt: attempt.lastActiveAt,

      currentSectionIndex: attempt.currentSectionIndex,

      currentQuestionId: attempt.currentQuestionId,

      totalTimeSpent: attempt.totalTimeSpent,

      // ✅ everything the attempt screen needs to render & restore
      testSnapshot: attempt.testSnapshot,

      submittedSections: attempt.submittedSections || [],

      sectionDurations,

      // current-section timer + pause state (server-authoritative)
      currentSectionRemainingSeconds,
      paused: attempt.status === "paused",

      answers
    });

  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};

// =========================
// ONE OPEN TEST SCREEN PER ATTEMPT
// =========================
// The test screen registers a session id when it opens. Saves / timer syncs /
// pause / resume / submit from an OLDER session id are rejected with 409
// OTHER_SESSION, so a second tab or device can't silently overwrite answers.
// A session counts as "live" while its heartbeat (every 10 s) is recent.
// Requests without a sessionId (older app versions) are still accepted.
const SESSION_LIVE_MS = 30 * 1000;

const OTHER_SESSION = {
  code: "OTHER_SESSION",
  message: "This test was opened in another tab or device."
};

const isOtherSession = (storedId, sentId) =>
  Boolean(sentId && storedId && String(sentId) !== String(storedId));

// Register (or take over) the test screen for this attempt.
// Body: { attemptId, sessionId, takeover }
exports.registerSession = async (req, res) => {
  try {
    const { attemptId, sessionId, takeover } = req.body || {};

    if (!attemptId || typeof sessionId !== "string" || !sessionId || sessionId.length > 100) {
      return res.status(400).json({ message: "attemptId and sessionId are required" });
    }

    const attempt = await Attempt.findOne({ _id: attemptId, userId: req.user.id })
      .select("status sessionId sessionSeenAt");

    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }

    if (attempt.status === "completed") {
      return res.json({ ok: true, completed: true, maxSeq: 0 });
    }

    const otherIsLive =
      isOtherSession(attempt.sessionId, sessionId) &&
      attempt.sessionSeenAt &&
      Date.now() - attempt.sessionSeenAt.getTime() < SESSION_LIVE_MS;

    if (otherIsLive && !takeover) {
      return res.status(409).json(OTHER_SESSION);
    }

    await Attempt.updateOne(
      { _id: attempt._id },
      { $set: { sessionId, sessionSeenAt: new Date() } }
    );

    // highest save sequence already stored, so this screen's new saves are
    // always numbered after it (even if this device's clock is behind)
    const last = await AttemptAnswer.findOne({
      attemptId: attempt._id,
      userId: req.user.id,
      clientSeq: { $ne: null }
    })
      .sort({ clientSeq: -1 })
      .select("clientSeq");

    res.json({ ok: true, maxSeq: last?.clientSeq || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Attempt Answer
//
// One atomic upsert per save (no read-then-save), so two quick saves for the
// same question can't overwrite each other and two simultaneous first saves
// can't create two rows (unique index on attemptId + questionId + userId).
//
// Optional `seq` (client sequence number, increasing per attempt): a save
// whose seq is not newer than the one already stored for that question is
// ignored — answer AND time — so a slow old save can't overwrite a newer
// answer and a retried save is never counted twice.
//
// saveType "timer" = time-only save (heartbeat / tab hidden): adds timeSpent
// without touching the chosen option or the review mark.
exports.saveAnswer = async (req, res) => {
  try {

    const {
      attemptId,
      questionId,
      questionNumber,
      selectedOption,
      answerStatus,
      markedForReview,
      timeSpent,
      fromQuestionNumber,
      toQuestionNumber,
      saveType,
      seq,
      sessionId
    } = req.body;

    // ✅ validation
    if (
      !attemptId ||
      !questionId ||
      !questionNumber
    ) {
      return res.status(400).json({
        message: "Missing required fields"
      });
    }

    const clientSeq =
      typeof seq === "number" && Number.isFinite(seq) ? seq : null;

    const timeOnly = saveType === "timer";

    // ✅ verify attempt ownership
    const attempt = await Attempt.findOne({
      _id: attemptId,
      userId: req.user.id
    });

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found"
      });
    }

    // ✅ prevent editing completed attempt
    if (attempt.status === "completed") {
      return res.status(403).json({
        message: "Attempt already completed"
      });
    }

    // ✅ only the screen that currently owns the attempt may save
    if (isOtherSession(attempt.sessionId, sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    // ✅ verify question belongs to this attempt
    let questionSectionIndex = -1;
    let questionSnapshot = null;
    let sectionSnapshot = null;

    for (
      let sectionIndex = 0;
      sectionIndex < attempt.testSnapshot.sections.length;
      sectionIndex++
    ) {
      const section = attempt.testSnapshot.sections[sectionIndex];

      const found = section.questions.find(
        (q) =>
          String(q.questionId) === String(questionId) &&
          q.questionNumber === questionNumber
      );

      if (found) {
        questionSectionIndex = sectionIndex;
        questionSnapshot = found;
        sectionSnapshot = section;
        break;
      }
    }

    if (!questionSnapshot) {
      return res.status(400).json({
        message: "Question does not belong to this attempt"
      });
    }

    // ✅ fetch actual question
    const question = await Question.findById(questionId);

    if (!question) {
      return res.status(404).json({
        message: "Question not found"
      });
    }

    // find actual section config from SetPaper
    const setPaper = await SetPaper.findById(attempt.testId);

    const actualSection = setPaper.sections.find(
      (s) => s.name === sectionSnapshot.sectionName
    );

    if (!actualSection) {
      return res.status(400).json({
        message: "Section config not found"
      });
    }

    // ✅ evaluate answer (unchanged scoring)
    // Score whenever an option is selected — independent of the
    // "mark for review" flag, so answered+marked still counts.
    const correctAnswer = question.correctAnswer;

    let isCorrect = false;
    let marksAwarded = 0;

    if (selectedOption) {
      isCorrect = selectedOption === correctAnswer;
      marksAwarded = isCorrect
        ? actualSection.positiveMarks
        : -actualSection.negativeMarks;
    }

    const isMarked = Boolean(markedForReview);

    // ✅ prevent editing submitted section
    const lockedSection = (attempt.submittedSections || []).find(
      (s) => s.sectionIndex === questionSectionIndex
    );

    if (lockedSection) {
      return res.status(403).json({
        message: "Section already submitted"
      });
    }

    // =========================
    // SAVE THE ANSWER (single atomic upsert)
    // =========================

    const seconds = Math.max(0, Math.floor(Number(timeSpent) || 0));

    const filter = { attemptId, questionId, userId: req.user.id };
    if (clientSeq != null) {
      // only newer saves apply (null also matches rows without a seq yet)
      filter.$or = [{ clientSeq: null }, { clientSeq: { $lt: clientSeq } }];
    }

    const identity = {
      questionNumber,
      sectionId: sectionSnapshot.sectionId,
      sectionName: sectionSnapshot.sectionName,
      subjectId: questionSnapshot.subjectId,
      subjectName: questionSnapshot.subjectName,
      topicId: questionSnapshot.topicId,
      topicName: questionSnapshot.topicName
    };

    const answerFields = timeOnly
      ? null
      : {
          selectedOption: selectedOption ?? null,
          answerStatus,
          markedForReview: isMarked,
          fromQuestionNumber,
          toQuestionNumber,
          saveType,
          correctAnswer,
          isCorrect,
          marksAwarded
        };

    const update = {
      $inc: { timeSpent: seconds },
      $set: { ...(answerFields || {}) },
      $setOnInsert: { ...identity }
    };
    if (clientSeq != null) update.$set.clientSeq = clientSeq;

    if (timeOnly) {
      // a time-only save on a question with no row yet = visited, not answered
      Object.assign(update.$setOnInsert, {
        selectedOption: null,
        answerStatus: "skipped",
        markedForReview: false,
        saveType,
        correctAnswer,
        isCorrect: false,
        marksAwarded: 0
      });
    }

    if (!Object.keys(update.$set).length) delete update.$set;

    const upsert = () =>
      AttemptAnswer.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true
      });

    let answer = null;
    let ignored = false;

    try {
      answer = await upsert();
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Either a simultaneous first save created the row a moment ago (retry
      // applies normally), or the stored save is newer than this one.
      try {
        answer = await upsert();
      } catch (err2) {
        if (err2.code !== 11000) throw err2;
        ignored = true;
      }
    }

    if (ignored) {
      const current = await AttemptAnswer.findOne({
        attemptId,
        questionId,
        userId: req.user.id
      });

      return res.json({
        message: "Older save ignored",
        ignored: true,
        answer: current ? publicAnswer(current) : null
      });
    }

    // =========================
    // UPDATE CURRENT POSITION (only for a save that applied)
    // =========================

    if (toQuestionNumber && !timeOnly) {
      let nextQuestionId = null;
      let nextSectionIndex = 0;

      for (
        let sectionIndex = 0;
        sectionIndex < attempt.testSnapshot.sections.length;
        sectionIndex++
      ) {
        const section = attempt.testSnapshot.sections[sectionIndex];

        const nextQuestion = section.questions.find(
          (q) => q.questionNumber === toQuestionNumber
        );

        if (nextQuestion) {
          nextQuestionId = nextQuestion.questionId;
          nextSectionIndex = sectionIndex;
          break;
        }
      }

      // ✅ update attempt position
      if (nextQuestionId) {
        await Attempt.updateOne(
          { _id: attempt._id },
          {
            $set: {
              currentQuestionId: nextQuestionId,
              currentSectionIndex: nextSectionIndex
            }
          }
        );

        // =========================
        // VISIT TRACKING (first visit → "skipped" row, created only once)
        // =========================

        const nextSection = attempt.testSnapshot.sections[nextSectionIndex];

        const nextQuestionSnapshot = nextSection.questions.find(
          (q) => String(q.questionId) === String(nextQuestionId)
        );

        const nextQuestion = await Question.findById(nextQuestionId);

        if (nextQuestionSnapshot && nextQuestion) {
          try {
            await AttemptAnswer.updateOne(
              { attemptId, questionId: nextQuestionId, userId: req.user.id },
              {
                $setOnInsert: {
                  questionNumber: nextQuestionSnapshot.questionNumber,
                  sectionId: nextSection.sectionId,
                  sectionName: nextSection.sectionName,
                  subjectId: nextQuestionSnapshot.subjectId,
                  subjectName: nextQuestionSnapshot.subjectName,
                  topicId: nextQuestionSnapshot.topicId,
                  topicName: nextQuestionSnapshot.topicName,
                  selectedOption: null,
                  answerStatus: "skipped",
                  fromQuestionNumber,
                  toQuestionNumber,
                  saveType,
                  correctAnswer: nextQuestion.correctAnswer,
                  isCorrect: false,
                  marksAwarded: 0,
                  timeSpent: 0
                }
              },
              { upsert: true, setDefaultsOnInsert: true }
            );
          } catch (err) {
            // the row was created at the same moment by another save — fine
            if (err.code !== 11000) throw err;
          }
        }
      }
    }

    res.json({
      message: "Answer saved",
      answer: publicAnswer(answer)
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });
  }
};

// Section Submit
exports.submitSection = async (req, res) => {
  try {

    const { attemptId } = req.body;

    if (!attemptId) {
      return res.status(400).json({
        message: "attemptId is required"
      });
    }

    // ✅ find attempt
    const attempt = await Attempt.findOne({
      _id: attemptId,
      userId: req.user.id
    });

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found"
      });
    }

    // ✅ prevent editing completed attempt
    if (attempt.status === "completed") {
      return res.status(403).json({
        message: "Attempt already completed"
      });
    }

    // ✅ only the screen that currently owns the attempt may do this
    if (isOtherSession(attempt.sessionId, req.body.sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    // current section
    const currentSectionIndex =
      attempt.currentSectionIndex;

    // total sections
    const totalSections =
      attempt.testSnapshot.sections.length;

    // ✅ already submitted check
    const alreadySubmitted =
      (attempt.submittedSections || []).find(
        (s) => s.sectionIndex === currentSectionIndex
      );

    if (alreadySubmitted) {
      return res.status(400).json({
        message: "Section already submitted"
      });
    }

    // ✅ lock section
    attempt.submittedSections.push({
      sectionIndex: currentSectionIndex,
      submittedAt: new Date()
    });

    // =========================
    // LAST SECTION
    // =========================

    if (currentSectionIndex === totalSections - 1) {

      // ✅ complete test
      attempt.status = "completed";

      // =========================
      // GENERATE FINAL RESULT
      // =========================

      const answers = await AttemptAnswer.find({
        attemptId,
        userId: req.user.id
      });

      let correct = 0;

      let wrong = 0;

      let attempted = 0;

      let finalScore = 0;

      answers.forEach((answer) => {

        finalScore +=
          answer.marksAwarded || 0;

        if (
          answer.answerStatus ===
          "answered"
        ) {

          attempted++;

          if (answer.isCorrect) {
            correct++;
          } else {
            wrong++;
          }
        }
      });

      // ✅ accuracy
      const accuracy =
        attempted > 0
          ? Number(
            (
              (correct / attempted) * 100
            ).toFixed(2)
          )
          : 0;

      // =========================
      // SAVE FINAL STATS
      // =========================

      attempt.finalScore = finalScore;

      attempt.correctCount = correct;

      attempt.wrongCount = wrong;

      attempt.attemptedCount = attempted;

      attempt.accuracy = accuracy;

      attempt.resultGenerated = true;

      await attempt.save();

      // =========================
      // RANK CALCULATION
      // =========================
      // Ranking is based on RANKED (first) attempts only. A practice
      // attempt is neither ranked nor part of the pool.

      if (attempt.attemptType === "ranked") {

        const betterAttempts =
          await Attempt.countDocuments({

            testId: attempt.testId,

            attemptType: "ranked",

            status: "completed",

            finalScore: {
              $gt: finalScore
            }
          });

        // ✅ rank
        const rank =
          betterAttempts + 1;

        // =========================
        // PERCENTILE
        // =========================

        const totalParticipants =
          await Attempt.countDocuments({

            testId: attempt.testId,

            attemptType: "ranked",

            status: "completed"
          });

        const percentile =
          totalParticipants > 0
            ? Number(
              (
                (
                  (
                    totalParticipants -
                    rank
                  ) /
                  totalParticipants
                ) * 100
              ).toFixed(2)
            )
            : 0;

        // ✅ save rank data
        attempt.rank = rank;

        attempt.percentile = percentile;

      } else {

        // practice attempt → not ranked
        attempt.rank = null;

        attempt.percentile = null;
      }

      await attempt.save();

      return res.json({

        message: "Test completed",

        attempt: {

          _id: attempt._id,

          status: attempt.status,

          finalScore:
            attempt.finalScore,

          correctCount:
            attempt.correctCount,

          wrongCount:
            attempt.wrongCount,

          attemptedCount:
            attempt.attemptedCount,

          accuracy:
            attempt.accuracy,

          rank:
            attempt.rank,

          percentile:
            attempt.percentile
        }
      });
    }

    // =========================
    // MOVE TO NEXT SECTION
    // =========================

    attempt.currentSectionIndex += 1;

    // first question of next section
    const nextSection =
      attempt.testSnapshot.sections[
      attempt.currentSectionIndex
      ];

    attempt.currentQuestionId =
      nextSection.questions[0]?.questionId || null;

    // ✅ seed a fresh clock for the new section
    const setPaper = await SetPaper.findById(attempt.testId);
    attempt.sectionRemainingSeconds = fullSectionSeconds(
      setPaper,
      nextSection.sectionName
    );
    attempt.pausedAt = null;
    if (attempt.status === "paused") attempt.status = "in_progress";

    await attempt.save();

    res.json({
      message: "Section submitted",
      attempt
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });
  }
};

// Clamp a client-reported remaining so the clock can only ever go DOWN.
function clampRemaining(stored, reported) {
  const val = Math.max(0, Math.floor(reported));
  return stored == null ? val : Math.min(stored, val);
}

// Persist the current section's remaining seconds (client heartbeat / tab
// close). The clock only moves while the student is on the screen, so this is
// simply "save where the countdown is now".
exports.syncTimer = async (req, res) => {
  try {
    const { attemptId, remainingSeconds, sessionId, release } = req.body;
    const hasTime = typeof remainingSeconds === "number";
    // a screen with a sessionId may send just a heartbeat / release (untimed section)
    if (!attemptId || (!hasTime && !sessionId)) {
      return res.status(400).json({ message: "attemptId and remainingSeconds are required" });
    }

    const attempt = await Attempt.findOne({ _id: attemptId, userId: req.user.id });
    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    if (attempt.status === "completed") {
      return res.json({ ok: true }); // ignore late syncs
    }
    if (isOtherSession(attempt.sessionId, sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    if (hasTime) {
      attempt.sectionRemainingSeconds = clampRemaining(
        attempt.sectionRemainingSeconds,
        remainingSeconds
      );
    }
    // heartbeat keeps this screen "live"; a closing tab (release) frees it
    if (sessionId && attempt.sessionId === sessionId) {
      attempt.sessionSeenAt = release ? null : new Date();
    }
    await attempt.save();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Pause — stops the clock (client freezes its countdown). Also stores the
// remaining the client reports so a reload lands on the same value.
exports.pauseAttempt = async (req, res) => {
  try {
    const { attemptId, remainingSeconds } = req.body;
    if (!attemptId) {
      return res.status(400).json({ message: "attemptId is required" });
    }

    const attempt = await Attempt.findOne({ _id: attemptId, userId: req.user.id });
    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    if (attempt.status === "completed") {
      return res.status(403).json({ message: "Attempt already completed" });
    }
    if (isOtherSession(attempt.sessionId, req.body.sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    if (typeof remainingSeconds === "number") {
      attempt.sectionRemainingSeconds = clampRemaining(
        attempt.sectionRemainingSeconds,
        remainingSeconds
      );
    }

    if (attempt.status !== "paused") {
      attempt.status = "paused";
      attempt.pausedAt = new Date();
    }

    await attempt.save();

    res.json({
      message: "Attempt paused",
      paused: true,
      currentSectionRemainingSeconds: attempt.sectionRemainingSeconds
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Resume — clears the paused flag and returns the stored remaining so the
// client picks the countdown back up from exactly where it stopped.
exports.resumeAttempt = async (req, res) => {
  try {
    const { attemptId } = req.body;
    if (!attemptId) {
      return res.status(400).json({ message: "attemptId is required" });
    }

    const attempt = await Attempt.findOne({ _id: attemptId, userId: req.user.id });
    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    if (attempt.status === "completed") {
      return res.status(403).json({ message: "Attempt already completed" });
    }
    if (isOtherSession(attempt.sessionId, req.body.sessionId)) {
      return res.status(409).json(OTHER_SESSION);
    }

    if (attempt.status === "paused") {
      attempt.pausedAt = null;
      attempt.status = "in_progress";
      await attempt.save();
    }

    res.json({
      message: "Attempt resumed",
      paused: false,
      currentSectionRemainingSeconds: attempt.sectionRemainingSeconds
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Result
exports.getResult = async (req, res) => {
  try {

    const { attemptId } = req.params;

    // ✅ verify attempt
    const attempt = await Attempt.findOne({
      _id: attemptId,
      userId: req.user.id
    });

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found"
      });
    }

    // ✅ fetch answers
    const answers = await AttemptAnswer.find({
      attemptId,
      userId: req.user.id
    });

    // ✅ create answers map
    const answersMap = {};

    answers.forEach((answer) => {

      answersMap[
        String(answer.questionId)
      ] = answer;
    });

    // =========================
    // RANKING POOL = RANKED ATTEMPTS ONLY
    // =========================
    // All competition/leaderboard analytics (participants, topper,
    // averages, per-question difficulty) are computed over each user's
    // RANKED (first) completed attempt only. Practice attempts excluded.

    const firstAttemptIds =
      await Attempt.find({
        testId: attempt.testId,
        attemptType: "ranked",
        status: "completed"
      }).distinct("_id");

    const firstAttemptCount = firstAttemptIds.length;

    // =========================
    // EXPLANATIONS (for solution panel)
    // =========================
    // Snapshots store question + options but not explanations, so we
    // batch-fetch them once and key by questionId.

    const allQuestionIds = [];

    for (
      const section of attempt.testSnapshot.sections
    ) {
      for (const q of section.questions) {
        allQuestionIds.push(q.questionId);
      }
    }

    const questionDocs = await Question.find({
      _id: { $in: allQuestionIds }
    }).select("explanation");

    const explanationMap = {};

    questionDocs.forEach((q) => {
      explanationMap[String(q._id)] = {
        english: q.explanation?.en || "",
        hindi: q.explanation?.hi || ""
      };
    });

    // =========================
    // OVERALL STATS
    // =========================

    let totalQuestions = 0;

    let attempted = 0;

    let correct = 0;

    let wrong = 0;

    let skipped = 0;

    let notVisited = 0;

    let markedForReview = 0;

    let score = 0;

    let totalTimeSpent = 0;

    // =========================
    // ANALYTICS CONTAINERS
    // =========================

    const subjectStats = {};

    const topicStats = {};

    const questionAnalysis = [];

    // =========================
    // ITERATE ALL QUESTIONS
    // =========================

    for (
      const section of
      attempt.testSnapshot.sections
    ) {

      for (
        const question of
        section.questions
      ) {

        totalQuestions++;

        const answer =
          answersMap[
          String(question.questionId)
          ];

        // =========================
        // DEFAULT QUESTION DATA
        // =========================

        const analysis = {

          questionId:
            question.questionId,

          questionNumber:
            question.questionNumber,

          sectionQuestionNumber:
            question.sectionQuestionNumber,

          sectionName:
            section.sectionName,

          subjectId:
            question.subjectId,

          subjectName:
            question.subjectName,

          topicId:
            question.topicId,

          topicName:
            question.topicName,

          // ── content for the solution panel ──
          questionText: question.question,

          options: question.options,

          explanation:
            explanationMap[
              String(question.questionId)
            ] || { english: "", hindi: "" },

          selectedOption: null,

          correctAnswer: null,

          isCorrect: false,

          marksAwarded: 0,

          timeSpent: 0,

          markedForReview: false,

          answerStatus: "not_visited"
        };

        // =========================
        // SUBJECT STATS INIT
        // =========================

        if (
          !subjectStats[
          question.subjectName
          ]
        ) {

          subjectStats[
            question.subjectName
          ] = {

            subjectName:
              question.subjectName,

            correct: 0,

            wrong: 0,

            attempted: 0,

            unattempted: 0,

            markedForReview: 0,

            totalTimeSpent: 0,

            score: 0
          };
        }

        const subject =
          subjectStats[
          question.subjectName
          ];

        // =========================
        // TOPIC STATS INIT
        // =========================

        if (
          !topicStats[
          question.topicName
          ]
        ) {

          topicStats[
            question.topicName
          ] = {

            topicName:
              question.topicName,

            subjectName:
              question.subjectName,

            correct: 0,

            wrong: 0,

            attempted: 0,

            unattempted: 0,

            markedForReview: 0,

            totalTimeSpent: 0,

            score: 0
          };
        }

        const topic =
          topicStats[
          question.topicName
          ];

        // =========================
        // IF ANSWER EXISTS
        // =========================

        if (answer) {

          analysis.selectedOption =
            answer.selectedOption;

          analysis.correctAnswer =
            answer.correctAnswer;

          analysis.isCorrect =
            answer.isCorrect;

          analysis.marksAwarded =
            answer.marksAwarded;

          analysis.timeSpent =
            answer.timeSpent;

          analysis.answerStatus =
            answer.answerStatus;

          analysis.markedForReview =
            Boolean(answer.markedForReview);

          score +=
            answer.marksAwarded || 0;

          totalTimeSpent +=
            answer.timeSpent || 0;

          subject.totalTimeSpent +=
            answer.timeSpent || 0;

          topic.totalTimeSpent +=
            answer.timeSpent || 0;

          subject.score +=
            answer.marksAwarded || 0;

          topic.score +=
            answer.marksAwarded || 0;

          // =========================
          // ANSWERED  (counts even if also marked)
          // =========================

          if (
            answer.answerStatus ===
            "answered"
          ) {

            attempted++;

            subject.attempted++;

            topic.attempted++;

            if (answer.isCorrect) {

              correct++;

              subject.correct++;

              topic.correct++;

            } else {

              wrong++;

              subject.wrong++;

              topic.wrong++;
            }
          }

          // =========================
          // NOT ANSWERED (skipped / marked-only / legacy)
          // =========================

          else {

            skipped++;

            subject.unattempted++;

            topic.unattempted++;
          }

          // =========================
          // MARKED FOR REVIEW (independent flag)
          // =========================

          if (
            answer.markedForReview ||
            answer.answerStatus === "marked_for_review"
          ) {

            markedForReview++;

            subject.markedForReview++;

            topic.markedForReview++;
          }

        }

        // =========================
        // NOT VISITED
        // =========================

        else {

          notVisited++;

          subject.unattempted++;

          topic.unattempted++;
        }

        // =========================
        // QUESTION COMPETITION STATS
        // =========================

        const questionAttempts =
          await AttemptAnswer.find({

            questionId: question.questionId,

            // first-attempt pool only
            attemptId: { $in: firstAttemptIds },

            answerStatus: "answered"
          });

        const totalQuestionAttempts =
          questionAttempts.length;

        const correctAttempts =
          questionAttempts.filter(
            (a) => a.isCorrect
          ).length;

        const wrongAttempts =
          totalQuestionAttempts -
          correctAttempts;

        // skipped count (denominator = first-attempt participants)
        const totalCompletedAttempts =
          firstAttemptCount;

        const skippedAttempts =
          Math.max(
            totalCompletedAttempts -
            totalQuestionAttempts,
            0
          );

        // correct %
        const correctRate =
          totalQuestionAttempts > 0
            ? Number(
              (
                (
                  correctAttempts /
                  totalQuestionAttempts
                ) * 100
              ).toFixed(2)
            )
            : 0;

        // wrong %
        const wrongRate =
          totalQuestionAttempts > 0
            ? Number(
              (
                (
                  wrongAttempts /
                  totalQuestionAttempts
                ) * 100
              ).toFixed(2)
            )
            : 0;

        // skip %
        const skipRate =
          totalCompletedAttempts > 0
            ? Number(
              (
                (
                  skippedAttempts /
                  totalCompletedAttempts
                ) * 100
              ).toFixed(2)
            )
            : 0;

        // =========================
        // TIME ANALYTICS
        // =========================

        const times =
          questionAttempts
            .map((a) => a.timeSpent || 0)
            .filter((t) => t > 0)
            .sort((a, b) => a - b);

        // avg time
        const avgTimeSpent =
          times.length > 0
            ? Number(
              (
                times.reduce(
                  (sum, t) => sum + t,
                  0
                ) / times.length
              ).toFixed(2)
            )
            : 0;

        // median time
        let medianTimeSpent = 0;

        if (times.length > 0) {

          const middle =
            Math.floor(times.length / 2);

          if (times.length % 2 === 0) {

            medianTimeSpent =
              Number(
                (
                  (
                    times[middle - 1] +
                    times[middle]
                  ) / 2
                ).toFixed(2)
              );

          } else {

            medianTimeSpent =
              times[middle];
          }
        }

        // topper time (topper among first attempts)
        const topperAttempt =
          await Attempt.findOne({

            _id: { $in: firstAttemptIds }
          })
            .sort({
              finalScore: -1
            });

        let topperTimeSpent = 0;

        if (topperAttempt) {

          const topperAnswer =
            await AttemptAnswer.findOne({

              attemptId: topperAttempt._id,

              questionId: question.questionId
            });

          topperTimeSpent =
            topperAnswer?.timeSpent || 0;
        }

        // =========================
        // DIFFICULTY
        // =========================
        // Empirical, based on the % of first-attempt answerers who got it
        // right. With no answers yet there is no data → "unrated" (instead
        // of misleadingly defaulting to "hard").

        let difficulty = "unrated";

        if (totalQuestionAttempts > 0) {

          if (correctRate >= 80) {
            difficulty = "easy";
          }

          else if (correctRate < 50) {
            difficulty = "hard";
          }

          else {
            difficulty = "medium";
          }
        }

        // =========================
        // ATTACH STATS
        // =========================

        analysis.competitionStats = {

          totalAttempts:
            totalQuestionAttempts,

          correctRate,

          wrongRate,

          skipRate,

          avgTimeSpent,

          medianTimeSpent,

          topperTimeSpent,

          difficulty
        };

        // =========================
        // PUSH QUESTION ANALYSIS
        // =========================

        questionAnalysis.push(
          analysis
        );
      }
    }

    // =========================
    // OVERALL ACCURACY
    // =========================

    const accuracy =
      attempted > 0
        ? Number(
          (
            (correct / attempted) * 100
          ).toFixed(2)
        )
        : 0;

    // =========================
    // FINALIZE SUBJECTS
    // =========================

    const subjects = Object.values(
      subjectStats
    ).map((subject) => ({

      ...subject,

      accuracy:
        subject.attempted > 0
          ? Number(
            (
              (subject.correct /
                subject.attempted) * 100
            ).toFixed(2)
          )
          : 0,

      avgTimeSpent:
        subject.attempted > 0
          ? Number(
            (
              subject.totalTimeSpent /
              subject.attempted
            ).toFixed(2)
          )
          : 0
    }));

    // =========================
    // FINALIZE TOPICS
    // =========================

    const topics = Object.values(
      topicStats
    ).map((topic) => ({

      ...topic,

      accuracy:
        topic.attempted > 0
          ? Number(
            (
              (topic.correct /
                topic.attempted) * 100
            ).toFixed(2)
          )
          : 0,

      avgTimeSpent:
        topic.attempted > 0
          ? Number(
            (
              topic.totalTimeSpent /
              topic.attempted
            ).toFixed(2)
          )
          : 0
    }));

    // =========================
    // COMPETITION STATS
    // =========================

    // total participants (first attempts only)
    const totalParticipants = firstAttemptCount;

    // topper (among first attempts)
    const topperAttempt =
      await Attempt.findOne({

        _id: { $in: firstAttemptIds }
      })
        .sort({
          finalScore: -1
        });

    // average score + accuracy (first attempts only)
    const aggregateStats =
      await Attempt.aggregate([

        {
          $match: {
            _id: { $in: firstAttemptIds }
          }
        },

        {
          $group: {

            _id: null,

            averageScore: {
              $avg: "$finalScore"
            },

            averageAccuracy: {
              $avg: "$accuracy"
            }
          }
        }
      ]);

    const averageScore =
      aggregateStats[0]?.averageScore || 0;

    const averageAccuracy =
      aggregateStats[0]?.averageAccuracy || 0;

    // final competition stats
    // Live rank/percentile — recomputed against the current ranked-attempt
    // pool so it stays correct as better performers finish. Practice
    // attempts remain unranked.
    let liveRank = null;
    let livePercentile = null;

    if (
      attempt.attemptType === "ranked" &&
      attempt.status === "completed"
    ) {
      const ranked = await computeFirstAttemptRank(
        attempt.testId,
        attempt.finalScore
      );
      liveRank = ranked.rank;
      livePercentile = ranked.percentile;
    }

    const competitionStats = {

      totalParticipants,

      rank: liveRank,

      percentile: livePercentile,

      topperScore:
        topperAttempt?.finalScore || 0,

      topperAccuracy:
        topperAttempt?.accuracy || 0,

      averageScore:
        Number(
          averageScore.toFixed(2)
        ),

      averageAccuracy:
        Number(
          averageAccuracy.toFixed(2)
        )
    };

    // =========================
    // IMPROVEMENT ANALYSIS
    // =========================
    // A practice attempt is compared against the user's ranked (first)
    // attempt for the same test, so they can see their improvement.

    let improvement = null;

    if (attempt.attemptType === "practice") {

      const rankedAttempt = await Attempt.findOne({
        userId: req.user.id,
        testId: attempt.testId,
        attemptType: "ranked",
        status: "completed"
      });

      if (rankedAttempt) {
        improvement = {
          rankedScore: rankedAttempt.finalScore,
          rankedAccuracy: rankedAttempt.accuracy,
          rankedCorrect: rankedAttempt.correctCount,

          scoreDelta:
            Number((score - rankedAttempt.finalScore).toFixed(2)),
          accuracyDelta:
            Number((accuracy - rankedAttempt.accuracy).toFixed(2)),
          correctDelta:
            correct - rankedAttempt.correctCount
        };
      }
    }

    // =========================
    // RESPONSE
    // =========================

    res.json({

      attemptId,

      attemptType: attempt.attemptType,

      improvement,

      status: attempt.status,

      totalQuestions,

      attempted,

      correct,

      wrong,

      skipped,

      notVisited,

      markedForReview,

      score,

      accuracy,

      totalTimeSpent,

      subjects,

      topics,

      competitionStats,

      questionAnalysis
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });
  }
};

// =========================
// NEXT ATTEMPT INFO
// =========================
// Tells the instructions screen what "Start" will do for this test:
// a ranked attempt, a resume, or an (overwriting) practice attempt.
exports.getNextAttemptInfo = async (req, res) => {
  try {

    const { id } = req.params;

    const ranked = await Attempt.findOne({
      userId: req.user.id,
      testId: id,
      attemptType: "ranked"
    });

    // no ranked attempt yet → next start IS the ranked attempt
    if (!ranked) {
      return res.json({
        nextType: "ranked",
        resuming: false,
        rankedCompleted: false
      });
    }

    // ranked attempt still in progress → next start resumes it
    if (ranked.status !== "completed") {
      return res.json({
        nextType: "ranked",
        resuming: true,
        rankedCompleted: false
      });
    }

    // ranked done → next start is a practice attempt
    const practice = await Attempt.findOne({
      userId: req.user.id,
      testId: id,
      attemptType: "practice"
    });

    return res.json({
      nextType: "practice",
      resuming: Boolean(practice && practice.status !== "completed"),
      rankedCompleted: true
    });

  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};

// =========================
// LIST MY ATTEMPTS
// =========================
// Returns the logged-in student's attempts (most recent first) so the
// dashboard can show history and link to resume / result.
exports.getMyAttempts = async (req, res) => {
  try {

    const attempts = await Attempt.find({
      userId: req.user.id
    })
      .populate("testId", "title")
      .sort({ updatedAt: -1 });

    const data = await Promise.all(
      attempts.map(async (a) => {

        // total questions straight from the snapshot (no extra query)
        const totalQuestions =
          (a.testSnapshot?.sections || []).reduce(
            (sum, s) => sum + (s.questions?.length || 0),
            0
          );

        // live rank — ranked completed attempts only; practice unranked
        let rank = null;
        let percentile = null;

        if (
          a.attemptType === "ranked" &&
          a.status === "completed" &&
          a.testId?._id
        ) {
          const ranked = await computeFirstAttemptRank(
            a.testId._id,
            a.finalScore
          );
          rank = ranked.rank;
          percentile = ranked.percentile;
        }

        return {
          attemptId: a._id,

          attemptType: a.attemptType,

          testId: a.testId?._id || null,

          testTitle: a.testId?.title || "Untitled Test",

          status: a.status,

          totalQuestions,

          finalScore: a.finalScore,

          accuracy: a.accuracy,

          rank,

          percentile,

          startedAt: a.startedAt,

          // updatedAt doubles as completion time for finished attempts
          updatedAt: a.updatedAt
        };
      })
    );

    // Attribute each attempt to the series (package) that contains its test, so
    // a student can tell which series a mock came from. A test may be in more
    // than one package.
    const testIds = [
      ...new Set(data.map((d) => d.testId).filter(Boolean).map(String))
    ];

    if (testIds.length) {
      const packages = await Package.find({
        setPapers: { $in: testIds },
        isActive: true
      }).select("name setPapers");

      const seriesByTest = new Map();
      packages.forEach((pkg) => {
        (pkg.setPapers || []).forEach((sid) => {
          const key = String(sid);
          if (!seriesByTest.has(key)) seriesByTest.set(key, []);
          seriesByTest.get(key).push(pkg.name);
        });
      });

      data.forEach((d) => {
        d.seriesNames = d.testId ? seriesByTest.get(String(d.testId)) || [] : [];
      });
    } else {
      data.forEach((d) => (d.seriesNames = []));
    }

    res.json(data);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });
  }
};