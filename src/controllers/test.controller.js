const Test = require("../models/Test");
const Question = require("../models/Question");

exports.createTest = async (req, res) => {
  try {
    const { title, description, durationMinutes, questions } = req.body;

    const questionIds = questions.map(q => q.questionId);
    const count = await Question.countDocuments({ _id: { $in: questionIds } });

    if (count !== questionIds.length) {
      return res.status(400).json({
        message: "One or more questions do not exist"
      });
    }

    const test = await Test.create({
      title: title.trim(),
      description,
      durationMinutes,
      questions,
      createdBy: req.user.id
    });

    res.json(test);
  } catch (err) {
    // 🔥 DUPLICATE TITLE HANDLING
    if (err.code === 11000 && err.keyPattern?.title) {
      return res.status(409).json({
        message: "Mock title already exists. Please use a different title."
      });
    }

    res.status(500).json({ message: err.message });
  }
};


/* 🔥 PUBLISH MOCK */
exports.publishTest = async (req, res) => {
  const test = await Test.findByIdAndUpdate(
    req.params.id,
    { isPublished: true },
    { new: true }
  );

  if (!test) {
    return res.status(404).json({ message: "Test not found" });
  }

  res.json(test);
};

/* 🔥 UNPUBLISH MOCK */
exports.unpublishTest = async (req, res) => {
  const test = await Test.findByIdAndUpdate(
    req.params.id,
    { isPublished: false },
    { new: true }
  );

  if (!test) {
    return res.status(404).json({ message: "Test not found" });
  }

  res.json(test);
};