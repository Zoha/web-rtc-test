"use strict";

const debug = false;

// @ts-ignore
// eslint-disable-next-line no-undef
const socket = io();

const log = (...args) => {
  if (debug) {
    console.log(...args);
  }
};

const webRTCConfiguration = {
  iceServers: [
    {
      url: "stun:stun.ekiga.net",
      urls: ["stun:stun.ekiga.net"],
    },
    {
      url: "stun:stun4.l.google.com:19302",
      urls: ["stun:stun4.l.google.com:19302"],
    },
  ],
};

let receiver = null;

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

async function getMedia() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: 1280, height: 720 },
  });
}

class Publisher {
  constructor() {
    /** @type {string} */
    this.receiverId = null;
    /** @type {string} */
    this.receiverNumberId = null;
    /** @type {RTCPeerConnection} */
    this.peer = null;
    this.createPeer();
  }
  createPeer() {
    this.peer = new RTCPeerConnection(webRTCConfiguration);
    this.peer.addEventListener("icecandidate", (event) => {
      this.onLocalCandidateReceive(event);
    });
    this.addReceiverTracks();
  }

  addReceiverTracks() {
    const stream = receiver.player.srcObject;
    let newTracks = new Set();
    this.peer.getSenders().forEach((sender) => {
      stream.getTracks().forEach((track) => {
        if (track.kind === sender.track.kind) {
          sender.replaceTrack(track);
        } else {
          newTracks.add(track);
        }
      });
    });
    if (!newTracks.size) {
      newTracks = stream.getTracks();
    }
    for (const newTrack of newTracks) {
      this.peer.addTrack(newTrack, stream);
    }
  }
  async onOffer(receiverId, receiverNumberId, offer) {
    log(`offer on publisher, receiverId : ${receiverId}`);
    this.receiverId = receiverId;
    this.receiverNumberId = receiverNumberId;
    this.peer.setRemoteDescription(new RTCSessionDescription(offer));
    this.answer();
  }
  async answer() {
    log(`answer on publisher, receiverId : ${this.receiverId}`);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    // we should send id too because the user is unknown to signal controller
    socket.emit(
      socketEvents.CLIENT_PEERS_ANSWER,
      this.receiverId,
      this.receiverNumberId,
      answer
    );
  }
  replaceTracks() {
    log("replace tracks");
    this.addReceiverTracks();
  }
  onLocalCandidateReceive(event) {
    log(`local candidate received in publisher event:`, event);
    if (event.candidate) {
      socket.emit(
        socketEvents.CLIENT_PEERS_CANDIDATE,
        socket.id,
        event.candidate
      );
    }
  }
  onRemoteCandidateReceive(id, candidate) {
    console.log("REMOTE ICE");
    log(`remote candidate received from id: ${id}, candidate:`, candidate);
    if (this.receiverId === id && this.peer) {
      this.peer.addIceCandidate(candidate);
    }
  }
  close() {
    this.peer.close();
  }
}

class ReceiverBase {
  constructor() {
    /** @type {string} */
    this.senderId = null;
    /** @type {string} */
    this._senderNumberId = null;
    /** @type {HTMLVideoElement} */
    // @ts-ignore
    this.player = document.getElementById("local-video-el");
    /** @type {Object.<string , Publisher>} */
    this.publishers = {};
    /** @type {RTCPeerConnection} */
    this.peer = null;
  }

  get senderNumberId() {
    return this._senderNumberId;
  }

  set senderNumberId(value) {
    $("#peer-to-peer-details").toggle(!!value || socket.numberId);
    $("#peer-to-peer-details").html(
      value
        ? `
      Audience : <span class="text-primary">${socket.numberId}</span> connected to <span class="text-warning">${value}</span>
    `
        : `Publisher : <span class="text-success">${socket.numberId}</span>`
    );
    this._senderNumberId = value;
  }

  playVideoFromStream(stream) {
    const player = this.player;
    player.srcObject = stream;
    player.load();
    player.play();

    console.log("%c changing src", "color:red");
    player.onloadedmetadata = () => {
      console.log("%c playing", "color:red");
      player.play();
    };
  }

  stopPlayer() {
    const player = this.player;
    player.srcObject = null;
    player.pause();
    player.load();
  }

  onDisconnect() {
    log(`on disconnected in receiver base`);
  }
  onLocalCandidateReceive(event) {
    log(
      `on local candidate in receiver base, selfId : ${socket.id} , event:`,
      event
    );
    if (event.candidate) {
      socket.emit(
        socketEvents.CLIENT_PEERS_CANDIDATE,
        socket.id,
        event.candidate
      );
    }
  }
  onRemoteCandidateReceive(id, candidate) {
    log(`remote candidate receiver base, id : ${id},  candidate:`, candidate);
    if (this.senderId === id && this.peer) {
      this.peer.addIceCandidate(candidate);
    }
    if (this.publishers[id]) {
      this.publishers[id].onLocalCandidateReceive(candidate);
    }
  }
  addPublisher(publisher) {
    log(`add publisher `, publisher);
    this.publishers[publisher.id] = publisher;
  }
  removePublisher(publisher) {
    log(`remove publisher `, publisher);
    publisher.close();
    delete this.publishers[publisher.id];
  }
}

