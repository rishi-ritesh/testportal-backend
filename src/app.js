// Backend/src/app.js

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const mongoose = require("mongoose");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
// gzip / brotli responses over 1 KB when the browser accepts it (all do):
// a 100-question result is ~117 KB as JSON, ~16 KB compressed. The JSON
// itself is unchanged.
app.use(compression());

// bump limit so bulk question uploads (bilingual + explanations) fit
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? "ok" : "degraded",
    database: dbConnected ? "connected" : "disconnected",
    uptimeSeconds: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.use("/auth", require("./routes/auth.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/student", require("./routes/student.routes"));

module.exports = app;
