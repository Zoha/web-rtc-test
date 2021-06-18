const express = require("express");
const app = express();
const httpServer = require("http").createServer(app);

/** @type {import("socket.io").Server} */
const io = require("socket.io")(httpServer);
const { greenBright: green, grey, blueBright: blue } = require("chalk");

const findAParentPeerForSocket = async (socket) => {
  let selectedSocket = null;

  io.sockets.sockets.forEach((s) => {
    if (
      socket.id !== s.id &&
      s.childrenPeers.length < 2 &&
      (!selectedSocket ||
        s.childrenPeers.length > selectedSocket.childrenPeers.length)
    ) {
      selectedSocket = s;
    }
  });

  if (selectedSocket) {
    return selectedSocket.id;
  }

  return selectedSocket;
};

let socketsCount = 1;
io.on("connection", async (socket) => {
  // just for better logging
  socket.autoIncrementId = socketsCount++;
  // custom properties for saving children and parent
  socket.childrenPeers = [];
  socket.parentPeer = null;
  socket.isHost = io.sockets.sockets.size === 0;
  console.info(grey(`socket ${socket.autoIncrementId} connected`));

  // select a parent and send an offer for it
  socket.on("offer", async (offer) => {
    const selectedParent = await findAParentPeerForSocket(socket);
    if (!selectedParent) {
      return;
    }
    socket.parentPeer = selectedParent;
    socket.broadcast.to(socket.parentPeer).emit("offer", socket.id, offer);
  });

  // put new childId to childrenPeers and sent answer for it
  socket.on("answer", async (childId, answer) => {
    socket.childrenPeers.push(childId);
    socket.broadcast.to(childId).emit("answer", answer);

    //  log connection
    console.info(
      green(
        `socket ${blue(
          io.sockets.sockets.get(childId)?.autoIncrementId
        )} connected to ${blue(socket.autoIncrementId)}`
      )
    );
  });

  // broadcast candidate for the targetId
  socket.on("candidate", (targetId, candidate) => {
    socket.broadcast.emit("candidate", targetId, candidate);
  });

  // on disconnect we remove socket from its parent
  // and also we should notify all the children
  // children will try to connect to another peer
  socket.on("disconnect", () => {
    if (socket.isHost) {
      return;
    }
    if (socket.parentPeer) {
      const parentPeerSocket = io.sockets.sockets.get(socket.parentPeer);
      if (parentPeerSocket) {
        parentPeerSocket.childrenPeers = parentPeerSocket.childrenPeers.filter(
          (s) => s !== socket.id
        );
      }
    }
    socket.to(socket.parentPeer).emit("childrenDisconnected", socket.id);
    socket.to(socket.childrenPeers).emit("reOffer");
  });
});

app.use(express.static("public"));

httpServer.listen(8000, () => {
  console.info("server is running on 8000 port");
});
