const express = require("express");
const cors    = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── MongoDB ───────────────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI;
let db = null;
async function getDB(){
  if(db) return db;
  if(!MONGO_URI) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(MONGO_URI,{serverApi:{version:ServerApiVersion.v1,strict:true,deprecationErrors:true}});
  await client.connect();
  db = client.db("rasoi");
  console.log("MongoDB connected");
  return db;
}

// ── Health ────────────────────────────────────────────────────
app.get("/", async(_,res)=>{
  try{ await getDB(); res.json({status:"Rasoi proxy",storage:"MongoDB"}); }
  catch(e){ res.json({status:"Rasoi proxy",storage:"disconnected",error:e.message}); }
});

// ── Claude proxy ──────────────────────────────────────────────
app.post("/api/claude", async(req,res)=>{
  const key = process.env.ANTHROPIC_API_KEY;
  if(!key) return res.status(500).json({error:{message:"ANTHROPIC_API_KEY not set"}});
  try{
    const up = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify(req.body),
    });
    res.status(up.status).json(await up.json());
  }catch(e){ res.status(500).json({error:{message:e.message}}); }
});

// ── SAVE user profile (pantry, prefs, tg creds) ───────────────
app.post("/api/save", async(req,res)=>{
  const {userId,...data} = req.body;
  if(!userId) return res.status(400).json({error:"userId required"});
  try{
    const col = (await getDB()).collection("users");
    await col.updateOne({userId},{$set:{...data,savedAt:new Date()}},{upsert:true});
    res.json({success:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ── LOAD user profile ─────────────────────────────────────────
app.get("/api/load", async(req,res)=>{
  const {userId} = req.query;
  if(!userId) return res.status(400).json({error:"userId required"});
  try{
    const col  = (await getDB()).collection("users");
    const user = await col.findOne({userId},{projection:{_id:0}});
    user ? res.json({found:true,...user}) : res.json({found:false});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ── SAVE weekly menu ──────────────────────────────────────────
// POST /api/menu/save
// Body: { userId, weekStart (ISO date string), meals, shop }
app.post("/api/menu/save", async(req,res)=>{
  const {userId, weekStart, meals, shop} = req.body;
  if(!userId||!weekStart) return res.status(400).json({error:"userId and weekStart required"});
  try{
    const col = (await getDB()).collection("menus");
    await col.updateOne(
      {userId, weekStart},
      {$set:{meals, shop, savedAt:new Date()}},
      {upsert:true}
    );
    res.json({success:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ── GET recent menu history (last N weeks) ────────────────────
// GET /api/menu/history?userId=xxx&weeks=4
app.get("/api/menu/history", async(req,res)=>{
  const {userId, weeks=4} = req.query;
  if(!userId) return res.status(400).json({error:"userId required"});
  try{
    const col  = (await getDB()).collection("menus");
    const docs = await col
      .find({userId})
      .sort({weekStart:-1})
      .limit(parseInt(weeks))
      .project({_id:0, weekStart:1, meals:1})
      .toArray();
    // Return flat list of dish names used in recent weeks
    const recentDishes = [...new Set(docs.flatMap(d=>(d.meals||[]).map(m=>m.name)))];
    res.json({found:docs.length>0, weeks:docs, recentDishes});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ── GET current week's saved menu ─────────────────────────────
// GET /api/menu/current?userId=xxx&weekStart=2026-02-17
app.get("/api/menu/current", async(req,res)=>{
  const {userId, weekStart} = req.query;
  if(!userId||!weekStart) return res.status(400).json({error:"userId and weekStart required"});
  try{
    const col  = (await getDB()).collection("menus");
    const doc  = await col.findOne({userId,weekStart},{projection:{_id:0}});
    doc ? res.json({found:true,...doc}) : res.json({found:false});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ── DELETE user ───────────────────────────────────────────────
app.delete("/api/delete", async(req,res)=>{
  const {userId} = req.query;
  if(!userId) return res.status(400).json({error:"userId required"});
  try{
    const database = await getDB();
    await database.collection("users").deleteOne({userId});
    await database.collection("menus").deleteMany({userId});
    res.json({success:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ── Admin ─────────────────────────────────────────────────────
app.get("/api/admin/users", async(req,res)=>{
  const secret = process.env.ADMIN_SECRET;
  if(!secret||req.query.secret!==secret) return res.status(403).json({error:"Forbidden"});
  try{
    const users = await (await getDB()).collection("users").find({},{projection:{_id:0,userId:1,savedAt:1}}).toArray();
    res.json({users:users.length,data:users});
  }catch(e){ res.status(500).json({error:e.message}); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Rasoi on port",PORT));
