// v5
const express = require("express");
const https = require("https");
const { parseMessage, parseImage } = require("./parser");
const { saveRawMessage, markParsed, saveAllParsedData } = require("./db");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "STC Mandi Agent running", timestamp: new Date().toISOString() });
});

function downloadMedia(mediaUrl) {
  return new Promise((resolve, reject) => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const parsed = new URL(mediaUrl);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      auth: `${sid}:${token}`,
      headers: { "User-Agent": "stc-mandi-server" },
    };

    const handleResponse = (res) => {
      // Follow redirects without auth
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        console.log(`Redirect to: ${res.headers.location.substring(0, 60)}...`);
        const redirectUrl = new URL(res.headers.location);
        const redirectOptions = {
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + redirectUrl.search,
          headers: { "User-Agent": "stc-mandi-server" },
        };
        https.get(redirectOptions, handleResponse).on("error", reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      res.on("error", reject);
    };

    https.get(options, handleResponse).on("error", reject);
  });
}

app.post("/webhook", async (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  const sender = req.body.From || "unknown";
  const messageText = req.body.Body || "";
  const numMedia = parseInt(req.body.NumMedia || "0");
  const mediaUrl = req.body.MediaUrl0 || null;
  const mediaType = req.body.MediaContentType0 || null;

  console.log(`[${new Date().toISOString()}] From: ${sender}, Media: ${numMedia}`);

  if (!messageText.trim() && numMedia === 0) return;

  let rawMessageId = null;
  try {
    rawMessageId = await saveRawMessage({
      sender,
      messageText: messageText || `[image]`,
      source: "whatsapp",
    });
    console.log(`Saved: ${rawMessageId}`);

    let result;

    if (numMedia > 0 && mediaUrl && mediaType && mediaType.startsWith("image/")) {
      console.log(`Downloading image from: ${mediaUrl.substring(0, 60)}...`);
      const b64 = await downloadMedia(mediaUrl);
      console.log(`Downloaded ${Math.round(b64.length * 0.75 / 1024)}KB, parsing...`);
      result = await parseImage(b64, mediaType);
    } else {
      console.log(`Parsing text...`);
      result = await parseMessage(messageText);
    }

    if (!result.success) {
      console.error(`Parse failed: ${result.error}`);
      await markParsed(rawMessageId, false, result.error);
      return;
    }

    console.log(`Parsed: ${result.data.message_type} | ${result.data.primary_market}`);
    await saveAllParsedData(rawMessageId, result.data);
    console.log(`Done!`);

  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (rawMessageId) await markParsed(rawMessageId, false, err.message);
  }
});

app.post("/test", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Provide text" });
  const result = await parseMessage(text);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
