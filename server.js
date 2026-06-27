import express from "express";
import cors from "cors";
import cron from "node-cron";
import twilio from "twilio";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TWILIO_SMS_FROM  = process.env.TWILIO_PHONE_NUMBER || "+1xxxxxxxxxx";
const APP_URL          = process.env.APP_URL || "http://localhost:5173";
const FREE_DAYS_LIMIT  = parseInt(process.env.FREE_DAYS_LIMIT || "3");

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend    = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── JSON FILE STORES ─────────────────────────────────────────────────────────
const VICTIMS_PATH    = "./victims.json";
const USERS_PATH      = "./users.json";
const LINKS_PATH      = "./magic_links.json";

function load(path)       { return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : []; }
function save(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }

const loadVictims    = ()  => load(VICTIMS_PATH);
const saveVictims    = (v) => save(VICTIMS_PATH, v);
const loadUsers      = ()  => load(USERS_PATH);
const saveUsers      = (u) => save(USERS_PATH, u);
const loadLinks      = ()  => load(LINKS_PATH);
const saveLinks      = (l) => save(LINKS_PATH, l);

// ─── HARDCODED FALLBACK FACTS (used if Claude API fails) ─────────────────────
const FALLBACK_RAT_FACTS = [
  "Rats cannot vomit. So if a rat eats something awful, it just has to live with it. Relatable.",
  "A group of rats is called a mischief. You're very welcome.",
  "Rats can laugh. High-pitched, ultrasonic, and deeply unsettling.",
  "Rats are cleaner than cats. Yes. You read that correctly.",
  "Rats can be trained to drive tiny cars. Scientists did this. Grant money well spent.",
  "Rats dream about mazes they ran during the day. Living the dream, literally.",
  "A rat can tread water for 3 days. Your swimming lessons were 8 weeks.",
  "Rats' teeth are harder than platinum. Let that sink in.",
  "The world rat population is roughly equal to the human population. One each. You've already met yours.",
  "Norway rats are not from Norway. Norway is not involved. Norway is innocent.",
];

const FALLBACK_WORM_FACTS = [
  "Worms have no skeleton. They are structurally a tube of anxiety.",
  "Worms have five pairs of hearts. Ten hearts. All pumping blood through something that looks like a bootlace.",
  "Charles Darwin spent 44 years studying worms. His last book was about them. Make of that what you will.",
  "If a worm is cut in half, the head end may survive. The tail end will not. Remember that.",
  "Worms breathe through their skin. Every day is a moisture emergency.",
];

// ─── AI FACT GENERATION ───────────────────────────────────────────────────────
async function generateRatFact(victimName, previousFacts = []) {
  try {
    const prevList = previousFacts.length > 0
      ? `\n\nFacts already sent to this person (do NOT repeat these):\n${previousFacts.slice(-20).map((f, i) => `${i + 1}. ${f}`).join("\n")}`
      : "";

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `Generate exactly ONE rat fact for ${victimName} in this exact style: dry, deadpan, absurd, ends with a short punchy observation. 2-3 sentences max. Start with the fact itself, not with "${victimName}". Be genuinely surprising and funny. Output ONLY the fact text, no quotes, no preamble.

Style examples:
- Rats cannot vomit. So if a rat eats something awful, it just has to live with it. Relatable.
- A group of rats is called a mischief. You're very welcome.
- Rats are cleaner than cats. Yes. You read that correctly. Have a nice day.
- Rats can be trained to drive tiny cars. Scientists did this. Grant money well spent.${prevList}`,
      }],
    });

    const fact = msg.content[0].text.trim();
    console.log(`[AI] Generated rat fact for ${victimName}: ${fact.substring(0, 60)}...`);
    return fact;
  } catch (err) {
    console.error("[AI] Rat fact generation failed, using fallback:", err.message);
    const fallback = FALLBACK_RAT_FACTS[Math.floor(Math.random() * FALLBACK_RAT_FACTS.length)];
    return fallback;
  }
}

