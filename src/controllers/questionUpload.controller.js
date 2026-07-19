const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const QuestionCounter = require("../models/QuestionCounter");

// Bulk-create questions straight into the question bank (not tied to a set).
// Every question is validated against the Question schema first — including the
// required bilingual explanation and a generated questionCode — so the whole
// batch is all-or-nothing: if any row is bad, nothing is inserted.
exports.bulkUploadQuestions = async (req, res) => {
  try {
    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: "No questions provided" });
    }
    if (questions.length > 500) {
      return res.status(400).json({
        message: "Too many questions in one upload (max 500). Please split the file."
      });
    }

    const errors = [];
    const cleaned = [];
    const subjectCache = new Map(); // slug -> subject | null
    const topicCache = new Map(); // "subjectId:slug" -> topic | null

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] || {};
      const row = i + 1;
      const rowErr = [];
      const get = (k) => (typeof q[k] === "string" ? q[k].trim() : q[k]);

      const subject_slug = get("subject_slug");
      const topic_slug = get("topic_slug");
      const question_en = get("question_en");
      const question_hi = get("question_hi");
      const o1e = get("option1_en"), o2e = get("option2_en"), o3e = get("option3_en"), o4e = get("option4_en");
      const o1h = get("option1_hi"), o2h = get("option2_hi"), o3h = get("option3_hi"), o4h = get("option4_hi");
      const answer = String(get("answer") || "").trim().toUpperCase();
      const explanation_en = get("explanation_en");
      const explanation_hi = get("explanation_hi");

      if (!subject_slug) rowErr.push("missing subject_slug");
      if (!topic_slug) rowErr.push("missing topic_slug");
      if (!question_en || !question_hi) rowErr.push("question_en and question_hi are required");
      if (!o1e || !o2e || !o3e || !o4e) rowErr.push("all four English options are required");
      if (!o1h || !o2h || !o3h || !o4h) rowErr.push("all four Hindi options are required");
      if (!["A", "B", "C", "D"].includes(answer)) rowErr.push("answer must be one of A, B, C, D");
      if (!explanation_en || !explanation_hi) rowErr.push("explanation_en and explanation_hi are required");

      // resolve subject by slug
      let subject = null;
      if (subject_slug) {
        if (subjectCache.has(subject_slug)) {
          subject = subjectCache.get(subject_slug);
        } else {
          subject = await Subject.findOne({ slug: subject_slug, isActive: true });
          subjectCache.set(subject_slug, subject || null);
        }
        if (!subject) rowErr.push(`subject "${subject_slug}" not found`);
      }

      // resolve topic within that subject
      let topic = null;
      if (subject && topic_slug) {
        const key = `${subject._id}:${topic_slug}`;
        if (topicCache.has(key)) {
          topic = topicCache.get(key);
        } else {
          topic = await Topic.findOne({ slug: topic_slug, subjectId: subject._id, isActive: true });
          topicCache.set(key, topic || null);
        }
        if (!topic) rowErr.push(`topic "${topic_slug}" not found under subject "${subject_slug}"`);
      }

      if (rowErr.length) {
        errors.push({ row, message: rowErr.join("; ") });
        continue;
      }

      cleaned.push({
        subjectId: subject._id,
        topicId: topic._id,
        subjectSlug: subject.slug,
        topicSlug: topic.slug,
        doc: {
          subjectId: subject._id,
          topicId: topic._id,
          question: { en: question_en, hi: question_hi },
          options: [
            { key: "A", text: { en: o1e, hi: o1h } },
            { key: "B", text: { en: o2e, hi: o2h } },
            { key: "C", text: { en: o3e, hi: o3h } },
            { key: "D", text: { en: o4e, hi: o4h } }
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

    // reserve questionCodes atomically, contiguous per (subject, topic)
    const byTopic = new Map();
    for (const c of cleaned) {
      const key = `${c.subjectId}:${c.topicId}`;
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push(c);
    }

    for (const group of byTopic.values()) {
      const { subjectId, topicId, subjectSlug, topicSlug } = group[0];
      const counter = await QuestionCounter.findOneAndUpdate(
        { subjectId, topicId },
        { $inc: { count: group.length } },
        { new: true, upsert: true }
      );
      const start = counter.count - group.length + 1;
      group.forEach((c, idx) => {
        const number = String(start + idx).padStart(4, "0");
        c.doc.questionCode = `${subjectSlug}_${topicSlug}_${number}`;
      });
    }

    const created = await Question.insertMany(cleaned.map((c) => c.doc), { ordered: true });

    res.json({
      message: "Bulk upload completed",
      inserted: created.length
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Duplicate key while creating questions",
        details: err.keyValue
      });
    }
    res.status(500).json({ message: err.message });
  }
};
