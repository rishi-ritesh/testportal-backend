// Backend/src/middleware/student.middleware.js

module.exports = (req, res, next) => {

  // ✅ student allowed
  if (req.user.role === "student") {
    return next();
  }

  // ✅ admin also allowed
  if (req.user.role === "admin") {
    return next();
  }

  return res.status(403).json({
    message: "Access denied."
  });
};