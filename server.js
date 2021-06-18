const express = require("express");
const app = express();
const httpServer = require("http").createServer(app);
const io = require("socket.io")(httpServer);

io.on("connection", (socket) => {
  socket.on("offer", (offer) => {
    console.log("offer", offer);
    socket.broadcast.emit("offer", offer);
  });
  socket.on("answer", (answer) => {
    console.log("answer", answer);
    socket.broadcast.emit("answer", answer);
  });

  socket.on("candidate", (candidate) => {
    console.log("candidate", candidate);
    socket.broadcast.emit("candidate", candidate);
  });
});

app.use(express.static("public"));

httpServer.listen(8000, () => {
  console.log("server is running on 8000 port");
});
