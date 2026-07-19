// Backend/src/app.js

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
// bump limit so bulk question uploads (bilingual + explanations) fit
app.use(express.json({ limit: "5mb" }));

app.use("/auth", require("./routes/auth.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/student", require("./routes/student.routes"));

module.exports = app;
