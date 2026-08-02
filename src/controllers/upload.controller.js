// Backend/src/controllers/upload.controller.js
//
// Takes an image from the admin panel, sends it to Cloudinary, and returns the
// web address to put inside the question.
//
// Nothing is written to this server's disk — Render wipes its disk on every
// redeploy, which would silently break every question using an image.

const multer = require("multer");
const { cloudinary, isConfigured } = require("../utils/cloudinary");

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];

// Hold the file in memory just long enough to pass it on.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, WEBP, GIF or SVG images are allowed."));
    }
    cb(null, true);
  },
});

// Middleware wrapper so multer's own errors come back as clean JSON
// instead of crashing the request.
exports.receiveImage = (req, res, next) => {
  memoryUpload.single("image")(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: "That image is larger than 2 MB. Please compress it and try again.",
      });
    }
    return res.status(400).json({ message: err.message || "Upload failed." });
  });
};

exports.uploadImage = async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(500).json({
        message:
          "Image storage is not set up. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the environment.",
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image received." });
    }

    const folder = req.body.folder === "explanation" ? "testportal/explanations" : "testportal/questions";

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          // Shrink anything huge, and let Cloudinary pick the best format and
          // quality per device. Cuts bandwidth roughly in half.
          transformation: [
            { width: 1200, crop: "limit" },
            { quality: "auto", fetch_format: "auto" },
          ],
        },
        (error, uploaded) => (error ? reject(error) : resolve(uploaded))
      );
      stream.end(req.file.buffer);
    });

    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    });
  } catch (err) {
    console.error("Cloudinary upload failed:", err?.message || err);
    res.status(500).json({ message: "Could not upload the image. Please try again." });
  }
};

// Optional: remove an image from Cloudinary (e.g. an admin deletes a question).
exports.deleteImage = async (req, res) => {
  try {
    const { publicId } = req.body;
    if (!publicId) return res.status(400).json({ message: "publicId is required." });

    await cloudinary.uploader.destroy(publicId);
    res.json({ message: "Image removed." });
  } catch (err) {
    console.error("Cloudinary delete failed:", err?.message || err);
    res.status(500).json({ message: "Could not remove the image." });
  }
};
