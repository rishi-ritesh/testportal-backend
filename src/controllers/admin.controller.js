const mongoose = require("mongoose");

const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const SetPaper = require("../models/SetPaper");
const Package = require("../models/Package");
const QuestionCounter = require("../models/QuestionCounter");

// Normalize any text into a safe slug: lowercase, hyphen-separated, no stray
// characters. Used so subject/topic slugs are consistent and match what the
// bulk-upload feature expects.
const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Validates a question payload against everything the Question schema requires,
// returning a clear message for the first problem found (or null if valid).
// Shared by create + update so the two paths stay consistent and never fall
// through to a generic 500 on a missing/blank field.
const validateQuestionInput = ({ subjectId, topicId, question, options, correctAnswer, explanation }) => {
  if (!subjectId || !topicId) return "Subject and Topic are required";

  if (!question || !String(question.en || "").trim() || !String(question.hi || "").trim()) {
    return "Question text is required in both English and Hindi";
  }

  if (!Array.isArray(options) || options.length < 2) {
    return "At least 2 options are required";
  }

  for (let i = 0; i < options.length; i++) {
    const opt = options[i] || {};
    if (!opt.key) return `Option ${i + 1} is missing its key`;
    if (!String(opt.text?.en || "").trim() || !String(opt.text?.hi || "").trim()) {
      return `Option "${opt.key}" needs text in both English and Hindi`;
    }
  }

  if (!correctAnswer) return "Please select the correct answer";
  if (!options.some((o) => o.key === correctAnswer)) {
    return "Correct answer must match one of the option keys";
  }

  if (!explanation || !String(explanation.en || "").trim() || !String(explanation.hi || "").trim()) {
    return "Explanation is required in both English and Hindi";
  }

  return null;
};

// Returns the titles of any published, active sets that use this question.
// A question referenced by a published set is effectively live content, so it
// must not be edited or deleted until those sets are unpublished.
const publishedSetsUsingQuestion = async (questionId) => {
  const sets = await SetPaper.find({
    isPublished: true,
    isActive: true,
    "sections.subjects.questions.questionId": questionId
  }).select("title");

  return sets.map((s) => s.title);
};

const blockIfPublished = (set, res) => {
  if (set.isPublished) {
    res.status(400).json({
      message: "Cannot modify a published set"
    });
    return true;
  }
  return false;
};

// Sections are addressed by name in the URL, and names are compared
// case-insensitively everywhere so "General Awareness" and "general awareness"
// resolve to the same section.
const findSectionIndex = (set, sectionName) =>
  set.sections.findIndex(
    (sec) => sec.name.toLowerCase() === String(sectionName || "").toLowerCase()
  );

// Resolves the { section, subject } pair a request targets, or replies with the
// right 404 and returns null. Saves every set-editing handler from repeating
// the same two lookups and two error branches.
const resolveSlot = (set, sectionName, subjectId, res) => {
  const section = set.sections[findSectionIndex(set, sectionName)];
  if (!section) {
    res.status(404).json({ message: "Section not found" });
    return null;
  }

  const subject = section.subjects.find(
    (sub) => sub.subjectId.toString() === subjectId
  );
  if (!subject) {
    res.status(404).json({ message: "Subject not found in this section" });
    return null;
  }

  return { section, subject };
};

// Moves one element of an array from index `from` to index `to`, in place.
// Returns false when either index is outside the array so callers can 400.
const moveWithin = (arr, from, to) => {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= arr.length ||
    to >= arr.length
  ) {
    return false;
  }

  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  return true;
};

/* ---------------- SUBJECTS ---------------- */

