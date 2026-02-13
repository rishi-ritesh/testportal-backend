const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");

exports.bulkUploadQuestions = async (req, res) => {
  try {
    const { questions } = req.body;
    const docs = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      /* ---------------- VALIDATIONS ---------------- */

      if (
        !q.option1_en || !q.option2_en ||
        !q.option3_en || !q.option4_en ||
        !q.option1_hi || !q.option2_hi ||
        !q.option3_hi || !q.option4_hi
      ) {
        return res.status(400).json({
          message: `Empty option detected at index ${i}`
        });
      }

      const subject = await Subject.findOne({ slug: q.subject_slug });
      if (!subject) {
        return res.status(400).json({
          message: `Invalid subject at index ${i}`
        });
      }

      const topic = await Topic.findOne({
        slug: q.topic_slug,
        subjectId: subject._id
      });

      if (!topic) {
        return res.status(400).json({
          message: `Invalid topic at index ${i}`
        });
      }

      docs.push({
        subjectId: subject._id,
        topicId: topic._id,

        question: {
          en: q.question_en.trim(),
          hi: q.question_hi.trim()
        },

        options: [
          { key: "a", text: { en: q.option1_en.trim(), hi: q.option1_hi.trim() } },
          { key: "b", text: { en: q.option2_en.trim(), hi: q.option2_hi.trim() } },
          { key: "c", text: { en: q.option3_en.trim(), hi: q.option3_hi.trim() } },
          { key: "d", text: { en: q.option4_en.trim(), hi: q.option4_hi.trim() } }
        ],

        correctAnswer: q.answer
      });
    }

    const result = await Question.insertMany(docs, { ordered: false });

    res.json({
      message: "Bulk upload completed",
      inserted: result.length,
      skipped: docs.length - result.length
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Duplicate questions detected",
        details: err.keyValue
      });
    }

    res.status(500).json({ message: err.message });
  }
};
