const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", require("./routes/auth.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/tests", require("./routes/test.routes"));
// app.use("/attempts", require("./routes/attempt.routes"));

module.exports = app;
