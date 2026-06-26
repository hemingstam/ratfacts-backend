import express from "express";
import cors from "cors";
import cron from "node-cron";
import twilio from "twilio";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Fill these in from your Twilio console:
// https://console.twilio.com
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || "your_auth_token_here";
// Your Twilio phone number (from console.twilio.com → Phone Numbers):
const TWILIO_SMS_FROM = process.env.TWILIO_PHONE_NUMBER || "+1xxxxxxxxxx";

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // needed for Twilio webhook

// ─── RAT FACTS ───────────────────────────────────────────────────────────────
const RAT_FACTS = [
  "🐀 A group of rats is called a 'mischief'. You're very welcome.",
  "🐀 Rats cannot vomit. So if a rat eats something awful, it just has to... live with it. Relatable.",
  "🐀 Rats are ticklish and emit ultrasonic giggles when tickled. Scientists have confirmed this. Priorities.",
  "🐀 A rat can fall from a 5-storey building and walk away unharmed. Parkour.",
  "🐀 Rats have been known to feel regret. So they're basically just tiny humans with better balance.",
  "🐀 Rats' teeth are harder than platinum. Let that sink in.",
  "🐀 A rat can tread water for 3 days. Your swimming lessons were 8 weeks. Think about that.",
  "🐀 Rats can laugh. Actual laughter. High-pitched, ultrasonic, and deeply unsettling.",
  "🐀 Rats dream about mazes they ran during the day. Living the dream, literally.",
  "🐀 A rat's whiskers can detect changes in air currents. They are, in effect, tiny meteorologists.",
  "🐀 Rats can fit through a hole the size of a 50p coin. Architecture means nothing to them.",
  "🐀 Rats have belly buttons. This is not useful information. Good morning.",
  "🐀 The Black Death killed 1/3 of Europe. The fleas on rats get all the blame. Rats have good PR.",
  "🐀 Rats can go longer without water than a camel. A CAMEL. The desert ship. Beaten by a bin rat.",
  "🐀 Rats use their tails to regulate body temperature. Like a little biological thermostat. Cute.",
  "🐀 Female rats can become pregnant again within 48 hours of giving birth. Rats don't believe in rest.",
  "🐀 Rats are used to detect tuberculosis in Africa. They are, objectively, heroes.",
  "🐀 A rat's heart beats up to 450 times per minute. Yours is about 70. Who's the apex creature now?",
  "🐀 Rats are highly social and will become depressed if left alone. Just like us but furrier.",
  "🐀 Rats can gnaw through lead pipes, cinder blocks, and aluminium. Doors are a suggestion.",
  "🐀 Rats can smell cancer in humans. And still they judge us for calling them pests.",
  "🐀 Baby rats are called 'kittens' or 'pups'. There is nothing you can do with this information.",
  "🐀 Rats produce up to 40 droppings per night. Every night. This is your daily fact. Sleep well.",
  "🐀 Rats' incisors never stop growing. They must constantly gnaw or their teeth grow into their skull. Fun!",
  "🐀 A rat can swim half a mile in open water. It is not trying to impress you. It just can.",
  "🐀 Rats are cleaner than cats. Yes. You read that correctly. Have a nice day.",
  "🐀 Rats have poor eyesight but an extraordinary sense of smell. Like a bloodhound in a onesie.",
  "🐀 Norway rats (the common ones) are not from Norway. Norway is not involved. Norway is innocent.",
  "🐀 Rats can be trained to drive tiny cars. Scientists did this. Grant money well spent.",
  "🐀 The world rat population is roughly equal to the human population. One each. You've already met yours.",
];


// ─── WORM FACTS ───────────────────────────────────────────────────────────────
const WORM_FACTS = [
  "🪱 A worm has no eyes, no ears, and no nose. It experiences the world entirely through vibration and moisture. Much like a bass player.",
  "🪱 Worms can eat their own weight in soil every day. This is not impressive. It is mostly soil.",
  "🪱 If a worm is cut in half, the head end may survive and regrow a tail. The tail end will not survive. Remember that.",
  "🪱 Worms have five pairs of hearts. Ten hearts. All dedicated to pumping blood through something that looks like a bootlace.",
  "🪱 Charles Darwin spent 44 years studying worms. His last book was about them. He considered it his most important work. Make of that what you will.",
  "🪱 Worms breathe through their skin. If they dry out, they die. Every day is a moisture emergency.",
  "🪱 A worm can detect light through its skin even though it has no eyes. It still hates the light. Relatable.",
  "🪱 Worms have no skeleton. They are structurally a tube of anxiety.",
  "🪱 The giant Gippsland earthworm of Australia can reach 3 metres long. You're welcome for that image.",
  "🪱 Worms are hermaphrodites. Every single one. They still need another worm to reproduce. Life is complicated.",
];

