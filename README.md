# Nechi P2P Messenger v0.1

A small browser-based peer-to-peer chat prototype. No account system, message database, or app-owned message server.

## Features

- Manual WebRTC offer/answer exchange (copy and paste).
- Incoming-offer confirmation prompt.
- WebRTC DataChannel with built-in DTLS encryption.
- Additional AES-GCM message encryption using a shared passphrase and PBKDF2-SHA-256.
- No chat history is written to local storage or a database.

## Important security limits

This is a learning prototype, **not audited security software**.

- Share the passphrase using a separate trusted channel. Do not put it in the offer/answer data.
- The offer/answer exchange is not automatically authenticated. For meaningful identity verification, compare the DTLS certificate fingerprints over a separate trusted channel before accepting.
- STUN is used to help discover network candidates. It does not relay chat messages, but it can observe connection metadata. Some networks require TURN or do not allow direct connections.
- A malicious or compromised device/browser can still read messages.
- Do not use this prototype for sensitive or high-risk communications.

## Run locally

Open `index.html` from a local web server, or deploy the files to GitHub Pages. Web Crypto generally requires HTTPS or localhost.

For example, with Python installed, from this folder run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

1. Create a repository on GitHub.
2. Upload `index.html`, `style.css`, `app.js`, and `README.md`.
3. In repository Settings, open Pages.
4. Choose deployment from the branch and select the root folder.
5. Open the HTTPS Pages URL on both devices.

The site files are public. Never store secrets or private keys in them.

## Manual connection flow

1. Both people open the site and enter the exact same strong passphrase, shared separately.
2. Device A clicks **Create room / offer**, waits for the offer to be ready, then copies the connection data to the other person through a trusted channel.
3. Device B pastes the offer into the box and clicks **Accept incoming offer**. If they choose to accept, they copy the generated answer back to A.
4. Device A pastes the answer and clicks **Apply answer**.
5. Wait for **Encrypted channel open** on both devices, then chat.

If the connection does not open, the network may not support a direct WebRTC connection without a TURN relay. This prototype intentionally has no relay fallback.
