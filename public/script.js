const localVideoEl = document.getElementById("local-video-el");
const remoteVideoEl = document.getElementById("remote-video-el");

const socket = io();
const pcs = [];
let userStream = null;

// getting the camera
async function getMedia() {
  return new Promise((resolve, reject) =>
    navigator.getUserMedia({ audio: false, video: true }, resolve, reject)
  );
}

// create rtc
async function createPC() {
  const configuration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  const pc = new RTCPeerConnection(configuration);
  pcs.push(pc);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("candidate", e.candidate);
    }
  };

  pc.onaddstream = (e) => {
    playVideoFromStream(remoteVideoEl, e.stream);
  };

  pc.addStream(userStream);

  return pc;
}

// create and send offer
async function sendOffer(pc) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", offer);
}

// handle offer
function handleOffer(pc, offer) {
  pc.setRemoteDescription(new RTCSessionDescription(offer));
}

// send answer
async function sendAnswer(pc) {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", answer);
}

// handle answer event
async function handleAnswer(pc, answer) {
  const remoteDesc = new RTCSessionDescription(answer);
  await pc.setRemoteDescription(remoteDesc);
}

// handle new candidate from socket
async function handleCandidate(pc, candidate) {
  pc.addIceCandidate(candidate);
}

// gets a video element and play passed stream init
function playVideoFromStream(videoObject, stream) {
  videoObject.srcObject = stream;
  videoObject.onloadedmetadata = () => {
    videoObject.play();
  };
}

async function onOfferButtonClick() {
  const pc = await createPC();
  sendOffer(pc);
}

// init handlers for all socket possible events
function initSocketHandlers() {
  socket.on("offer", async (offer) => {
    const pc = await createPC();
    handleOffer(pc, offer);
    sendAnswer(pc);
  });

  socket.on("answer", (answer) => {
    const pc = pcs[0];
    handleAnswer(pc, answer);
  });

  socket.on("candidate", (candidate) => {
    const pc = pcs[0];
    handleCandidate(pc, candidate);
  });
}

// running the app
const action = async () => {
  userStream = await getMedia();
  playVideoFromStream(localVideoEl, userStream);
  initSocketHandlers();
};

action();
