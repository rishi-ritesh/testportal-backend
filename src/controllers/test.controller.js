// Backend/src/controllers/test.controller.js

const SetPaper = require("../models/SetPaper");
const { attemptStatusByTest, attemptSummary } = require("../utils/attemptStatus");

exports.getPublishedTests = async (req, res) => {
  try {
    const sets = await SetPaper.find({
      isPublished: true,
      isActive: true
    }).sort({ createdAt: -1 });

    const formatted = sets.map((set) => {
      let totalQuestions = 0;
      let totalDuration = 0;

      set.sections.forEach((section) => {
        totalDuration += section.duration;

        section.subjects.forEach((subject) => {
          totalQuestions += subject.questions.length;
        });
      });

      return {
        id: set._id,
        title: set.title,
        totalSections: set.sections.length,
        totalQuestions,
        totalDuration
      };
    });

    // this student's progress on each test (read-only)
    const progress = await attemptStatusByTest(req.user.id, formatted.map((t) => t.id));
    formatted.forEach((t) => {
      t.attempt = attemptSummary(progress, t.id);
    });

    res.json(formatted);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getTestById = async (req, res) => {
  try {
    const { id } = req.params;

    const set = await SetPaper.findById(id)
      .populate("sections.subjects.subjectId")
      .populate("sections.subjects.questions.questionId");

    if (!set || !set.isPublished) {
      return res.status(404).json({ message: "Test not available" });
    }

    const response = {
      id: set._id,
      title: set.title,
      duration: 0,
      sections: []
    };

    for (const section of set.sections) {
      const sectionData = {
        name: section.name,
        duration: section.duration,
        positiveMarks: section.positiveMarks,
        negativeMarks: section.negativeMarks,
        subjects: []
      };

      response.duration += section.duration;

      for (const subject of section.subjects) {
        const subjectData = {
          subjectId: subject.subjectId?._id,
          subjectName: subject.subjectId?.name,
          questions: []
        };

        for (const q of subject.questions) {
          const question = q.questionId;
          if (!question) continue;

          subjectData.questions.push({
            id: question._id,
            question: question.question,
            options: question.options
          });
        }

        sectionData.subjects.push(subjectData);
      }

      response.sections.push(sectionData);
    }

    res.json(response);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

