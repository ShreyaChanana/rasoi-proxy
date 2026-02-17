const express    = require("express");
const cors       = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── MongoDB connection ────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI;
let db = null;

async function getDB() {
  if (db) return db;
  if (!MONGO_URI) throw new Error("MONGODB_URI environment variable not set");
  const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
  });
  await client.connect();
  db = client.db("rasoi");           // database name
  console.log("✅ MongoDB connected");
  return db;
}

// ── Health check ──────────────────────────────────────────────
app.get("/", async (_, res) => {
  try {
    await getDB();
    res.json({ status: "Rasoi proxy ✓", storage: "MongoDB" });
  } catch(e) {
    res.json({ status: "Rasoi proxy ✓", storage: "MongoDB disconnected", error: e.message });
  }
});

// ── Claude proxy ──────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY not set" } });
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "content-type":      "application/json",
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch(e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// ── SAVE user data ────────────────────────────────────────────
// POST /api/save
// Body: { userId, pantry, meals, shop, dishes, approved, tgTok, tgCid, avoid }
app.post("/api/save", async (req, res) => {
  const { userId, ...data } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const database   = await getDB();
    const collection = database.collection("users");
    const doc = { ...data, savedAt: new Date() };

    await collection.updateOne(
      { userId },                    // find by userId
      { $set: doc },                 // update all fields
      { upsert: true }               // create if doesn't exist
    );
    res.json({ success: true, savedAt: doc.savedAt });
  } catch(e) {
    console.error("Save error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── LOAD user data ────────────────────────────────────────────
// GET /api/load?userId=abc123
app.get("/api/load", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const database   = await getDB();
    const collection = database.collection("users");
    const user = await collection.findOne({ userId }, { projection: { _id: 0 } });

    user ? res.json({ found: true, ...user })
         : res.json({ found: false });
  } catch(e) {
    console.error("Load error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE user data ──────────────────────────────────────────
// DELETE /api/delete?userId=abc123
app.delete("/api/delete", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const database   = await getDB();
    const collection = database.collection("users");
    await collection.deleteOne({ userId });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: list all users (protected) ────────────────────────
// GET /api/admin/users?secret=YOUR_ADMIN_SECRET
app.get("/api/admin/users", async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.query.secret !== secret) return res.status(403).json({ error: "Forbidden" });
  try {
    const database   = await getDB();
    const collection = database.collection("users");
    const users = await collection.find({}, {
      projection: { _id: 0, userId: 1, savedAt: 1, pantry: 1, meals: 1 }
    }).toArray();
    const summary = users.map(u => ({
      userId:      u.userId,
      savedAt:     u.savedAt,
      pantryCount: (u.pantry||[]).length,
      mealsCount:  (u.meals||[]).length,
    }));
    res.json({ users: summary.length, data: summary });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rasoi proxy + MongoDB on port ${PORT}`));
