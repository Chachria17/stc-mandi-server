// v6
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

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    https.get(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function downloadMedia(mediaUrl) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  
  console.log(`Auth header prefix: ${authHeader.substring(0, 20)}...`);
  
  const parsed = new URL(mediaUrl);
  
  // First request with auth
  const res1 = await httpsGet({
    hostname: parsed.hostname,
    path: parsed.pathname,
    headers: { 
      "Authorization": authHeader,
      "User-Agent": "Node.js"
    },
  });
  
  console.log(`First response: ${res1.status}`);
  
  // Follow redirect if needed (CDN redirect won't need auth)
  if ([301, 302, 307, 308].includes(res1.status) && res1.headers.location) {
    const loc = res1.headers.location;
    console.log(`Redirect: ${loc.substring(0, 60)}`);
    const redir = new URL(loc);
    const res2 = await httpsGet({
      hostname: redir.hostname,
      path: redir.pathname + redir.search,
      headers: { "User-Agent": "Node.js" },
    });
    console.log(`Redirect response: ${res2.status}`);
    if (res2.status !== 200) throw new Error(`Redirect HTTP ${res2.status}`);
    return res2.body.toString("base64");
  }
  
  if (res1.status !== 200) throw new Error(`HTTP ${res1.status}`);
  return res1.body.toString("base64");
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
      console.log(`Downloading: ${mediaUrl.substring(0, 70)}...`);
      const b64 = await downloadMedia(mediaUrl);
      console.log(`Downloaded ${Math.round(b64.length * 0.75 / 1024)}KB, parsing...`);
      result = await parseImage(b64, mediaType);
    } else {
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
