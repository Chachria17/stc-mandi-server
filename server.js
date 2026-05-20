require("dotenv").config();
const express = require("express");
const { parseMessage } = require("./parser");
const { saveRawMessage, markParsed, saveAllParsedData } = require("./db");

const app = express();

// Parse URL-encoded bodies (Twilio sends this format)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "STC Mandi Agent running", timestamp: new Date().toISOString() });
});

// Main webhook — Twilio posts here when a WhatsApp message arrives
app.post("/webhook", async (req, res) => {
  // Respond immediately to Twilio (must be within 15 seconds)
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  // Process asynchronously
  const sender = req.body.From || "unknown";
  const messageText = req.body.Body || "";

  console.log(`\n[${new Date().toISOString()}] Message from ${sender}`);
  console.log(`Text: ${messageText.substring(0, 100)}...`);

  if (!messageText.trim()) {
    console.log("Empty message, skipping.");
    return;
  }

  let rawMessageId = null;

  try {
    // Step 1: Save raw message immediately
    rawMessageId = await saveRawMessage({
      sender,
      messageText,
      source: "whatsapp",
    });
    console.log(`Raw message saved: ${rawMessageId}`);

    // Step 2: Parse with Claude
    console.log("Sending to Claude for parsing...");
    const result = await parseMessage(messageText);

    if (!result.success) {
      console.error("Parse failed:", result.error);
      await markParsed(rawMessageId, false, result.error);
      return;
    }

    console.log(`Parsed as: ${result.data.message_type} | Market: ${result.data.primary_market}`);

    // Step 3: Save all structured data
    await saveAllParsedData(rawMessageId, result.data);
    console.log(`All data saved successfully for message ${rawMessageId}`);

  } catch (err) {
    console.error("Webhook processing error:", err.message);
    if (rawMessageId) {
      await markParsed(rawMessageId, false, err.message);
    }
  }
});

// Manual test endpoint — POST a message text to test parsing without WhatsApp
app.post("/test", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Provide text field" });

  console.log(`\n[TEST] Parsing message...`);
  const result = await parseMessage(text);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Also save to DB if test=true and save=true
  if (req.body.save === "true") {
    const rawId = await saveRawMessage({
      sender: "test",
      messageText: text,
      source: "manual_test",
    });
    await saveAllParsedData(rawId, result.data);
    result.data._saved_id = rawId;
  }

  res.json(result.data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`STC Mandi Agent listening on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Test URL: http://localhost:${PORT}/test`);
});