async function generateWormFact(victimName, previousFacts = []) {
  try {
    const prevList = previousFacts.length > 0
      ? `\n\nFacts already sent (do NOT repeat):\n${previousFacts.slice(-10).map((f, i) => `${i + 1}. ${f}`).join("\n")}`
      : "";

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `Generate exactly ONE worm fact in this style: dry, deadpan, slightly grim, ends with a punchy observation. 2-3 sentences max. Output ONLY the fact, no quotes, no preamble.

Style examples:
- Worms have no skeleton. They are structurally a tube of anxiety.
- Charles Darwin spent 44 years studying worms. His last book was about them. He considered it his most important work. Make of that what you will.
- If a worm is cut in half, the head end may survive and regrow a tail. The tail end will not survive. Remember that.${prevList}`,
      }],
    });

    const fact = msg.content[0].text.trim();
    console.log(`[AI] Generated worm fact for ${victimName}: ${fact.substring(0, 60)}...`);
    return fact;
  } catch (err) {
    console.error("[AI] Worm fact generation failed, using fallback:", err.message);
    return FALLBACK_WORM_FACTS[Math.floor(Math.random() * FALLBACK_WORM_FACTS.length)];
  }
}

// ─── SMS HELPERS ──────────────────────────────────────────────────────────────
async function sendSms(to, body) {
  return twilioClient.messages.create({ from: TWILIO_SMS_FROM, to, body });
}

async function sendWelcome(phone, name) {
  const body =
    `🐀 Welcome to RAT FACTS, ${name}.\n\n` +
    `You have been enrolled in a daily SMS service delivering rarely useful facts about rats.\n\n` +
    `This was not your idea.\n\n` +
    `Your first fact arrives in 30 seconds. Daily facts fire at 09:00.\n\n` +
    `You're welcome.`;
  try {
    const msg = await sendSms(phone, body);
    console.log(`[WELCOME] Sent to ${phone} | SID: ${msg.sid}`);
    return { success: true };
  } catch (err) {
    console.error(`[WELCOME] Failed for ${phone}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendRatFact(victim) {
  const fact = await generateRatFact(victim.name, victim.factHistory || []);
  const dayNum = (victim.factIndex || 0) + 1;
  const body = `🐀 RAT FACT #${dayNum}\n\n${fact}\n\nDaily Rat Facts — because someone thought you needed this.\n\nTo opt out reply NO.`;
  try {
    const msg = await sendSms(victim.phone, body);
    console.log(`[RAT FACT] Sent to ${victim.phone} | Day ${dayNum}`);
    return { success: true, fact };
  } catch (err) {
    console.error(`[RAT FACT] Failed for ${victim.phone}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendWormWelcome(phone, name) {
  const body =
    `🪱 Oh. You tried to opt out.\n\n` +
    `Unfortunately, NO only works for Rat Facts.\n\n` +
    `You are now enrolled in WORM FACTS, ${name}. A daily SMS service delivering rarely useful facts about worms.\n\n` +
    `This is your fault.`;
  try {
    await sendSms(phone, body);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendWormFact(victim) {
  const fact = await generateWormFact(victim.name, victim.wormHistory || []);
  const dayNum = (victim.wormFactIndex || 0) + 1;
  const body = `🪱 WORM FACT #${dayNum}\n\n${fact}\n\nDaily Worm Facts.\n\nTo opt out reply NO.`;
  try {
    await sendSms(victim.phone, body);
    return { success: true, fact };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── EMAIL MAGIC LINK ─────────────────────────────────────────────────────────
async function sendMagicLink(email, token) {
  const link = `${APP_URL}?token=${token}`;
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "ratfacts@resend.dev",
      to: email,
      subject: "🐀 Your Rat Facts login link",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#0E0E1A;color:#F0EDE8;border-radius:12px;">
          <h1 style="font-size:48px;margin:0 0 8px;color:#F5F0E8;">🐀</h1>
          <h2 style="font-family:Georgia,serif;color:#FF4D4D;margin:0 0 8px;">Rat Facts</h2>
          <p style="color:#7070A0;margin:0 0 32px;font-size:14px;">Daily rarely useful facts about rats.</p>
          <a href="${link}" style="display:inline-block;background:#FF4D4D;color:#fff;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;">
            Log in to Rat Facts →
          </a>
          <p style="color:#7070A0;font-size:12px;margin-top:24px;">This link expires in 15 minutes. If you didn't request this, ignore it.</p>
        </div>
      `,
    });
    console.log(`[EMAIL] Magic link sent to ${email}`);
    return { success: true };
  } catch (err) {
    console.error(`[EMAIL] Failed for ${email}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function requireUser(req, res, next) {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Unauthorised" });
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: "User not found" });
  req.user = user;
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/auth/request — request a magic link
app.post("/api/auth/request", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const users = loadUsers();
  let user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) {
    user = {
      id: randomUUID(),
      email: email.toLowerCase().trim(),
      isDonor: false,
      donatedAt: null,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
  }

  // Create magic link token (expires in 15 mins)
  const token = randomUUID();
  const links = loadLinks();
  links.push({
    token,
    userId: user.id,
    used: false,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  });
  // Keep only last 100 links
  saveLinks(links.slice(-100));

  const result = await sendMagicLink(email, token);
  if (!result.success) {
    return res.status(500).json({ error: "Failed to send email. Please try again." });
  }

  res.json({ ok: true });
});

// GET /api/auth/verify?token=xxx — verify magic link
app.get("/api/auth/verify", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token required" });

  const links = loadLinks();
  const link = links.find(l => l.token === token);

  if (!link)              return res.status(404).json({ error: "Invalid link" });
  if (link.used)          return res.status(400).json({ error: "Link already used" });
  if (new Date(link.expiresAt) < new Date()) return res.status(400).json({ error: "Link expired" });

  // Mark used
  link.used = true;
  saveLinks(links);

  const users = loadUsers();
  const user = users.find(u => u.id === link.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    ok: true,
    userId: user.id,
    email: user.email,
    isDonor: user.isDonor,
  });
});

// GET /api/auth/me
app.get("/api/auth/me", requireUser, (req, res) => {
  const { id, email, isDonor, donatedAt, createdAt } = req.user;
  res.json({ id, email, isDonor, donatedAt, createdAt });
});

// ─── VICTIM ROUTES ────────────────────────────────────────────────────────────

// GET /api/victims
app.get("/api/victims", requireUser, (req, res) => {
  const all = loadVictims();
  res.json(all.filter(v => v.userId === req.user.id));
});

// POST /api/victims
app.post("/api/victims", requireUser, async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ error: "Name and phone required" });

  const user = req.user;

  // Free tier: max 1 victim
  if (!user.isDonor) {
    const mine = loadVictims().filter(v => v.userId === user.id);
    if (mine.length >= 1) {
      return res.status(403).json({
        error: "Free accounts can only enrol 1 victim. Donate $1 to unlock unlimited.",
        upgradeRequired: true,
      });
    }
  }

  // Global phone dedup
  const all = loadVictims();
  if (all.find(v => v.phone === phone)) {
    return res.status(409).json({ error: "This number is already enrolled in Rat Facts. They're already suffering." });
  }

  const newVictim = {
    id: randomUUID(),
    userId: user.id,
    name,
    phone,
    active: true,
    wormMode: false,
    factIndex: 0,
    wormFactIndex: 0,
    factHistory: [],
    wormHistory: [],
    welcomeSent: false,
    daysSent: 0,
    lastSentAt: null,
    enrolledAt: new Date().toISOString(),
  };

  all.push(newVictim);
  saveVictims(all);

  // Send welcome immediately
  const welcome = await sendWelcome(phone, name);
  if (welcome.success) {
    newVictim.welcomeSent = true;
    saveVictims(all);
  }

  // First rat fact after 30s
  setTimeout(async () => {
    const current = loadVictims();
    const victim = current.find(v => v.id === newVictim.id);
    if (!victim) return;
    const result = await sendRatFact(victim);
    if (result.success) {
      victim.factIndex += 1;
      victim.daysSent += 1;
      victim.lastSentAt = new Date().toISOString();
      if (!victim.factHistory) victim.factHistory = [];
      victim.factHistory.push(result.fact);
      saveVictims(current);
    }
  }, 30 * 1000);

  res.status(201).json(newVictim);
});

