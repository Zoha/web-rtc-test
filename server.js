const express = require("express");
const app = express();
const httpServer = require("http").createServer(app);

/** @type {import("socket.io").Server} */
// @ts-ignore
const io = require("socket.io")(httpServer);
const { greenBright: green } = require("chalk");

const socketEvents = {
  // wen answer received
  SERVER_PEERS_ANSWER: "server:peers.answer",
  // wen offer received
  SERVER_PEERS_OFFER: "server:peers.offer",
  // wen candidate received
  SERVER_PEERS_CANDIDATE: "server:peers.candidate",
  // wen this user become a host
  SERVER_PEERS_HOST: "server:peers.host",
  // from server - notify children to re offer
  SERVER_PEERS_RE_OFFER: "server:peers.reOffer",
  // from server - notify that user should close the publisher
  SERVER_PEERS_CHILDREN_DISCONNECTED: "server:peers.childrenDisconnected",
  // server sends tree
  SERVER_PEERS_TREE: "server:peers.tree",
  // send id to user
  SERVER_NUMBER_ID: "server:numberId",
  // send answer
  CLIENT_PEERS_ANSWER: "client:peers.answer",
  // send offer
  CLIENT_PEERS_OFFER: "client:peers.offer",
  // send candidate
  CLIENT_PEERS_CANDIDATE: "client:peers.candidate",
  // send host request
  CLIENT_PEERS_HOST: "client:peers.host",
};

const MAXIMUM_PUBLISHER_PER_USER = 2;

let peers = [];
/**
 *
 * @param {string} socketId
 * @param {string} socketNumberId
 * @param {string} [parentId]
 * @returns
 */
const saveAPeerSocket = (socketId, socketNumberId, parentId) => {
  let parent;
  if (parentId) {
    parent = peers.find((i) => i.id === parentId);
    if (!parent) {
      return;
    }
  }
  let existedPeer;
  if ((existedPeer = peers.find((i) => i.id === socketId))) {
    if (parent) {
      existedPeer.parent = parent;
      parent.children.push(existedPeer);
    }
    return;
  }
  const result = {
    parent,
    id: socketId,
    numberId: socketNumberId,
    children: [],
  };
  if (parent) {
    parent.children.push(result);
  }
  peers.push(result);
};

/**
 * @returns {Promise.<string>}
 */
const findAGoodParentPeer = async () => {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
  return peers.find((i) => i.children.length < MAXIMUM_PUBLISHER_PER_USER)?.id;
};

const getPeersTree = (children) => {
  children = children || peers.filter((i) => !i.parent);
  const result = [];

  children.forEach((child) => {
    const mappedChild = {
      id: child.id,
      numberId: child.numberId,
    };
    mappedChild.parent = child.parent?.id;
    mappedChild.children = getPeersTree(child.children);
    result.push(mappedChild);
  });

  return result;
};

let numberId = 0;
io.on("connection", (socket) => {
  // on connection sends tree
  // for escape from recursive data we parse it as json
  io.emit(socketEvents.SERVER_PEERS_TREE, getPeersTree());

  // send number id
  // @ts-ignore
  socket.numberId = ++numberId;

  // @ts-ignore
  socket.emit(socketEvents.SERVER_NUMBER_ID, numberId);

  // hosting functionality
  socket.on(socketEvents.CLIENT_PEERS_HOST, () => {
    peers = [];

    // @ts-ignore
    saveAPeerSocket(socket.id, socket.numberId);

    socket.emit(socketEvents.SERVER_PEERS_HOST);

    io.emit(socketEvents.SERVER_PEERS_TREE, getPeersTree());
  });

  socket.on(socketEvents.CLIENT_PEERS_OFFER, async (offer) => {
    const selectedParent = await findAGoodParentPeer();
    if (!selectedParent) {
      return;
    }
    io.to(selectedParent).emit(
      socketEvents.SERVER_PEERS_OFFER,
      socket.id,
      // @ts-ignore
      socket.numberId,
      offer
    );
  });

  socket.on(
    socketEvents.CLIENT_PEERS_ANSWER,
    (receiverId, receiverNumberId, answer) => {
      saveAPeerSocket(receiverId, receiverNumberId, socket.id);
      console.log(green(`${receiverId} connected to ${socket.id}`));
      io.to(receiverId).emit(
        socketEvents.SERVER_PEERS_ANSWER,
        socket.id,
        // @ts-ignore
        socket.numberId,
        answer
      );
      io.emit(socketEvents.SERVER_PEERS_TREE, getPeersTree());
    }
  );

  socket.on(socketEvents.CLIENT_PEERS_CANDIDATE, (id, answer) => {
    socket.broadcast.emit(socketEvents.SERVER_PEERS_CANDIDATE, id, answer);
  });

  socket.on("disconnect", () => {
    const peer = peers.find((i) => i.id === socket.id);
    if (!peer) {
      return;
    }

    // remove item from peers list
    peers = peers.filter((i) => i !== peer);

    // remove item from its parent and also notify parent
    if (peer.parent) {
      peer.parent.children = peer.parent.children.filter((i) => i !== peer);
      io.to(peer.parent.id).emit(
        socketEvents.SERVER_PEERS_CHILDREN_DISCONNECTED,
        socket.id
      );
    } else {
      peers = [];
    }

    // notify children to re-offer
    if (peer.children.length) {
      io.to(peer.children.map((i) => i.id)).emit(
        socketEvents.SERVER_PEERS_RE_OFFER
      );
    }

    io.emit(socketEvents.SERVER_PEERS_TREE, getPeersTree());
  });
});

app.use(express.static("public"));

httpServer.listen(8000, () => {
  console.info("server is running on 8000 port");
});