class LocalReceiver extends ReceiverBase {
  constructor() {
    super();
    this.playVideoFromLocalMedia();
    this.senderNumberId = null;
  }
  async playVideoFromLocalMedia() {
    const stream = await getMedia();
    this.playVideoFromStream(stream);
  }
}

class Receiver extends ReceiverBase {
  constructor() {
    super();
    this.createPeer();
  }
  createPeer() {
    this.peer = new RTCPeerConnection(webRTCConfiguration);
    this.peer.addEventListener("icecandidate", (event) => {
      this.onLocalCandidateReceive(event);
    });
    this.peer.addEventListener("track", (event) => {
      this.onTrack(event);
    });
  }
  async offer() {
    const offer = await this.peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true,
    });
    await this.peer.setLocalDescription(offer);
    // we don't need user id because user id is the current socket
    socket.emit(socketEvents.CLIENT_PEERS_OFFER, offer);
  }
  async reOffer() {
    this.senderNumberId = "connecting...";
    this.stopPlayer();
    this.offer();
    this.replacePublishersTracks();
  }

  replacePublishersTracks() {
    Object.values(this.publishers).forEach((publisher) => {
      publisher.replaceTracks();
    });
  }

  onTrack(event) {
    if (event.streams[0]) {
      if (!this.player.srcObject) {
        const media = new MediaStream();
        media.addTrack(event.track);
        this.playVideoFromStream(media);
      } else {
        /** @type {MediaStream} */
        // @ts-ignore
        const media = this.player.srcObject;
        media.getTracks().forEach((track) => {
          if (event.track.kind === track.kind) {
            media.removeTrack(track);
          }
        });
        media.addTrack(event.track);
        this.playVideoFromStream(media);
      }
    }
  }

  async onAnswer(senderId, senderNumberId, answer) {
    log(`on answer senderId ${senderId}`);
    this.senderId = senderId;
    this.senderNumberId = senderNumberId;
    const remoteDesc = new RTCSessionDescription(answer);
    await this.peer.setRemoteDescription(remoteDesc);
  }
}

// eslint-disable-next-line no-unused-vars
function onHostButtonClicked() {
  if (receiver) {
    return;
  }
  socket.emit(socketEvents.CLIENT_PEERS_HOST);
}
// eslint-disable-next-line no-unused-vars
function onJoinButtonClicked() {
  if (receiver) {
    return;
  }

  /** @type {Receiver} */
  receiver = new Receiver();
  receiver.offer();
}

(async () => {
  socket.on(socketEvents.SERVER_NUMBER_ID, (numberId) => {
    socket.numberId = numberId;
  });

  // when we become a host -> create a local receiver stream
  socket.on(socketEvents.SERVER_PEERS_HOST, () => {
    log(`SERVER_PEERS_HOST socket event`);
    receiver = new LocalReceiver();
  });

  socket.on(
    socketEvents.SERVER_PEERS_OFFER,
    (receiverId, receiverNumberId, offer) => {
      log(`SERVER_PEERS_OFFER socket event`, receiverId, offer);
      if (receiver) {
        const publisher = new Publisher();
        receiver.addPublisher(publisher);
        publisher.onOffer(receiverId, receiverNumberId, offer);
      }
    }
  );

  socket.on(socketEvents.SERVER_PEERS_CANDIDATE, (id, candidate) => {
    log(`SERVER_PEERS_CANDIDATE socket event`, id, candidate);

    if (receiver) {
      receiver.onRemoteCandidateReceive(id, candidate);
    }
  });

  socket.on(
    socketEvents.SERVER_PEERS_ANSWER,
    (senderId, senderNumberId, answer) => {
      log(`SERVER_PEERS_ANSWER socket event`, senderId, answer);
      if (receiver) {
        receiver.onAnswer(senderId, senderNumberId, answer);
      }
    }
  );

  socket.on(socketEvents.SERVER_PEERS_RE_OFFER, () => {
    log(`SERVER_PEERS_RE_OFFER socket event`);
    if (receiver) {
      receiver.reOffer();
    }
  });

  socket.on(socketEvents.SERVER_PEERS_CHILDREN_DISCONNECTED, (id) => {
    log(`SERVER_PEERS_CHILDREN_DISCONNECTED socket event`);
    if (receiver) {
      const publisher = receiver.publishers[id];
      if (publisher) {
        receiver.removePublisher(publisher);
      }
    }
  });

  socket.on(socketEvents.SERVER_PEERS_TREE, (peersTree) => {
    if (peersTree && !peersTree.length) {
      receiver = null;
    }
    const hostBtn = $("#host-btn");
    const joinBtn = $("#join-btn");
    const btnsCard = $("#btns-card").stop();
    const connectionsList = $("#connections-list").stop();

    !peersTree.length ? hostBtn.show() : hostBtn.hide();
    peersTree.length ? joinBtn.show() : joinBtn.hide();
    !receiver || !peersTree.length ? btnsCard.slideDown() : btnsCard.slideUp();
    peersTree.length || receiver
      ? connectionsList.slideDown()
      : connectionsList.slideUp();
    $("#connections-list").text(JSON.stringify(peersTree, null, 2));
  });
})();