exports.createSubject = async (req, res) => {
  try {
    const { name, order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Subject name is required" });
    }

    const slug = slugify(req.body.slug || name);
    if (!slug) {
      return res.status(400).json({
        message: "Could not build a valid slug from the name — use letters or numbers"
      });
    }

    // Friendly duplicate check (the unique indexes enforce this too).
    const dup = await Subject.findOne({ $or: [{ name: name.trim() }, { slug }] });
    if (dup) {
      return res.status(409).json({
        message: "A subject with this name or slug already exists"
      });
    }

    const subject = await Subject.create({ name: name.trim(), slug, order });
    res.status(201).json(subject);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "A subject with this name or slug already exists"
      });
    }
    res.status(500).json({ message: err.message });
  }
};

exports.getSubjects = async (req, res) => {
  const subjects = await Subject.find({ isActive: true }).sort({ order: 1 });
  res.json(subjects);
};

// Rename a subject. The display name can always change, but the slug is baked
// into every questionCode ever generated under this subject
// (`${subject.slug}_${topic.slug}_0001`), so it is frozen the moment the first
// question exists — otherwise the codes on screen would stop matching the slug.
exports.updateSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, order } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid subject id" });
    }

    const subject = await Subject.findOne({ _id: id, isActive: true });
    if (!subject) {
      return res.status(404).json({ message: "Subject not found" });
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: "Subject name is required" });
      }

      const dup = await Subject.findOne({
        _id: { $ne: id },
        name: String(name).trim()
      });
      if (dup) {
        return res.status(409).json({
          message: "Another subject already uses this name"
        });
      }

      subject.name = String(name).trim();
    }

    if (req.body.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (!slug) {
        return res.status(400).json({
          message: "Could not build a valid slug — use letters or numbers"
        });
      }

      if (slug !== subject.slug) {
        const questionCount = await Question.countDocuments({ subjectId: id });
        if (questionCount > 0) {
          return res.status(400).json({
            message: `Slug is locked: ${questionCount} question code(s) were generated from "${subject.slug}". You can still rename the subject.`
          });
        }

        const dupSlug = await Subject.findOne({ _id: { $ne: id }, slug });
        if (dupSlug) {
          return res.status(409).json({
            message: "Another subject already uses this slug"
          });
        }

        subject.slug = slug;
      }
    }

    if (order !== undefined) subject.order = Number(order) || 0;

    await subject.save();
    res.json(subject);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "A subject with this name or slug already exists"
      });
    }
    res.status(500).json({ message: err.message });
  }
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
    const { subjectId, name } = req.body;

    if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.status(400).json({ message: "A valid subject is required" });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Topic name is required" });
    }

    const subject = await Subject.findOne({ _id: subjectId, isActive: true });
    if (!subject) {
      return res.status(400).json({ message: "Invalid or inactive subject" });
    }

    const slug = slugify(req.body.slug || name);
    if (!slug) {
      return res.status(400).json({
        message: "Could not build a valid slug — use letters or numbers"
      });
    }

    // Topics have no unique index, so enforce uniqueness within the subject here.
    const dup = await Topic.findOne({ subjectId, slug, isActive: true });
    if (dup) {
      return res.status(409).json({
        message: `A topic with slug "${slug}" already exists in this subject`
      });
    }

    const topic = await Topic.create({ subjectId, name: name.trim(), slug });
    res.status(201).json(topic);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getTopicsBySubject = async (req, res) => {
  const { subjectId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subjectId)) {
    return res.status(400).json({ message: "Invalid subject id" });
  }

  const topics = await Topic.find({
    subjectId,
    isActive: true
  });

  res.json(topics);
};

