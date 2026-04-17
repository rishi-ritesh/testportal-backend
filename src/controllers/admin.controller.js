const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const SetPaper = require("../models/SetPaper");
const QuestionCounter = require("../models/QuestionCounter");

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

// exports.createQuestion = async (req, res) => {
//   try {
//     const {
//       subjectId,
//       topicId,
//       question,
//       options,
//       correctAnswer,
//       explanation
//     } = req.body;

//     // Basic validations
//     if (!subjectId || !topicId)
//       return res.status(400).json({ message: "Subject and Topic required" });

//     if (!question?.en || !question?.hi)
//       return res.status(400).json({ message: "Bilingual question required" });

//     if (!options || options.length < 2)
//       return res.status(400).json({ message: "Minimum 2 options required" });

//     if (!correctAnswer) {
//       return res.status(400).json({
//         message: "Correct answer is required"
//       });
//     }

//     const validKeys = options.map(opt => opt.key);

//     if (!validKeys.includes(correctAnswer))
//       return res.status(400).json({ message: "Correct answer must match option key" });

//     const newQuestion = await Question.create({
//       subjectId,
//       topicId,
//       question,
//       options,
//       correctAnswer,
//       explanation
//     });

//     res.json(newQuestion);

//   } catch (err) {
//     if (err.code === 11000) {
//       return res.status(400).json({
//         message: "Duplicate key error",
//         details: err.keyValue
//       });
//     }

//     res.status(500).json({ message: err.message });
//   }
// };

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

    if (!correctAnswer) {
      return res.status(400).json({
        message: "Correct answer is required"
      });
    }

    const validKeys = options.map(opt => opt.key);

    if (!validKeys.includes(correctAnswer))
      return res.status(400).json({ message: "Correct answer must match option key" });

    // ✅ NEW: Fetch subject & topic
    const subject = await Subject.findById(subjectId);
    const topic = await Topic.findById(topicId);

    if (!subject || !topic) {
      return res.status(400).json({
        message: "Invalid subject or topic"
      });
    }

    // ✅ NEW: Get next counter (atomic)
    const counter = await QuestionCounter.findOneAndUpdate(
      { subjectId, topicId },
      { $inc: { count: 1 } },
      { new: true, upsert: true }
    );

    // ✅ NEW: Format number → 0001
    const number = String(counter.count).padStart(4, "0");

    // ✅ NEW: Build questionCode
    const questionCode = `${subject.slug}_${topic.slug}_${number}`;

    // ✅ UPDATED: Create question with questionCode
    const newQuestion = await Question.create({
      subjectId,
      topicId,
      question,
      options,
      correctAnswer,
      explanation,
      questionCode
    });

    res.json(newQuestion);

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: "Duplicate key error",
        details: err.keyValue
      });
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

// exports.addQuestionToSectionSubject = async (req, res) => {
//   try {
//     const { setId, sectionName, subjectId } = req.params;
//     const { questionId } = req.body;

//     if (!questionId) {
//       return res.status(400).json({ message: "Question ID required" });
//     }

//     const set = await SetPaper.findById(setId);
//     if (!set) {
//       return res.status(404).json({ message: "Set not found" });
//     }

//     if (blockIfPublished(set, res)) return;

//     const section = set.sections.find(
//       (sec) => sec.name.toLowerCase() === sectionName.toLowerCase()
//     );

//     if (!section) {
//       return res.status(404).json({ message: "Section not found" });
//     }

//     const subject = section.subjects.find(
//       (sub) => sub.subjectId.toString() === subjectId
//     );

//     if (!subject) {
//       return res.status(404).json({ message: "Subject not found in this section" });
//     }

//     const question = await Question.findOne({
//       _id: questionId,
//       subjectId,
//       isActive: true
//     });

//     if (!question) {
//       return res.status(400).json({
//         message: "Question invalid or does not belong to this subject"
//       });
//     }

//     const alreadyExists = subject.questions.some(
//       (q) => q.questionId.toString() === questionId
//     );

//     if (alreadyExists) {
//       return res.status(400).json({
//         message: "Question already added to this subject"
//       });
//     }