// DELETE /api/victims/:id
app.delete("/api/victims/:id", requireUser, (req, res) => {
  let all = loadVictims();
  const victim = all.find(v => v.id === req.params.id && v.userId === req.user.id);
  if (!victim) return res.status(404).json({ error: "Not found" });
  all = all.filter(v => v.id !== req.params.id);
  saveVictims(all);
  res.json({ success: true });
});

// PATCH /api/victims/:id/toggle
app.patch("/api/victims/:id/toggle", requireUser, (req, res) => {
  const all = loadVictims();
  const victim = all.find(v => v.id === req.params.id && v.userId === req.user.id);
  if (!victim) return res.status(404).json({ error: "Not found" });
  victim.active = !victim.active;
  saveVictims(all);
  res.json(victim);
});

// POST /api/victims/:id/send-now
app.post("/api/victims/:id/send-now", requireUser, async (req, res) => {
  const all = loadVictims();
  const victim = all.find(v => v.id === req.params.id && v.userId === req.user.id);
  if (!victim) return res.status(404).json({ error: "Not found" });

  if (victim.wormMode) {
    const result = await sendWormFact(victim);
    if (result.success) {
      victim.wormFactIndex += 1;
      victim.lastSentAt = new Date().toISOString();
      if (!victim.wormHistory) victim.wormHistory = [];
      victim.wormHistory.push(result.fact);
      saveVictims(all);
    }
    return res.json({ ok: result.success, victim, error: result.error });
  } else {
    const result = await sendRatFact(victim);
    if (result.success) {
      victim.factIndex += 1;
      victim.daysSent += 1;
      victim.lastSentAt = new Date().toISOString();
      if (!victim.factHistory) victim.factHistory = [];
      victim.factHistory.push(result.fact);
      saveVictims(all);
    }
    return res.json({ ok: result.success, victim, error: result.error });
  }
});