// Same rule as updateSubject: the name is free to change, the slug is frozen
// once questions carry it inside their questionCode.
exports.updateTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid topic id" });
    }

    const topic = await Topic.findOne({ _id: id, isActive: true });
    if (!topic) {
      return res.status(404).json({ message: "Topic not found" });
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: "Topic name is required" });
      }
      topic.name = String(name).trim();
    }

    if (req.body.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (!slug) {
        return res.status(400).json({
          message: "Could not build a valid slug — use letters or numbers"
        });
      }

      if (slug !== topic.slug) {
        const questionCount = await Question.countDocuments({ topicId: id });
        if (questionCount > 0) {
          return res.status(400).json({
            message: `Slug is locked: ${questionCount} question code(s) were generated from "${topic.slug}". You can still rename the topic.`
          });
        }

        const dup = await Topic.findOne({
          _id: { $ne: id },
          subjectId: topic.subjectId,
          slug,
          isActive: true
        });
        if (dup) {
          return res.status(409).json({
            message: `A topic with slug "${slug}" already exists in this subject`
          });
        }

        topic.slug = slug;
      }
    }

    await topic.save();
    res.json(topic);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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

    // Full validation (bilingual question/options/explanation, answer, etc.)
    const invalid = validateQuestionInput(req.body);
    if (invalid) return res.status(400).json({ message: invalid });

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

exports.updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      subjectId,
      topicId,
      question,
      options,
      correctAnswer,
      explanation
    } = req.body;

    const existingQuestion = await Question.findById(id);

    if (!existingQuestion) {
      return res.status(404).json({ message: "Question not found" });
    }

    // ❗ Block edits to questions that are live in a published set.
    const lockedIn = await publishedSetsUsingQuestion(id);
    if (lockedIn.length) {
      return res.status(400).json({
        message: `This question is used in a published set (${lockedIn.join(", ")}) and can't be edited. Unpublish that set first.`
      });
    }

    // Full validation (same rules as create)
    const invalid = validateQuestionInput(req.body);
    if (invalid) return res.status(400).json({ message: invalid });

    // ✅ IMPORTANT: Do NOT change questionCode
    // (keep it stable once created)

    const updated = await Question.findByIdAndUpdate(
      id,
      {
        subjectId,
        topicId,
        question,
        options,
        correctAnswer,
        explanation
      },
      { new: true }
    );

    res.json(updated);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getQuestionsByTopic = async (req, res) => {
  try {
    const { topicId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(topicId)) {
      return res.status(400).json({ message: "Invalid topic id" });
    }

    const questions = await Question.find({
      topicId,
      isActive: true
    }).lean();

    // Map each question to the published set(s) that use it — the UI uses this
    // to disable edit/delete and to show which set is locking it.
    const ids = questions.map((q) => q._id);
    const setsByQuestion = new Map(); // questionId -> Set of set titles

    if (ids.length) {
      const publishedSets = await SetPaper.find({
        isPublished: true,
        isActive: true,
        "sections.subjects.questions.questionId": { $in: ids }
      }).select("title sections.subjects.questions.questionId");

      publishedSets.forEach((set) => {
        set.sections.forEach((sec) => {
          sec.subjects.forEach((sub) => {
            sub.questions.forEach((q) => {
              if (!q.questionId) return;
              const key = q.questionId.toString();
              if (!setsByQuestion.has(key)) setsByQuestion.set(key, new Set());
              setsByQuestion.get(key).add(set.title);
            });
          });
        });
      });
    }

    const enriched = questions.map((q) => {
      const titles = setsByQuestion.get(q._id.toString());
      const lockedInSets = titles ? Array.from(titles) : [];
      return { ...q, locked: lockedInSets.length > 0, lockedInSets };
    });

    res.json(enriched);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid question id" });
    }

    // ❗ Block deleting a question that's live in a published set.
    const lockedIn = await publishedSetsUsingQuestion(id);
    if (lockedIn.length) {
      return res.status(400).json({
        message: `This question is used in a published set (${lockedIn.join(", ")}) and can't be deleted. Unpublish that set first.`
      });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    question.isActive = false;
    await question.save();

    // Pull this question out of any DRAFT sets that reference it, so they don't
    // keep a dangling ref to a deleted question (which would otherwise still
    // show in the builder, inflate the filled count, and get served if the set
    // is later published). Published sets are already excluded by the guard above.
    const qObjectId = new mongoose.Types.ObjectId(id);
    const pullResult = await SetPaper.updateMany(
      { "sections.subjects.questions.questionId": qObjectId },
      { $pull: { "sections.$[].subjects.$[].questions": { questionId: qObjectId } } }
    );

    const removedFrom = pullResult.modifiedCount || 0;

    res.json({
      message:
        removedFrom > 0
          ? `Question deleted and removed from ${removedFrom} draft set(s).`
          : "Question deleted successfully"
    });

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
      if (!mongoose.Types.ObjectId.isValid(subjectId)) {
        return res.status(400).json({ message: "Invalid subject id" });
      }
      filter.subjectId = subjectId;
    }

    // Topic filter
    if (topicId) {
      if (!mongoose.Types.ObjectId.isValid(topicId)) {
        return res.status(400).json({ message: "Invalid topic id" });
      }
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

// Rename a set. Titles are unique across sets, so a clash comes back as a
// friendly 409 instead of a raw duplicate-key 500.
exports.updateSet = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: "Title is required" });
    }

    const set = await SetPaper.findById(id);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    set.title = String(title).trim();
    await set.save();

    res.json(set);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Set title must be unique" });
    }
    res.status(500).json({ message: err.message });
  }
};