//     if (subject.questions.length >= subject.maxQuestions) {
//       return res.status(400).json({
//         message: `Maximum ${subject.maxQuestions} questions allowed for this subject`
//       });
//     }

//     subject.questions.push({ questionId });

//     await set.save();

//     res.json(set);

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

exports.addQuestionToSectionSubject = async (req, res) => {
  try {
    const { setId, sectionName, subjectId } = req.params;
    const { questionId, force } = req.body;

    if (!questionId) {
      return res.status(400).json({ message: "Question ID required" });
    }

    const set = await SetPaper.findById(setId);
    if (!set) {
      return res.status(404).json({ message: "Set not found" });
    }

    if (blockIfPublished(set, res)) return;

    const section = set.sections.find(
      (sec) => sec.name.trim().toLowerCase() === sectionName.trim().toLowerCase()
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

    // ❗ Prevent same question ID
    const alreadyExists = subject.questions.some(
      (q) => q.questionId.toString() === questionId
    );

    if (alreadyExists) {
      return res.status(400).json({
        message: "Question already added to this subject"
      });
    }

    // ❗ Fetch existing questions in this subject
    const existingQuestions = await Question.find({
      _id: { $in: subject.questions.map(q => q.questionId) }
    });

    // ❗ Normalize text
    const normalize = (text) =>
      text.trim().toLowerCase().replace(/\s+/g, " ");

    const currentText = normalize(question.question.en);

    const duplicate = existingQuestions.find(
      (q) => normalize(q.question.en) === currentText
    );

    // ❗ If duplicate text found and not forced
    // if (duplicate && !force) {
    //   return res.status(409).json({
    //     message: "Question with this text already exists in the set. Do you still want to add it?",
    //     requiresConfirmation: true
    //   });
    // }

    if (duplicate && !force) {
      return res.status(200).json({
        message: "Question with this text already exists in the set. Do you still want to add it?",
        requiresConfirmation: true
      });
    }

    // ❗ Max question check
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

exports.checkDuplicateInSet = async (req, res) => {
  try {
    const { setId, sectionName, subjectId, questionText } = req.body;

    const set = await SetPaper.findById(setId);

    const section = set.sections.find(
      (sec) => sec.name.trim().toLowerCase() === sectionName.trim().toLowerCase()
    );

    const subject = section.subjects.find(
      (sub) => sub.subjectId.toString() === subjectId
    );

    const existingQuestions = await Question.find({
      _id: { $in: subject.questions.map(q => q.questionId) }
    });

    const normalize = (text) =>
      text.trim().toLowerCase().replace(/\s+/g, " ");

    const duplicate = existingQuestions.find(
      (q) => normalize(q.question.en) === normalize(questionText)
    );

    res.json({
      duplicate: !!duplicate,
      question: duplicate || null
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.searchQuestionByCode = async (req, res) => {
  try {
    const { subjectSlug, topicSlug, code, page = 1, limit = 20 } = req.query;

    // ❗ Case 1: Full questionCode search
    if (code) {
      const question = await Question.findOne({
        questionCode: code,
        isActive: true
      });

      if (!question) {
        return res.status(404).json({
          message: "Question not found"
        });
      }

      return res.json([question]);
    }

    // ❗ Case 2: subjectSlug + topicSlug required
    if (!subjectSlug || !topicSlug) {
      return res.status(400).json({
        message: "Provide either full code OR subjectSlug + topicSlug"
      });
    }

    // Find subject
    const subject = await Subject.findOne({
      slug: subjectSlug,
      isActive: true
    });

    if (!subject) {
      return res.status(400).json({
        message: "Invalid subjectSlug"
      });
    }

    // Find topic
    const topic = await Topic.findOne({
      slug: topicSlug,
      subjectId: subject._id,
      isActive: true
    });

    if (!topic) {
      return res.status(400).json({
        message: "Invalid topicSlug for given subject"
      });
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Fetch questions
    const questions = await Question.find({
      subjectId: subject._id,
      topicId: topic._id,
      isActive: true
    })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    // Total count
    const total = await Question.countDocuments({
      subjectId: subject._id,
      topicId: topic._id,
      isActive: true
    });

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      questions
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};