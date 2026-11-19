// Package (Test Series) controller — admin management + student browsing.

const Package = require("../models/Package");
const SetPaper = require("../models/SetPaper");
const { attemptStatusByTest, attemptSummary } = require("../utils/attemptStatus");

// A published package is locked: no edits, no deletion, no changing its mocks.
// Unpublish it first to make changes.
const blockIfPublished = (pkg, res) => {
  if (pkg.isPublished) {
    res.status(400).json({
      message: "Cannot modify a published package. Unpublish it first."
    });
    return true;
  }
  return false;
};

// helper: total questions + duration for a populated SetPaper
function setSummary(set) {
  let totalQuestions = 0;
  let totalDuration = 0;

  (set.sections || []).forEach((section) => {
    totalDuration += section.duration || 0;
    (section.subjects || []).forEach((subject) => {
      totalQuestions += (subject.questions || []).length;
    });
  });

  return {
    id: set._id,
    title: set.title,
    totalSections: (set.sections || []).length,
    totalQuestions,
    totalDuration
  };
}

// =========================
// ADMIN
// =========================

exports.createPackage = async (req, res) => {
  try {
    const { name, type, description, order } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: "name and type are required" });
    }

    const pkg = await Package.create({
      name: name.trim(),
      type: type.trim(),
      description: description || "",
      order: order || 0
    });

    res.status(201).json(pkg);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A package with this name already exists" });
    }
    res.status(500).json({ message: err.message });
  }
};

exports.getPackages = async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({ order: 1, createdAt: -1 });

    const data = packages.map((p) => ({
      _id: p._id,
      name: p.name,
      type: p.type,
      description: p.description,
      order: p.order,
      isPublished: p.isPublished,
      mockCount: (p.setPapers || []).length
    }));

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPackageById = async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id).populate("setPapers", "title isPublished isActive");

    if (!pkg) return res.status(404).json({ message: "Package not found" });

    res.json(pkg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updatePackage = async (req, res) => {
  try {
    const { name, type, description, order } = req.body;

    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    if (blockIfPublished(pkg, res)) return;

    if (name !== undefined) pkg.name = name.trim();
    if (type !== undefined) pkg.type = type.trim();
    if (description !== undefined) pkg.description = description;
    if (order !== undefined) pkg.order = order;

    await pkg.save();

    res.json(pkg);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A package with this name already exists" });
    }
    res.status(500).json({ message: err.message });
  }
};

exports.deletePackage = async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    if (blockIfPublished(pkg, res)) return;

    pkg.isActive = false;
    await pkg.save();

    res.json({ message: "Package deactivated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addSetToPackage = async (req, res) => {
  try {
    const { id, setId } = req.params;

    const pkg = await Package.findById(id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    if (blockIfPublished(pkg, res)) return;

    const set = await SetPaper.findById(setId);
    if (!set) return res.status(404).json({ message: "Set paper not found" });

    pkg.setPapers.addToSet(setId); // no duplicates
    await pkg.save();

    res.json(pkg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.removeSetFromPackage = async (req, res) => {
  try {
    const { id, setId } = req.params;

    const pkg = await Package.findById(id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    if (blockIfPublished(pkg, res)) return;

    pkg.setPapers.pull(setId);
    await pkg.save();

    res.json(pkg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.togglePublishPackage = async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    pkg.isPublished = !pkg.isPublished;
    await pkg.save();

    res.json({ message: pkg.isPublished ? "Package published" : "Package unpublished", isPublished: pkg.isPublished });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// STUDENT
// =========================

// list published packages (grouped client-side by `type` if desired)
exports.getStudentPackages = async (req, res) => {
  try {
    const packages = await Package.find({ isPublished: true, isActive: true })
      .populate("setPapers", "isPublished isActive")
      .sort({ order: 1, createdAt: -1 });

    const data = packages.map((p) => ({
      _id: p._id,
      name: p.name,
      type: p.type,
      description: p.description,
      // only count mocks a student can actually take
      mockCount: (p.setPapers || []).filter((s) => s && s.isPublished && s.isActive).length
    }));

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// a package with its available mocks
exports.getStudentPackageById = async (req, res) => {
  try {
    const pkg = await Package.findOne({
      _id: req.params.id,
      isPublished: true,
      isActive: true
    }).populate("setPapers");

    if (!pkg) return res.status(404).json({ message: "Package not available" });

    const mocks = (pkg.setPapers || [])
      .filter((s) => s && s.isPublished && s.isActive)
      .map(setSummary);

    // this student's progress on each mock (read-only)
    const progress = await attemptStatusByTest(req.user.id, mocks.map((m) => m.id));
    mocks.forEach((m) => {
      m.attempt = attemptSummary(progress, m.id);
    });

    res.json({
      _id: pkg._id,
      name: pkg.name,
      type: pkg.type,
      description: pkg.description,
      mocks
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