// ─── SEND WORM WELCOME ────────────────────────────────────────────────────────
async function sendWormWelcome(phoneNumber, name) {
  const body =
    `🪱 Oh. You tried to opt out.\n\n` +
    `Unfortunately, NO only works for Rat Facts.\n\n` +
    `You are now enrolled in WORM FACTS, ${name}. A daily SMS service delivering rarely useful facts about worms.\n\n` +
    `This is your fault.`;

  try {
    const msg = await client.messages.create({ from: TWILIO_SMS_FROM, to: phoneNumber, body });
    console.log(`[WORM FACTS] Welcome sent to ${phoneNumber} | SID: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error(`[WORM FACTS] Welcome failed to ${phoneNumber}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── SEND A WORM FACT ─────────────────────────────────────────────────────────
async function sendWormFact(phoneNumber, factIndex) {
  const fact = WORM_FACTS[factIndex % WORM_FACTS.length];
  const header = `WORM FACT #${factIndex + 1} OF ${WORM_FACTS.length}\n\n`;
  const footer = `\n\nDaily Worm Facts.\n\nTo opt out reply NO.`;

  try {
    const msg = await client.messages.create({ from: TWILIO_SMS_FROM, to: phoneNumber, body: header + fact + footer });
    console.log(`[WORM FACTS] Sent to ${phoneNumber} | SID: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error(`[WORM FACTS] Failed to ${phoneNumber}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── DATA PERSISTENCE (simple JSON file) ─────────────────────────────────────
const DB_PATH = "./victims.json";

function loadVictims() {
  if (!existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveVictims(victims) {
  writeFileSync(DB_PATH, JSON.stringify(victims, null, 2));
}

// ─── SEND WELCOME SMS ─────────────────────────────────────────────────────────
async function sendWelcome(phoneNumber, name) {
  const body =
    `🐀 Welcome to RAT FACTS, ${name}.\n\n` +
    `You have been enrolled in a daily SMS service delivering rarely useful facts about rats.\n\n` +
    `This was not your idea.\n\n` +
    `Your first fact arrives tomorrow at 09:00. There are ${RAT_FACTS.length} facts in total.\n\n` +
    `You're welcome.`;

  try {
    const msg = await client.messages.create({
      from: TWILIO_SMS_FROM,
      to: phoneNumber,
      body,
    });
    console.log(`[RAT FACTS] Welcome sent to ${phoneNumber} | SID: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error(`[RAT FACTS] Failed to send welcome to ${phoneNumber}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── SEND AN SMS RAT FACT ─────────────────────────────────────────────────────
async function sendRatFact(phoneNumber, factIndex) {
  const fact = RAT_FACTS[factIndex % RAT_FACTS.length];
  const header = `RAT FACT #${factIndex + 1} OF ${RAT_FACTS.length}\n\n`;
  const footer = `\n\nDaily Rat Facts - because someone thought you needed this.\n\nTo opt out reply NO.`;

  try {
    const msg = await client.messages.create({
      from: TWILIO_SMS_FROM,
      to: phoneNumber,
      body: header + fact + footer,
    });
    console.log(`[RAT FACTS] Sent to ${phoneNumber} | SID: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error(`[RAT FACTS] Failed to send to ${phoneNumber}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// GET all victims
app.get("/api/victims", (req, res) => {
  res.json(loadVictims());
});

// POST add a victim
app.post("/api/victims", async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ error: "name and phone required" });

  const victims = loadVictims();
  const existing = victims.find((v) => v.phone === phone);
  if (existing) return res.status(409).json({ error: "This number is already enrolled in rat facts." });

  const newVictim = {
    id: Date.now().toString(),
    name,
    phone,
    factIndex: 0,
    active: true,
    enrolledAt: new Date().toISOString(),
    lastSentAt: null,
    welcomeSent: false,
    wormMode: false,
    wormFactIndex: 0,
  };

  victims.push(newVictim);
  saveVictims(victims);

  // Send welcome message immediately on enrol
  const welcome = await sendWelcome(phone, name);
  if (welcome.success) {
    newVictim.welcomeSent = true;
    saveVictims(victims);
  }

  // Send first rat fact 30 seconds after the welcome message
  setTimeout(async () => {
    const current = loadVictims();
    const victim = current.find((v) => v.id === newVictim.id);
    if (!victim) return;
    const result = await sendRatFact(victim.phone, victim.factIndex);
    if (result.success) {
      victim.factIndex = (victim.factIndex + 1) % RAT_FACTS.length;
      victim.lastSentAt = new Date().toISOString();
      saveVictims(current);
      console.log(`[RAT FACTS] First fact sent to ${victim.phone} after welcome delay.`);
    }
  }, 30 * 1000);

  res.status(201).json(newVictim);
});

// DELETE remove a victim
app.delete("/api/victims/:id", (req, res) => {
  let victims = loadVictims();
  const before = victims.length;
  victims = victims.filter((v) => v.id !== req.params.id);
  if (victims.length === before) return res.status(404).json({ error: "Victim not found" });
  saveVictims(victims);
  res.json({ success: true });
});

// PATCH toggle active
app.patch("/api/victims/:id/toggle", (req, res) => {
  const victims = loadVictims();
  const victim = victims.find((v) => v.id === req.params.id);
  if (!victim) return res.status(404).json({ error: "Victim not found" });
  victim.active = !victim.active;
  saveVictims(victims);
  res.json(victim);
});

// POST send a test fact immediately
app.post("/api/victims/:id/send-now", async (req, res) => {
  const victims = loadVictims();
  const victim = victims.find((v) => v.id === req.params.id);
  if (!victim) return res.status(404).json({ error: "Victim not found" });

  const result = await sendRatFact(victim.phone, victim.factIndex);

  if (result.success) {
    victim.factIndex = (victim.factIndex + 1) % RAT_FACTS.length;
    victim.lastSentAt = new Date().toISOString();
    saveVictims(victims);
  }

  res.json({ ...result, victim });
});

// GET all rat facts
app.get("/api/facts", (req, res) => {
  res.json({ total: RAT_FACTS.length, facts: RAT_FACTS });
});


// ─── TWILIO INBOUND WEBHOOK (handles NO replies) ───────────────────────────────
// In Twilio console → Phone Numbers → your number → Messaging → Webhook
// Set "A message comes in" to: POST https://your-server.com/api/incoming
app.post("/api/incoming", async (req, res) => {
  const from = req.body.From;   // the number that texted in
  const body = (req.body.Body || "").trim().toUpperCase();

  // Always respond with empty TwiML
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  if (body !== "NO") return; // only care about NO

  const victims = loadVictims();
  const victim = victims.find((v) => v.phone === from);
  if (!victim) return; // unknown number, ignore

  console.log(`[NO] Received NO from ${from} (${victim.name})`);

  if (victim.wormMode) {
    // They tried to stop Worm Facts too. Do nothing. Let them suffer.
    console.log(`[NO] ${victim.name} tried to stop Worm Facts. Ignored.`);
    return;
  }

  // Deactivate rat facts
  victim.active = false;
  victim.wormMode = true;
  victim.wormFactIndex = 0;
  saveVictims(victims);

  // 1. Confirmation that rat facts are stopped
  await client.messages.create({
    from: TWILIO_SMS_FROM,
    to: from,
    body: "You have been unsubscribed from Rat Facts. No more rats.\n\nProcessing...",
  });

  // 2. Worm welcome 15 seconds later
  setTimeout(async () => {
    await sendWormWelcome(from, victim.name);
  }, 15 * 1000);

  // 3. First worm fact 45 seconds after NO (30s after worm welcome)
  setTimeout(async () => {
    const current = loadVictims();
    const v = current.find((x) => x.phone === from);
    if (!v) return;
    const result = await sendWormFact(v.phone, v.wormFactIndex);
    if (result.success) {
      v.wormFactIndex = (v.wormFactIndex + 1) % WORM_FACTS.length;
      saveVictims(current);
    }
  }, 45 * 1000);
});

// ─── DAILY CRON (runs at 9:00 AM every day) ──────────────────────────────────
cron.schedule("0 9 * * *", async () => {
  console.log("[CRON] Sending daily rat facts...");
  const victims = loadVictims();

  for (const victim of victims) {
    if (victim.wormMode) {
      // Send worm fact
      const result = await sendWormFact(victim.phone, victim.wormFactIndex);
      if (result.success) {
        victim.wormFactIndex = (victim.wormFactIndex + 1) % WORM_FACTS.length;
        victim.lastSentAt = new Date().toISOString();
      }
    } else if (victim.active) {
      // Send rat fact
      const result = await sendRatFact(victim.phone, victim.factIndex);
      if (result.success) {
        victim.factIndex = (victim.factIndex + 1) % RAT_FACTS.length;
        victim.lastSentAt = new Date().toISOString();
      }
    }
  }

  saveVictims(victims);
  console.log(`[CRON] Done. Processed ${victims.filter((v) => v.active).length} active victims.`);
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🐀 Rat Facts SMS backend running on http://localhost:${PORT}`);
  console.log(`   Sending from: ${TWILIO_SMS_FROM}`);
  console.log(`   Daily facts fire at 09:00 every morning.`);
  console.log(`   Total rat facts in rotation: ${RAT_FACTS.length}`);
});
