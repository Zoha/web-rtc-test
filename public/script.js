const localVideoEl = document.getElementById("local-video-el");
const remoteVideoEl = document.getElementById("remote-video-el");

const socket = io();
let parentPc = null;
const childrenPcs = {};
let parentStream = null;

// getting the camera
async function getMedia() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: 1280, height: 720 },
  });
}

async function createPC(childId, forceReloadStream = false) {
  const configuration = {
    iceServers: [{ urls: "stun:stun.1.google.com:19302" }],
  };

  const pc = new RTCPeerConnection(configuration);
  if (childId) {
    childrenPcs[childId] = pc;
  } else {
    parentPc = pc;
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("candidate", childId, e.candidate);
    }
  };

  pc.ontrack = (e) => {
    if (e.streams[0] && localVideoEl.srcObject !== e.streams[0]) {
      if (!parentStream || forceReloadStream) {
        parentStream = e.streams[0];
        playVideoFromStream(localVideoEl, e.streams[0]);
      }
    }
  };

  if (!parentStream && !parentPc) {
    parentStream = await getMedia();
    playVideoFromStream(localVideoEl, parentStream);
  }

  if (parentStream) {
    for (const track of parentStream.getTracks()) {
      pc.addTrack(track, parentStream);
    }
  }

  return pc;
}

async function sendOffer(pc) {
  const offer = await pc.createOffer({
    offerToReceiveAudio: 0,
    offerToReceiveVideo: 1,
  });
  await pc.setLocalDescription(offer);
  socket.emit("offer", offer);
}

async function handleOffer(pc, offer) {
  pc.setRemoteDescription(new RTCSessionDescription(offer));
}

async function sendAnswer(childId, pc) {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", childId, answer);
}

async function handleAnswer(pc, answer) {
  const remoteDesc = new RTCSessionDescription(answer);
  await pc.setRemoteDescription(remoteDesc);
}

async function handleCandidate(pc, candidate) {
  pc.addIceCandidate(candidate);
}

function playVideoFromStream(videoObject, stream) {
  videoObject.srcObject = stream;
}

async function onOfferButtonClick() {
  const pc = await createPC();
  await sendOffer(pc);
}

// init handlers for all socket possible events
function initSocketHandlers() {
  socket.on("offer", async (childId, offer) => {
    const pc = await createPC(childId);
    await handleOffer(pc, offer);
    await sendAnswer(childId, pc);
  });

  socket.on("answer", (answer) => {
    handleAnswer(parentPc, answer);
  });

  socket.on("candidate", (id, candidate) => {
    const pc = childrenPcs[id] || parentPc;

    if (pc) {
      handleCandidate(pc, candidate);
    }
  });

  socket.on("reOffer", async () => {
    if (parentStream) {
      parentPc = null;
      const pc = await createPC(null, true);
      await sendOffer(pc);
    }
  });

  socket.on("childrenDisconnected", (childId) => {
    delete childrenPcs[childId];
  });
}

// running the app
const action = async () => {
  initSocketHandlers();
};

action();