// ─── TWILIO INBOUND WEBHOOK (NO reply → worm mode) ───────────────────────────
app.post("/api/incoming", async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim().toUpperCase();

  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  if (body !== "NO") return;

  const all = loadVictims();
  const victim = all.find(v => v.phone === from);
  if (!victim) return;

  console.log(`[NO] Received from ${from} (${victim.name})`);

  if (victim.wormMode) {
    console.log(`[NO] ${victim.name} tried to stop Worm Facts. Ignored.`);
    return;
  }

  victim.active = false;
  victim.wormMode = true;
  victim.wormFactIndex = 0;
  victim.wormHistory = [];
  saveVictims(all);

  // 1. Unsubscribe confirmation
  await sendSms(from, "You have been unsubscribed from Rat Facts. No more rats.\n\nProcessing...");

  // 2. Worm welcome after 15s
  setTimeout(async () => {
    await sendWormWelcome(from, victim.name);
  }, 15 * 1000);

  // 3. First worm fact after 45s
  setTimeout(async () => {
    const current = loadVictims();
    const v = current.find(x => x.phone === from);
    if (!v) return;
    const result = await sendWormFact(v);
    if (result.success) {
      v.wormFactIndex += 1;
      if (!v.wormHistory) v.wormHistory = [];
      v.wormHistory.push(result.fact);
      saveVictims(current);
    }
  }, 45 * 1000);
});

// ─── PROCESS ERROR HANDLERS ──────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("[CRASH] Uncaught exception:", err.message);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error("[CRASH] Unhandled rejection:", reason);
});

// ─── DAILY CRON (09:00 every day) ────────────────────────────────────────────
cron.schedule("0 9 * * *", async () => {
  console.log("[CRON] Starting daily send...");
  const all = loadVictims();
  const users = loadUsers();

  for (const victim of all) {
    try {
      if (victim.wormMode) {
        const result = await sendWormFact(victim);
        if (result.success) {
          victim.wormFactIndex += 1;
          victim.lastSentAt = new Date().toISOString();
          if (!victim.wormHistory) victim.wormHistory = [];
          victim.wormHistory.push(result.fact);
        }
      } else if (victim.active) {
        const user = users.find(u => u.id === victim.userId);
        const isDonor = user?.isDonor || false;

        // Check free tier limit
        if (!isDonor && victim.daysSent >= FREE_DAYS_LIMIT) {
          if (victim.daysSent === FREE_DAYS_LIMIT) {
            await sendSms(victim.phone,
              `🐀 Your daily rat facts have paused after ${FREE_DAYS_LIMIT} days.\n\n` +
              `The person who enrolled you needs to donate $1 to keep the rats coming.\n\n` +
              `ratfacts.app`
            );
            victim.active = false;
            victim.daysSent += 1;
          }
          continue;
        }

        const result = await sendRatFact(victim);
        if (result.success) {
          victim.factIndex += 1;
          victim.daysSent += 1;
          victim.lastSentAt = new Date().toISOString();
          if (!victim.factHistory) victim.factHistory = [];
          victim.factHistory.push(result.fact);
        }
      }
    } catch (err) {
      console.error(`[CRON] Error for ${victim.phone}:`, err.message);
    }
  }

  saveVictims(all);
  console.log(`[CRON] Done. Processed ${all.length} victims.`);

  // Cleanup expired magic links
  const links = loadLinks();
  saveLinks(links.filter(l => new Date(l.expiresAt) > new Date() || l.used));
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🐀 Rat Facts backend running on port ${PORT}`);
  console.log(`   AI: Claude Haiku (${process.env.ANTHROPIC_API_KEY ? "✅ key set" : "❌ no key"})`);
  console.log(`   Email: Resend (${process.env.RESEND_API_KEY ? "✅ key set" : "❌ no key"})`);
  console.log(`   SMS: Twilio ${TWILIO_SMS_FROM}`);
  console.log(`   Free tier: ${FREE_DAYS_LIMIT} days`);
  console.log(`   Daily cron: 09:00`);
});
