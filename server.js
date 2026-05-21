const express = require("express");
const { parseMessage, parseImage } = require("./parser");
const { saveRawMessage, markParsed, saveAllParsedData } = require("./db");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "STC Mandi Agent running", timestamp: new Date().toISOString() });
});

// Use built-in fetch (Node 22) with Twilio auth
async function downloadTwilioImage(mediaUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetch(mediaUrl, {
    headers: { "Authorization": `Basic ${credentials}` },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading image`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
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
  console.log(`Text: "${messageText.substring(0, 100)}"`);
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
      console.log(`Downloading image...`);
      const imageBase64 = await downloadTwilioImage(mediaUrl);
      console.log(`Image downloaded (${Math.round(imageBase64.length * 0.75 / 1024)}KB), sending to Claude...`);
      result = await parseImage(imageBase64, mediaType);
    } else if (messageText.trim()) {
      console.log("Sending text to Claude...");
      result = await parseMessage(messageText);
    } else {
      console.log("No processable content.");
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