exports.getSets = async (req, res) => {
  const sets = await SetPaper.find({ isActive: true }).lean();

  // The set→package link lives on the Package side (its `setPapers` array),
  // so map each set to the package(s) that bundle it. A set may belong to
  // more than one package, and some belong to none.
  const packages = await Package.find({ isActive: true })
    .select("name setPapers")
    .lean();

  const packagesBySet = new Map();
  packages.forEach((pkg) => {
    (pkg.setPapers || []).forEach((setId) => {
      const key = setId.toString();
      if (!packagesBySet.has(key)) packagesBySet.set(key, []);
      packagesBySet.get(key).push(pkg.name);
    });
  });

  const enriched = sets.map((set) => ({
    ...set,
    packages: packagesBySet.get(set._id.toString()) || []
  }));

  res.json(enriched);
};

exports.deleteSet = async (req, res) => {
  try {
    const { id } = req.params;

    const set = await SetPaper.findById(id);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    set.isActive = false;
    await set.save();

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

      // ❗ Which of this set's questions are still active? Used to block
      // publishing a set that references a deleted/inactive question (a stale
      // ref that would otherwise be served to students).
      const allQuestionIds = [];
      set.sections.forEach((section) => {
        (section.subjects || []).forEach((subject) => {
          (subject.questions || []).forEach((q) => {
            if (q.questionId) allQuestionIds.push(q.questionId);
          });
        });
      });

      const activeQuestions = await Question.find({
        _id: { $in: allQuestionIds },
        isActive: true
      }).select("_id");

      const activeIds = new Set(activeQuestions.map((q) => q._id.toString()));

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

          // ❗ No deleted/inactive questions allowed
          const staleCount = subject.questions.filter(
            (q) => !q.questionId || !activeIds.has(q.questionId.toString())
          ).length;

          if (staleCount > 0) {
            return res.status(400).json({
              message: `Section "${section.name}" has ${staleCount} deleted question(s). Remove and replace them before publishing.`
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

// Edit a section that already exists: its name, duration and marking scheme.
// Every field is optional, so the UI can send only what the admin touched.
exports.updateSection = async (req, res) => {
  try {
    const { setId, sectionName } = req.params;
    const { name, duration, positiveMarks, negativeMarks } = req.body;

    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    const index = findSectionIndex(set, sectionName);
    if (index === -1) {
      return res.status(404).json({ message: "Section not found" });
    }

    const section = set.sections[index];

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ message: "Section name is required" });
      }

      // A rename must not collide with a different section of the same set,
      // because the name is how every other route addresses this section.
      const clash = set.sections.some(
        (sec, i) => i !== index && sec.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        return res.status(400).json({
          message: "Section name already exists in this set"
        });
      }

      section.name = trimmed;
    }

    for (const [field, value] of [
      ["duration", duration],
      ["positiveMarks", positiveMarks],
      ["negativeMarks", negativeMarks]
    ]) {
      if (value === undefined) continue;

      const num = Number(value);
      if (!Number.isFinite(num)) {
        return res.status(400).json({ message: `${field} must be a number` });
      }
      if (field === "duration" && num <= 0) {
        return res.status(400).json({
          message: "Duration must be greater than 0"
        });
      }
      if (num < 0) {
        return res.status(400).json({ message: `${field} cannot be negative` });
      }

      section[field] = num;
    }

    await set.save();
    res.json(set);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete a whole section. Questions inside it are only unlinked from this set —
// the Question documents themselves stay in the bank and can be reused.
exports.deleteSection = async (req, res) => {
  try {
    const { setId, sectionName } = req.params;

    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    const index = findSectionIndex(set, sectionName);
    if (index === -1) {
      return res.status(404).json({ message: "Section not found" });
    }

    set.sections.splice(index, 1);
    await set.save();

    res.json({ message: "Section removed successfully", set });
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

// Edit a subject slot that is already in a section — its question limit, and
// (while the slot is still empty) which subject it points at. This is the fix
// for the common "typed 15 instead of 25" mistake, which previously needed the
// whole set to be rebuilt.
exports.updateSubjectInSection = async (req, res) => {
  try {
    const { setId, sectionName, subjectId } = req.params;
    const { maxQuestions, subjectId: newSubjectId } = req.body;

    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    const slot = resolveSlot(set, sectionName, subjectId, res);
    if (!slot) return;

    const { subject } = slot;
    const currentCount = subject.questions.length;

    if (maxQuestions !== undefined) {
      const max = Number(maxQuestions);

      if (!Number.isInteger(max) || max <= 0) {
        return res.status(400).json({
          message: "maxQuestions must be a whole number greater than 0"
        });
      }

      // Lowering the limit below what is already added would leave the subject
      // permanently over capacity and unable to publish.
      if (max < currentCount) {
        return res.status(400).json({
          message: `This subject already has ${currentCount} question(s). Remove some before lowering the limit to ${max}.`
        });
      }

      subject.maxQuestions = max;
    }

    if (newSubjectId !== undefined && newSubjectId !== subjectId) {
      if (currentCount > 0) {
        return res.status(400).json({
          message: `Remove all ${currentCount} question(s) first — they belong to the current subject.`
        });
      }

      const existsElsewhere = set.sections.some((sec) =>
        sec.subjects.some((sub) => sub.subjectId.toString() === newSubjectId)
      );
      if (existsElsewhere) {
        return res.status(400).json({
          message: "Subject already assigned in another section of this set"
        });
      }

      const valid = await Subject.exists({ _id: newSubjectId, isActive: true });
      if (!valid) {
        return res.status(400).json({ message: "Invalid or inactive subject" });
      }

      subject.subjectId = newSubjectId;
    }

    await set.save();
    res.json(set);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Remove a subject slot from a section. Like deleteSection, the questions are
// only unlinked from this set — they stay in the question bank.
exports.removeSubjectFromSection = async (req, res) => {
  try {
    const { setId, sectionName, subjectId } = req.params;

    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    const slot = resolveSlot(set, sectionName, subjectId, res);
    if (!slot) return;

    const { section } = slot;
    section.subjects = section.subjects.filter(
      (sub) => sub.subjectId.toString() !== subjectId
    );

    await set.save();
    res.json({ message: "Subject removed successfully", set });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Move one section, subject or question up or down. Display order is just the
// array order in the document, so a reorder is a splice — no extra field to
// keep in sync. `from`/`to` are indexes in the list being reordered.
exports.reorderSetItems = async (req, res) => {
  try {
    const { setId } = req.params;
    const { type, sectionName, subjectId, from, to } = req.body;

    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set not found" });

    if (blockIfPublished(set, res)) return;

    let list;

    if (type === "section") {
      list = set.sections;
    } else if (type === "subject" || type === "question") {
      const index = findSectionIndex(set, sectionName);
      if (index === -1) {
        return res.status(404).json({ message: "Section not found" });
      }

      if (type === "subject") {
        list = set.sections[index].subjects;
      } else {
        const slot = resolveSlot(set, sectionName, subjectId, res);
        if (!slot) return;
        list = slot.subject.questions;
      }
    } else {
      return res.status(400).json({
        message: 'type must be "section", "subject" or "question"'
      });
    }

    if (!moveWithin(list, Number(from), Number(to))) {
      return res.status(400).json({ message: "Invalid move position" });
    }

    // Mongoose does not always notice in-place splices on nested arrays.
    set.markModified("sections");
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

// Bulk-create questions and add them all to one subject slot of a set in a
// single request. The target subject (and its subjectId + maxQuestions) is
// fixed by the URL, so each row only needs its topic_slug. All-or-nothing on
// validation: if any row is bad, nothing is inserted and the row errors are
// returned so the admin can fix the file and re-upload.
exports.bulkAddQuestionsToSubject = async (req, res) => {
  try {
    const { setId, sectionName, subjectId } = req.params;
    const { questions, force } = req.body;

    // ---- batch presence + sane size ----
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: "No questions found in the file" });
    }

    if (questions.length > 500) {
      return res.status(400).json({
        message: "Too many questions in one upload (max 500). Please split the file."
      });
    }

    // ---- set + publish lock ----
    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set not found" });
    if (blockIfPublished(set, res)) return;

    // ---- locate section + subject slot inside the set ----
    const section = set.sections.find(
      (sec) => sec.name.trim().toLowerCase() === sectionName.trim().toLowerCase()
    );
    if (!section) return res.status(404).json({ message: "Section not found" });

    const subjectSlot = section.subjects.find(
      (sub) => sub.subjectId.toString() === subjectId
    );
    if (!subjectSlot) {
      return res.status(404).json({ message: "Subject not found in this section" });
    }

    // ---- subject must be valid/active (needed for slug + questionCode) ----
    const subject = await Subject.findOne({ _id: subjectId, isActive: true });
    if (!subject) {
      return res.status(400).json({ message: "Invalid or inactive subject" });
    }

    const normalize = (t) =>
      String(t || "").trim().toLowerCase().replace(/\s+/g, " ");

    // ---- per-row validation ----
    const errors = [];
    const cleaned = [];
    const seenInFile = new Map(); // normalized question.en -> first row number
    const topicCache = new Map(); // slug -> topic doc (or null)

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] || {};
      const row = i + 1;
      const get = (k) => (typeof q[k] === "string" ? q[k].trim() : q[k]);

      const question_en = get("question_en");
      const question_hi = get("question_hi");
      const a_en = get("option_a_en"), b_en = get("option_b_en"),
            c_en = get("option_c_en"), d_en = get("option_d_en");
      const a_hi = get("option_a_hi"), b_hi = get("option_b_hi"),
            c_hi = get("option_c_hi"), d_hi = get("option_d_hi");
      const answer = String(get("answer") || "").trim().toUpperCase();
      const explanation_en = get("explanation_en");
      const explanation_hi = get("explanation_hi");
      const topic_slug = get("topic_slug");

      const rowErr = [];

      if (!topic_slug) rowErr.push("missing topic_slug");
      if (!question_en || !question_hi) rowErr.push("question_en and question_hi are required");
      if (!a_en || !b_en || !c_en || !d_en) rowErr.push("all four English options are required");
      if (!a_hi || !b_hi || !c_hi || !d_hi) rowErr.push("all four Hindi options are required");
      if (!["A", "B", "C", "D"].includes(answer)) rowErr.push("answer must be one of A, B, C, D");
      if (!explanation_en || !explanation_hi) rowErr.push("explanation_en and explanation_hi are required");

      // resolve topic (must belong to THIS subject)
      let topic = null;
      if (topic_slug) {
        if (topicCache.has(topic_slug)) {
          topic = topicCache.get(topic_slug);
        } else {
          topic = await Topic.findOne({ slug: topic_slug, subjectId, isActive: true });
          topicCache.set(topic_slug, topic || null);
        }
        if (!topic) rowErr.push(`topic "${topic_slug}" not found under this subject`);
      }

      // duplicate within the same file
      const normEn = normalize(question_en);
      if (normEn) {
        if (seenInFile.has(normEn)) {
          rowErr.push(`duplicate of row ${seenInFile.get(normEn)} in this file`);
        } else {
          seenInFile.set(normEn, row);
        }
      }

      if (rowErr.length) {
        errors.push({ row, message: rowErr.join("; ") });
        continue;
      }

      cleaned.push({
        row,
        topicId: topic._id,
        topicSlug: topic.slug,
        normEn,
        doc: {
          subjectId,
          topicId: topic._id,
          question: { en: question_en, hi: question_hi },
          options: [
            { key: "A", text: { en: a_en, hi: a_hi } },
            { key: "B", text: { en: b_en, hi: b_hi } },
            { key: "C", text: { en: c_en, hi: c_hi } },
            { key: "D", text: { en: d_en, hi: d_hi } }
          ],
          correctAnswer: answer,
          explanation: { en: explanation_en, hi: explanation_hi }
        }
      });
    }

    if (errors.length) {
      return res.status(400).json({
        message: `Upload rejected: ${errors.length} row(s) have problems. Fix them and re-upload.`,
        errors
      });
    }

    // ---- capacity: must fit within this subject's maxQuestions ----
    const remaining = subjectSlot.maxQuestions - subjectSlot.questions.length;
    if (remaining <= 0) {
      return res.status(400).json({
        message: `This subject is already full (${subjectSlot.maxQuestions}/${subjectSlot.maxQuestions}).`
      });
    }
    if (cleaned.length > remaining) {
      return res.status(400).json({
        message: `Only ${remaining} slot(s) left in this subject, but the file has ${cleaned.length}. Reduce the file or raise the subject limit.`
      });
    }

    // ---- soft duplicate check vs questions already in this subject slot ----
    const existing = await Question.find({
      _id: { $in: subjectSlot.questions.map((x) => x.questionId) }
    }).select("question.en");

    const existingNorm = new Set(existing.map((e) => normalize(e.question.en)));
    const dupes = cleaned.filter((c) => existingNorm.has(c.normEn));

    if (dupes.length && !force) {
      return res.status(200).json({
        requiresConfirmation: true,
        message: `${dupes.length} question(s) look like duplicates of ones already in this subject. Upload anyway?`,
        duplicates: dupes.map((d) => ({ row: d.row }))
      });
    }

    // ---- reserve questionCodes atomically, contiguous per topic ----
    const byTopic = new Map();
    for (const c of cleaned) {
      const key = c.topicId.toString();
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push(c);
    }

    for (const group of byTopic.values()) {
      const counter = await QuestionCounter.findOneAndUpdate(
        { subjectId, topicId: group[0].topicId },
        { $inc: { count: group.length } },
        { new: true, upsert: true }
      );
      const start = counter.count - group.length + 1; // first reserved number
      group.forEach((c, idx) => {
        const number = String(start + idx).padStart(4, "0");
        c.doc.questionCode = `${subject.slug}_${c.topicSlug}_${number}`;
      });
    }

    // ---- create questions, then attach them to the subject slot ----
    const created = await Question.insertMany(
      cleaned.map((c) => c.doc),
      { ordered: true }
    );

    created.forEach((qDoc) => {
      subjectSlot.questions.push({ questionId: qDoc._id });
    });

    await set.save();

    res.json({
      message: `Added ${created.length} question(s) to ${subject.name}.`,
      added: created.length,
      set
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Duplicate key while creating questions. Please retry.",
        details: err.keyValue
      });
    }
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