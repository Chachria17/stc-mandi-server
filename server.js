// v3 - clean rewrite
const express = require("express");
const { parseMessage, parseImage } = require("./parser");
const { saveRawMessage, markParsed, saveAllParsedData } = require("./db");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "STC Mandi Agent running", timestamp: new Date().toISOString() });
});

app.post("/webhook", async (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  const sender = req.body.From || "unknown";
  const messageText = req.body.Body || "";
  const numMedia = parseInt(req.body.NumMedia || "0");
  const mediaUrl = req.body.MediaUrl0 || null;
  const mediaType = req.body.MediaContentType0 || null;

  console.log(`[${new Date().toISOString()}] From: ${sender}, Media: ${numMedia}, Text: "${messageText.substring(0, 50)}"`);

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
      console.log(`Image received, downloading...`);
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const creds = Buffer.from(`${sid}:${token}`).toString("base64");
      
      const resp = await fetch(mediaUrl, {
        headers: { "Authorization": `Basic ${creds}` },
        redirect: "follow",
      });

      if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`);
      
      const buf = await resp.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
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
