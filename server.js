// v4
const express = require("express");
const { parseMessage, parseImage } = require("./parser");
const { saveRawMessage, markParsed, saveAllParsedData } = require("./db");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "STC Mandi Agent running", timestamp: new Date().toISOString() });
});

async function downloadMedia(mediaUrl) {
  // Twilio media URLs need account SID/auth token as Basic auth
  // The URL format is: https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages/{SID}/Media/{SID}
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  
  // Use Twilio's API URL directly with credentials embedded
  const urlObj = new URL(mediaUrl);
  const authUrl = `${urlObj.protocol}//${sid}:${token}@${urlObj.host}${urlObj.pathname}`;
  
  const resp = await fetch(authUrl, { redirect: "follow" });
  if (!resp.ok) {
    // Try alternate approach - fetch with Basic auth header
    const creds = Buffer.from(`${sid}:${token}`).toString("base64");
    const resp2 = await fetch(mediaUrl, {
      headers: { "Authorization": `Basic ${creds}` },
      redirect: "follow",
    });
    if (!resp2.ok) throw new Error(`Image download failed: ${resp2.status}`);
    const buf = await resp2.arrayBuffer();
    return Buffer.from(buf).toString("base64");
  }
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

app.post("/webhook", async (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  const sender = req.body.From || "unknown";
  const messageText = req.body.Body || "";
  const numMedia = parseInt(req.body.NumMedia || "0");
  const mediaUrl = req.body.MediaUrl0 || null;
  const mediaType = req.body.MediaContentType0 || null;

  console.log(`[${new Date().toISOString()}] From: ${sender}, Media: ${numMedia}, Text: "${messageText.substring(0, 50)}"`);
  console.log(`MediaUrl: ${mediaUrl ? mediaUrl.substring(0, 80) : 'none'}`);

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
      console.log(`Downloading image...`);
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
