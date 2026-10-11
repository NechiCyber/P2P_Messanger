(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    passphrase: $("passphrase"), signalBox: $("signalBox"),
    createOfferBtn: $("createOfferBtn"), acceptOfferBtn: $("acceptOfferBtn"),
    copySignalBtn: $("copySignalBtn"), applyAnswerBtn: $("applyAnswerBtn"),
    resetBtn: $("resetBtn"), chatLog: $("chatLog"), chatForm: $("chatForm"),
    messageInput: $("messageInput"), sendBtn: $("sendBtn"),
    statusDot: $("statusDot"), statusText: $("statusText")
  };

  let pc = null;
  let channel = null;
  let aesKey = null;
  let roomSalt = null;
  let isInitiator = false;
  let connected = false;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function setStatus(text, online = false) {
    els.statusText.textContent = text;
    els.statusDot.classList.toggle("online", online);
  }

  function addMessage(who, text, mine = false) {
    const empty = els.chatLog.querySelector(".empty");
    if (empty) empty.remove();
    const item = document.createElement("div");
    item.className = "msg" + (mine ? " me" : "");
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${who} · ${new Date().toLocaleTimeString()}`;
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    item.append(meta, body);
    els.chatLog.appendChild(item);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function showError(error) {
    console.error(error);
    alert(error && error.message ? error.message : String(error));
  }

  function getPassphrase() {
    const pass = els.passphrase.value;
    if (pass.length < 12) {
      throw new Error("Use a shared passphrase of at least 12 characters on both devices.");
    }
    return pass;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function deriveKey(passphrase, salt) {
    const material = await crypto.subtle.importKey(
      "raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptMessage(text) {
    if (!aesKey) throw new Error("Encryption key is not ready.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, aesKey, encoder.encode(text)
    );
    return JSON.stringify({
      type: "message",
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(ciphertext))
    });
  }

  async function decryptMessage(packet) {
    const parsed = JSON.parse(packet);
    if (parsed.type !== "message") return;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
      aesKey,
      base64ToBytes(parsed.data)
    );
    return decoder.decode(plaintext);
  }

  function setChatEnabled(enabled) {
    connected = enabled;
    els.messageInput.disabled = !enabled;
    els.sendBtn.disabled = !enabled;
    setStatus(enabled ? "Encrypted channel open" : "Not connected", enabled);
  }

  function closePeer() {
    setChatEnabled(false);
    aesKey = null;
    roomSalt = null;
    if (channel) {
      try { channel.close(); } catch (_) { }
    }
    if (pc) {
      try { pc.close(); } catch (_) { }
    }
    channel = null;
    pc = null;
  }

  function makePeer() {
    setChatEnabled(false);

    if (channel) {
      try { channel.close(); } catch (_) { }
    }

    if (pc) {
      try { pc.close(); } catch (_) { }
    }

    channel = null;
    pc = null;
    // STUN helps discover public-facing candidates. It does not relay chat messages.
    // Some networks still require TURN or will not permit a direct connection.
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pc.onconnectionstatechange = () => {
      if (pc && ["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        setChatEnabled(false);
        if (pc.connectionState === "failed") setStatus("Connection failed");
      }
    };
    pc.ondatachannel = (event) => setupChannel(event.channel);
    return pc;
  }

  function setupChannel(ch) {
    channel = ch;
    channel.onopen = async () => {
      try {
        // The same passphrase and room salt are entered/received on both devices.
        aesKey = await deriveKey(getPassphrase(), roomSalt);
        setChatEnabled(true);
        addMessage("SYSTEM", "Channel open. App-level encryption key derived.", false);
      } catch (error) {
        setChatEnabled(false);
        showError(error);
      }
    };
    channel.onmessage = async (event) => {
      try {
        if (typeof event.data !== "string") return;
        const text = await decryptMessage(event.data);
        if (typeof text === "string") addMessage("PEER", text, false);
      } catch (_) {
        addMessage("SYSTEM", "Could not decrypt incoming data. Check the shared secret or connection.", false);
      }
    };
    channel.onclose = () => {
      setChatEnabled(false);
      addMessage("SYSTEM", "Peer disconnected.", false);
    };
    channel.onerror = () => setStatus("Data channel error");
  }

  function waitForIceGathering(peer) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("ICE gathering timed out. Try again or check your network."));
      }, 20000);
      function cleanup() {
        clearTimeout(timeout);
        peer.removeEventListener("icegatheringstatechange", check);
      }
      function check() {
        if (peer.iceGatheringState === "complete") {
          cleanup();
          resolve();
        }
      }
      peer.addEventListener("icegatheringstatechange", check);
    });
  }

  function packageSignal(description, salt) {
    return JSON.stringify({
      app: "NechiP2P",
      version: 1,
      description: { type: description.type, sdp: description.sdp },
      salt: bytesToBase64(salt)
    });
  }

  function parseSignal(text) {
    let data;
    try { data = JSON.parse(text); } catch (_) {
      throw new Error("Connection data is not valid JSON.");
    }
    if (!data || data.app !== "NechiP2P" || data.version !== 1 ||
      !data.description || !["offer", "answer"].includes(data.description.type) ||
      typeof data.description.sdp !== "string" || typeof data.salt !== "string") {
      throw new Error("This does not look like valid Nechi P2P connection data.");
    }
    return data;
  }

  async function createOffer() {
    try {
      const pass = getPassphrase();
      isInitiator = true;
      roomSalt = crypto.getRandomValues(new Uint8Array(16));
      await deriveKey(pass, roomSalt); // Validate crypto support/passphrase before signalling.
      const peer = makePeer();
      setupChannel(peer.createDataChannel("nechi-chat", { ordered: true }));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      setStatus("Preparing offer…");
      await waitForIceGathering(peer);
      els.signalBox.value = packageSignal(peer.localDescription, roomSalt);
      setStatus("Offer ready — send it to your peer");
      addMessage("SYSTEM", "Offer created. Send the connection data to your peer using a trusted channel.", false);
    } catch (error) { showError(error); }
  }

  async function acceptOffer() {
    try {
      getPassphrase();
      const data = parseSignal(els.signalBox.value.trim());
      if (data.description.type !== "offer") {
        throw new Error("Paste an offer created by the other device first.");
      }
      const accepted = confirm(
        "Accept this incoming connection request? Only continue if you expected it. " +
        "For identity verification, compare fingerprints through a separate trusted channel."
      );
      if (!accepted) return;

      isInitiator = false;
      roomSalt = base64ToBytes(data.salt);
      await deriveKey(getPassphrase(), roomSalt);
      const peer = makePeer();
      await peer.setRemoteDescription(data.description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      setStatus("Preparing answer…");
      await waitForIceGathering(peer);
      els.signalBox.value = packageSignal(peer.localDescription, roomSalt);
      addMessage("SYSTEM", "Offer accepted. Send this answer back to the person who created the offer.", false);
      setStatus("Answer ready — return it to the offerer");
    } catch (error) { showError(error); }
  }

  async function applyAnswer() {
    try {
      if (!pc || !isInitiator) throw new Error("Create an offer on this device first.");
      const data = parseSignal(els.signalBox.value.trim());
      if (data.description.type !== "answer") throw new Error("Paste the answer from the other device.");
      if (data.salt !== bytesToBase64(roomSalt)) throw new Error("The answer's room salt does not match this offer.");
      await pc.setRemoteDescription(data.description);
      addMessage("SYSTEM", "Answer applied. Waiting for the peer connection…", false);
      setStatus("Connecting…");
    } catch (error) { showError(error); }
  }

  async function copySignal() {
    const value = els.signalBox.value.trim();
    if (!value) return alert("There is no connection data to copy yet.");
    try {
      await navigator.clipboard.writeText(value);
      alert("Connection data copied.");
    } catch (_) {
      els.signalBox.focus();
      els.signalBox.select();
      alert("Automatic copy failed. The text is selected; copy it manually.");
    }
  }

  els.createOfferBtn.addEventListener("click", createOffer);
  els.acceptOfferBtn.addEventListener("click", acceptOffer);
  els.applyAnswerBtn.addEventListener("click", applyAnswer);
  els.copySignalBtn.addEventListener("click", copySignal);
  els.resetBtn.addEventListener("click", () => {
    closePeer();
    els.signalBox.value = "";
    els.chatLog.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Messages will appear here after the connection opens.";
    els.chatLog.appendChild(empty);
    setStatus("Not connected");
  });

  els.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = els.messageInput.value;
    if (!text.trim() || !connected || !channel || channel.readyState !== "open") return;
    try {
      const packet = await encryptMessage(text);
      channel.send(packet);
      addMessage("YOU", text, true);
      els.messageInput.value = "";
      els.messageInput.focus();
    } catch (error) { showError(error); }
  });

  if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
    setStatus("HTTPS required");
    alert("Web Crypto requires a secure context. Use GitHub Pages (HTTPS) or localhost.");
  }
})();
