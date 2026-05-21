const { createClient } = require("@supabase/supabase-js");

// Lazy client — created on first use so env vars are available
let _supabase = null;
function supabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error(`Missing Supabase env vars. URL=${url} KEY=${key ? 'set' : 'missing'}`);
    _supabase = createClient(url, key);
  }
  return _supabase;
}

async function saveRawMessage({ sender, messageText, source, messageType, market, messageDate }) {
  const { data, error } = await supabase()
    .from("raw_messages")
    .insert({
      sender,
      message_text: messageText,
      source: source || "whatsapp",
      message_type: messageType || null,
      market: market || null,
      message_date: messageDate || null,
      parsed: false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error saving raw message:", error.message);
    throw error;
  }
  return data.id;
}

async function markParsed(rawMessageId, success, parseErrors = null) {
  await supabase()
    .from("raw_messages")
    .update({ parsed: success, parse_errors: parseErrors })
    .eq("id", rawMessageId);
}

async function savePrices(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    market: r.market,
    sub_market: r.sub_market || null,
    update_type: r.update_type || null,
    commodity: r.commodity,
    variety: r.variety || null,
    grade: r.grade || null,
    price_min: r.price_min || null,
    price_max: r.price_max || null,
    price_single: r.price_single || null,
    price_unit: r.price_unit || "INR/quintal",
    price_type: r.price_type || null,
    arrivals_bags: r.arrivals_bags || null,
    change_amount: r.change_amount || null,
    change_direction: r.change_direction || null,
    notes: r.notes || null,
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("mandi_prices").insert(inserts);
  if (error) console.error("Error saving mandi_prices:", error.message);
}

async function saveContainerRates(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    size_min: r.size_min || null,
    size_max: r.size_max || null,
    rate: r.rate || null,
    rate_type: r.rate_type || null,
    condition: r.condition || null,
    market: r.market || "Indore",
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("container_rates").insert(inserts);
  if (error) console.error("Error saving container_rates:", error.message);
}

async function saveArrivals(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    market: r.market || "Indore",
    arrival_type: r.arrival_type || null,
    commodity: r.commodity,
    bags: r.bags || null,
    high_price: r.high_price || null,
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("arrivals").insert(inserts);
  if (error) console.error("Error saving arrivals:", error.message);
}

async function saveTradePrices(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    trade_type: r.trade_type,
    origin_country: r.origin_country || null,
    destination_port: r.destination_port || null,
    commodity: r.commodity,
    variety: r.variety || null,
    grade: r.grade || null,
    price: r.price || null,
    currency: r.currency || "USD",
    price_unit: r.price_unit || "MT",
    fob_usd: r.fob_usd || null,
    for_kg_rs: r.for_kg_rs || null,
    ex_factory_rs: r.ex_factory_rs || null,
    change_amount: r.change_amount || null,
    notes: r.notes || null,
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("trade_prices").insert(inserts);
  if (error) console.error("Error saving trade_prices:", error.message);
}

async function saveMillRates(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    mill_name: r.mill_name || null,
    location: r.location || null,
    commodity: r.commodity,
    variety: r.variety || null,
    price: r.price || null,
    change_amount: r.change_amount || null,
    moisture_condition: r.moisture_condition || null,
    delivery_days: r.delivery_days || null,
    notes: r.notes || null,
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("mill_rates").insert(inserts);
  if (error) console.error("Error saving mill_rates:", error.message);
}

async function saveRegionalMandi(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    mandi_name: r.mandi_name,
    commodity: r.commodity,
    variety: r.variety || null,
    arrivals: r.arrivals || null,
    arrival_unit: r.arrival_unit || null,
    price_min: r.price_min || null,
    price_max: r.price_max || null,
    model_price: r.model_price || null,
    change_amount: r.change_amount || null,
    notes: r.notes || null,
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("regional_mandi").insert(inserts);
  if (error) console.error("Error saving regional_mandi:", error.message);
}

async function saveSpotPrices(rows, rawMessageId, messageDate) {
  if (!rows || rows.length === 0) return;
  const inserts = rows.map((r) => ({
    message_date: messageDate,
    commodity: r.commodity,
    price: r.price || null,
    price_unit: r.price_unit || "INR",
    change_amount: r.change_amount || null,
    market: r.market || "Indore",
    raw_message_id: rawMessageId,
  }));
  const { error } = await supabase().from("spot_prices").insert(inserts);
  if (error) console.error("Error saving spot_prices:", error.message);
}

async function saveAllParsedData(rawMessageId, parsedData) {
  const date = parsedData.message_date;
  await Promise.all([
    savePrices(parsedData.mandi_prices, rawMessageId, date),
    saveContainerRates(parsedData.container_rates, rawMessageId, date),
    saveArrivals(parsedData.arrivals, rawMessageId, date),
    saveTradePrices(parsedData.trade_prices, rawMessageId, date),
    saveMillRates(parsedData.mill_rates, rawMessageId, date),
    saveRegionalMandi(parsedData.regional_mandi, rawMessageId, date),
    saveSpotPrices(parsedData.spot_prices, rawMessageId, date),
  ]);

  await supabase()
    .from("raw_messages")
    .update({
      parsed: true,
      message_type: parsedData.message_type,
      market: parsedData.primary_market,
      message_date: date,
    })
    .eq("id", rawMessageId);
}

module.exports = { saveRawMessage, markParsed, saveAllParsedData };
