// Railway injects env vars natively — no dotenv needed
const express = require("express");
const https = require("https");
const http = require("http");
const { parseMessage, parseImage } = require("./parser");
const { saveRawMessage, markParsed, saveAllParsedData } = require("./db");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "STC Mandi Agent running", timestamp: new Date().toISOString() });
});

// Download image from Twilio URL, following redirects
function downloadImage(url, authHeader) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { Authorization: authHeader },
    };

    lib.get(options, (response) => {
      // Follow redirect
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        const redirectUrl = response.headers.location;
        console.log(`Following redirect to: ${redirectUrl.substring(0, 80)}...`);
        // Redirects from Twilio CDN don't need auth
        downloadImageNoAuth(redirectUrl).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} downloading image`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      response.on("error", reject);
    }).on("error", reject);
  });
}

function downloadImageNoAuth(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    lib.get({ hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} on redirect`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      response.on("error", reject);
    }).on("error", reject);
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

  console.log(`\n[${new Date().toISOString()}] Message from ${sender}`);
  console.log(`Text: ${messageText.substring(0, 100)}`);
  console.log(`Media: ${numMedia} item(s), type: ${mediaType}`);

  if (!messageText.trim() && numMedia === 0) {
    console.log("Empty message, skipping.");
    return;
  }

  let rawMessageId = null;

  try {
    rawMessageId = await saveRawMessage({
      sender,
      messageText: messageText || `[image: ${mediaUrl}]`,
      source: "whatsapp",
    });
    console.log(`Raw message saved: ${rawMessageId}`);

    let result;

    if (numMedia > 0 && mediaUrl && mediaType && mediaType.startsWith("image/")) {
      console.log(`Downloading image from Twilio...`);
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const imageBase64 = await downloadImage(mediaUrl, authHeader);
      console.log(`Image downloaded (${Math.round(imageBase64.length * 0.75 / 1024)}KB), sending to Claude vision...`);
      result = await parseImage(imageBase64, mediaType);
    } else if (messageText.trim()) {
      console.log("Sending text to Claude for parsing...");
      result = await parseMessage(messageText);
    } else {
      console.log("No text or image to parse.");
      return;
    }

    if (!result.success) {
      console.error("Parse failed:", result.error);
      await markParsed(rawMessageId, false, result.error);
      return;
    }

    console.log(`Parsed as: ${result.data.message_type} | Market: ${result.data.primary_market}`);
    await saveAllParsedData(rawMessageId, result.data);
    console.log(`All data saved successfully for message ${rawMessageId}`);

  } catch (err) {
    console.error("Webhook processing error:", err.message);
    if (rawMessageId) {
      await markParsed(rawMessageId, false, err.message);
    }
  }
});

app.post("/test", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Provide text field" });
  const result = await parseMessage(text);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`STC Mandi Agent listening on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Test URL: http://localhost:${PORT}/test`);
});
