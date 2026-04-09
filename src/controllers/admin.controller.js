const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const SetPaper = require("../models/SetPaper");

const blockIfPublished = (set, res) => {
  if (set.isPublished) {
    res.status(400).json({
      message: "Cannot modify a published set"
    });
    return true;
  }
  return false;
};

/* ---------------- SUBJECTS ---------------- */

exports.createSubject = async (req, res) => {
  try {
    const { name, slug, order } = req.body;

    const subject = await Subject.create({
      name,
      slug,
      order
    });

    res.json(subject);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSubjects = async (req, res) => {
  const subjects = await Subject.find({ isActive: true }).sort({ order: 1 });
  res.json(subjects);
};

exports.deleteSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const { cascade } = req.query;

    // Deactivate subject
    await Subject.findByIdAndUpdate(id, { isActive: false });

    // If cascade is true, deactivate all topics under it
    if (cascade === "true") {
      await Topic.updateMany(
        { subjectId: id },
        { isActive: false }
      );
    }

    res.json({ message: "Subject deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ---------------- TOPICS ---------------- */

exports.createTopic = async (req, res) => {
  try {
    const { subjectId, name, slug } = req.body;

    const topic = await Topic.create({
      subjectId,
      name,
      slug
    });

    res.json(topic);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getTopicsBySubject = async (req, res) => {
  const { subjectId } = req.params;

  const topics = await Topic.find({
    subjectId,
    isActive: true
  });

  res.json(topics);
};

exports.deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;

    await Topic.findByIdAndUpdate(id, { isActive: false });

    res.json({ message: "Topic deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ---------------- QUESTIONS ---------------- */

exports.createQuestion = async (req, res) => {
  try {
    const {
      subjectId,
      topicId,
      question,
      options,
      correctAnswer,
      explanation
    } = req.body;

    // Basic validations
    if (!subjectId || !topicId)
      return res.status(400).json({ message: "Subject and Topic required" });

    if (!question?.en || !question?.hi)
      return res.status(400).json({ message: "Bilingual question required" });

    if (!options || options.length < 2)
      return res.status(400).json({ message: "Minimum 2 options required" });

    const validKeys = options.map(opt => opt.key);

    if (!validKeys.includes(correctAnswer))
      return res.status(400).json({ message: "Correct answer must match option key" });

    const newQuestion = await Question.create({
      subjectId,
      topicId,
      question,
      options,
      correctAnswer,
      explanation
    });

    res.json(newQuestion);

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Question already exists (English duplicate)" });
    }

    res.status(500).json({ message: err.message });
  }
};

exports.getQuestionsByTopic = async (req, res) => {
  try {
    const { topicId } = req.params;

    const questions = await Question.find({
      topicId,
      isActive: true
    });

    res.json(questions);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    await Question.findByIdAndUpdate(id, { isActive: false });

    res.json({ message: "Question deleted successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.searchQuestions = async (req, res) => {
  try {
    const { subjectId, topicId, q, status } = req.query;

    let filter = {};

    // Subject filter
    if (subjectId) {
      filter.subjectId = subjectId;
    }

    // Topic filter
    if (topicId) {
      filter.topicId = topicId;
    }

    // Text search (English question)
    if (q) {
      filter["question.en"] = {
        $regex: q,
        $options: "i"
      };
    }

    // Status filter
    if (status === "active") {
      filter.isActive = true;
    } else if (status === "inactive") {
      filter.isActive = false;
    }
    // if status === "both" or undefined → do nothing

    const questions = await Question.find(filter)
      .limit(50)
      .sort({ createdAt: -1 });

    res.json(questions);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* ---------------- SET PAPERS ---------------- */

exports.createSet = async (req, res) => {
  try {
    const { title } = req.body;

    if (!title)
      return res.status(400).json({ message: "Title is required" });

    const set = await SetPaper.create({
      title,
      sections: []
    });

    res.json(set);

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Set title must be unique" });
    }

    res.status(500).json({ message: err.message });
  }
};

exports.getSets = async (req, res) => {
  const sets = await SetPaper.find({ isActive: true });
  res.json(sets);
};

exports.deleteSet = async (req, res) => {
  try {
    const { id } = req.params;

    await SetPaper.findByIdAndUpdate(id, { isActive: false });

    res.json({ message: "Set deleted successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// exports.togglePublishSet = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const set = await SetPaper.findById(id);

//     // ❗ Prevent publish if subjects are incomplete
//     for (const section of set.sections) {
//       for (const subject of section.subjects) {

//         const totalQuestions = subject.questions.length;
//         const maxQuestions = subject.maxQuestions || 0;

//         if (maxQuestions > 0 && totalQuestions !== maxQuestions) {
//           return res.status(400).json({
//             message: `Subject has ${totalQuestions}/${maxQuestions} questions. Complete it before publishing.`
//           });
//         }
//       }
//     }

//     if (!set) {
//       return res.status(404).json({ message: "Set not found" });
//     }

//     // Optional validation:
//     if (set.sections.length === 0) {
//       return res.status(400).json({
//         message: "Cannot publish a set without sections"
//       });
//     }

//     for (const section of set.sections) {
//       for (const subject of section.subjects) {

//         if (subject.questions.length !== subject.maxQuestions) {
//           return res.status(400).json({
//             message: `Subject in section "${section.name}" must have exactly ${subject.maxQuestions} questions`
//           });
//         }

//       }
//     }

//     set.isPublished = !set.isPublished;

//     await set.save();

//     res.json({
//       message: `Set ${set.isPublished ? "published" : "unpublished"} successfully`,
//       isPublished: set.isPublished
//     });

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// exports.togglePublishSet = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const set = await SetPaper.findById(id);

//     if (!set) {
//       return res.status(404).json({ message: "Set not found" });
//     }

//     // Only validate when publishing (not unpublishing)
//     if (!set.isPublished) {

//       if (set.sections.length === 0) {
//         return res.status(400).json({
//           message: "Cannot publish a set without sections"
//         });
//       }

//       // ❗ Validate subjects
//       for (const section of set.sections) {
//         for (const subject of section.subjects) {

//           const totalQuestions = subject.questions.length;
//           const maxQuestions = subject.maxQuestions || 0;

//           if (maxQuestions > 0 && totalQuestions !== maxQuestions) {
//             return res.status(400).json({
//               message: `Section "${section.name}" → Subject incomplete (${totalQuestions}/${maxQuestions})`
//             });
//           }
//         }
//       }
//     }

//     set.isPublished = !set.isPublished;

//     await set.save();

//     res.json({
//       message: `Set ${set.isPublished ? "published" : "unpublished"} successfully`,
//       isPublished: set.isPublished
//     });

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

exports.togglePublishSet = async (req, res) => {
  try {
    const { id } = req.params;

    const set = await SetPaper.findById(id);

    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    // Only validate when publishing (not unpublishing)
    if (!set.isPublished) {

      // ❗ Check if sections exist
      if (!set.sections || set.sections.length === 0) {
        return res.status(400).json({
          message: "Cannot publish a set without sections"
        });
      }

      // ❗ Validate each section
      for (const section of set.sections) {

        // ❗ NEW: Section must have subjects
        if (!section.subjects || section.subjects.length === 0) {
          return res.status(400).json({
            message: `Section "${section.name}" has no subjects`
          });
        }

        // ❗ Validate each subject
        for (const subject of section.subjects) {

          const totalQuestions = subject.questions.length;
          const maxQuestions = subject.maxQuestions;

          // Safety check (should never be 0 after Step 1 fix)
          if (!maxQuestions || maxQuestions <= 0) {
            return res.status(400).json({
              message: `Invalid maxQuestions in section "${section.name}"`
            });
          }

          // ❗ Main validation
          if (totalQuestions !== maxQuestions) {
            return res.status(400).json({
              message: `Section "${section.name}" → Subject incomplete (${totalQuestions}/${maxQuestions})`
            });
          }
        }
      }
    }

    // Toggle publish state
    set.isPublished = !set.isPublished;

    await set.save();

    res.json({
      message: `Set ${set.isPublished ? "published" : "unpublished"} successfully`,
      isPublished: set.isPublished
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSetById = async (req, res) => {
  try {
    const { id } = req.params;

    const set = await SetPaper.findById(id)
      .populate("sections.subjects.subjectId")
      .populate("sections.subjects.questions.questionId");

    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    res.json(set);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.addSectionToSet = async (req, res) => {
  try {
    const { setId } = req.params;
    const { name, duration, positiveMarks, negativeMarks } = req.body;

    if (!name || !duration || positiveMarks === undefined || negativeMarks === undefined) {
      return res.status(400).json({ message: "All section fields required" });
    }

    const set = await SetPaper.findById(setId);
    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    if (blockIfPublished(set, res)) return;

    // Check duplicate section name inside this set
    const sectionExists = set.sections.some(
      (section) => section.name.toLowerCase() === name.toLowerCase()
    );

    if (sectionExists) {
      return res.status(400).json({ message: "Section name already exists in this set" });
    }

    set.sections.push({
      name,
      duration,
      positiveMarks,
      negativeMarks,
      subjects: []
    });

    await set.save();

    res.json(set);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addSubjectToSection = async (req, res) => {
  try {
    const { setId, sectionName } = req.params;
    const { subjectId, maxQuestions } = req.body;

    if (!subjectId) {
      return res.status(400).json({ message: "Subject ID required" });
    }

    const set = await SetPaper.findById(setId);
    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    if (blockIfPublished(set, res)) return;

    // Find section
    const section = set.sections.find(
      (sec) => sec.name.toLowerCase() === sectionName.toLowerCase()
    );

    if (!section) {
      return res.status(404).json({ message: "Section not found" });
    }

    // Check if subject already exists in ANY section
    const subjectExistsAnywhere = set.sections.some((sec) =>
      sec.subjects.some(
        (sub) => sub.subjectId.toString() === subjectId
      )
    );

    if (subjectExistsAnywhere) {
      return res.status(400).json({
        message: "Subject already assigned in another section of this set"
      });
    }

    // Validate maxQuestions
    if (!maxQuestions || maxQuestions <= 0) {
      return res.status(400).json({
        message: "maxQuestions must be greater than 0"
      });
    }

    const subjectExists = await Subject.exists({
      _id: subjectId,
      isActive: true
    });

    if (!subjectExists) {
      return res.status(400).json({
        message: "Invalid or inactive subject"
      });
    }

    section.subjects.push({
      subjectId,
      maxQuestions: maxQuestions || 0,
      questions: []
    });


    await set.save();

    res.json(set);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addQuestionToSectionSubject = async (req, res) => {
  try {
    const { setId, sectionName, subjectId } = req.params;
    const { questionId } = req.body;

    if (!questionId) {
      return res.status(400).json({ message: "Question ID required" });
    }

    const set = await SetPaper.findById(setId);
    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    if (blockIfPublished(set, res)) return;

    const section = set.sections.find(
      (sec) => sec.name.toLowerCase() === sectionName.toLowerCase()
    );

    if (!section) {
      return res.status(404).json({ message: "Section not found" });
    }

    const subject = section.subjects.find(
      (sub) => sub.subjectId.toString() === subjectId
    );

    if (!subject) {
      return res.status(404).json({ message: "Subject not found in this section" });
    }

    const question = await Question.findOne({
      _id: questionId,
      subjectId,
      isActive: true
    });

    if (!question) {
      return res.status(400).json({
        message: "Question invalid or does not belong to this subject"
      });
    }

    const alreadyExists = subject.questions.some(
      (q) => q.questionId.toString() === questionId
    );

    if (alreadyExists) {
      return res.status(400).json({
        message: "Question already added to this subject"
      });
    }

    if (subject.questions.length >= subject.maxQuestions) {
      return res.status(400).json({
        message: `Maximum ${subject.maxQuestions} questions allowed for this subject`
      });
    }

    subject.questions.push({ questionId });

    await set.save();

    res.json(set);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.removeQuestionFromSectionSubject = async (req, res) => {
  try {
    const { setId, sectionName, subjectId, questionId } = req.params;

    const set = await SetPaper.findById(setId);
    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    if (blockIfPublished(set, res)) return;

    const section = set.sections.find(
      (sec) => sec.name.toLowerCase() === sectionName.toLowerCase()
    );

    if (!section) {
      return res.status(404).json({ message: "Section not found" });
    }

    const subject = section.subjects.find(
      (sub) => sub.subjectId.toString() === subjectId
    );

    if (!subject) {
      return res.status(404).json({ message: "Subject not found in this section" });
    }

    subject.questions = subject.questions.filter(
      (q) => q.questionId.toString() !== questionId
    );

    await set.save();

    res.json({ message: "Question removed successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};