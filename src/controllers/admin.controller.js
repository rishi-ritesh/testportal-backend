const Subject = require("../models/Subject");
const Topic = require("../models/Topic");

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
