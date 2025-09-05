const express = require("express");
const path = require("path");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const fs = require("fs");

const app = express();
const PORT = 3000;

// OAuth2 Config
const CLIENT_ID = "1413571382452686938";
const CLIENT_SECRET = "tTBeR7F29UeYv-MOQ33F1tAAKlAABu9z";
const REDIRECT_URI = "http://localhost:3000/auth/discord/callback";

// JSON bestandslocaties
const USERS_FILE = path.join(__dirname,"users.json");
const MELDINGEN_FILE = path.join(__dirname,"meldingen.json");
const ARCHIEF_FILE = path.join(__dirname, "archief.json");


// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));

// Helper functies
const readFile = (file, fallback=[]) => {
  if(!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file));
};
const writeFile = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null,2));

// Root redirect
app.get("/", (req,res)=>res.redirect("/login"));

// Login route
app.get("/login", (req,res)=>{
  res.sendFile(path.join(__dirname,"public","login.html"));
});

// Logout route
app.get("/logout",(req,res)=>{
  res.clearCookie("userId");
  res.redirect("/login");
});

// Discord OAuth2 login
app.get("/auth/discord",(req,res)=>{
  const scope = "identify";
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

// OAuth2 callback
app.get("/auth/discord/callback", async (req,res)=>{
  const code = req.query.code;
  if(!code) return res.send("Geen code ontvangen");

  try{
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        scope: "identify"
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get("https://discord.com/api/users/@me",{
      headers:{ Authorization:`Bearer ${accessToken}` }
    });

    const discordUser = userRes.data;

    // Lees bestaande users
    let users = readFile(USERS_FILE,[]);

    // Specialisatie uit cookie
    const cookies = req.headers.cookie || "";
    let specialisatie = "Burger"; 
    const match = cookies.match(/specialisatie=([^;]+)/);
    if(match) specialisatie = decodeURIComponent(match[1]);

    // Rol bepalen op basis van specialisatie
    const specialisatieMap = {
      "DSI":"Politie","Recherche":"Politie","Team Verkeer":"Politie","Noodhulp":"Politie","Unmarked":"Politie","Zulu":"Politie",
      "Tankautospuit":"Brandweer","QRT":"Brandweer","Ladderwagen":"Brandweer",
      "Regulier":"Ambulance","Lifeliner 1":"Ambulance","OvD-G":"Ambulance",
      "Rijkswaterstaat":"Handhaving","Boswachter":"Handhaving","Burger":"Reserve Burger", "Meldkamer":"Meldkamer"
    };
    let rol = specialisatieMap[specialisatie] || "Burger";

    // Bereken volgnummer XX
    let bestaandeSpec = users.filter(u=>u.specialisatie===specialisatie).length + 1;
    let xx = bestaandeSpec.toString().padStart(2,"0");

    // Roepnummer map
    const roepnummerMap = {
      "DSI":"A-"+xx,"Recherche":"30-"+xx,"Team Verkeer":"15-"+xx,"Noodhulp":"14-"+xx,"Unmarked":"32-"+xx,"Zulu":"80-14-"+xx,
      "Tankautospuit":"13-21"+xx,"QRT":"13-22"+xx,"Ladderwagen":"13-3151",
      "Regulier":"13-1"+xx,"Lifeliner 1":"13-991","OvD-G":"13-881",
      "Rijkswaterstaat":"34-"+xx,"Boswachter":"33-"+xx,"Reserve Burger":"BU00-"+xx, "Meldkamer":"MK-"+xx
    };
    let roepnummer = roepnummerMap[specialisatie] || "";

    // Nieuwe gebruiker toevoegen of bijwerken
    let user = users.find(u=>u.id===discordUser.id);
    if(!user){
      user = { id: discordUser.id, username: discordUser.username, roles:[rol], specialisatie, roepnummer };
      users.push(user);
    } else {
      // Update rol, specialisatie en roepnummer
      user.roles = [rol];
      user.specialisatie = specialisatie;
      user.roepnummer = roepnummer;
    }

    writeFile(USERS_FILE, users);
    res.cookie("userId", discordUser.id, { httpOnly: true });
    res.redirect("/dashboard.html");

  }catch(err){
    console.error(err);
    res.send("Fout bij Discord login");
  }
});

// API: huidige gebruiker
app.get("/api/me",(req,res)=>{
  const users = readFile(USERS_FILE,[]);
  const user = users.find(u=>u.id===req.cookies.userId);
  res.json(user||{});
});

// API: meldingen ophalen
app.get("/api/meldingen",(req,res)=>{
  const meldingen = readFile(MELDINGEN_FILE,[]);
  res.json(meldingen);
});

// API: melding maken
app.post("/api/melding",(req,res)=>{
  const user = readFile(USERS_FILE,[]).find(u=>u.id===req.cookies.userId);
  if(!user) return res.status(401).json({error:"Niet ingelogd"});
  let meldingen = readFile(MELDINGEN_FILE,[]);
  const id = Date.now();
  meldingen.push({id,...req.body, status:"Open", createdBy:user.username, claimedBy:null});
  writeFile(MELDINGEN_FILE, meldingen);
  res.json({ok:true});
});

// API: melding claimen
app.post("/api/melding/claim/:id",(req,res)=>{
  const user = readFile(USERS_FILE,[]).find(u=>u.id===req.cookies.userId);
  if(!user) return res.status(401).json({error:"Niet ingelogd"});
  let meldingen = readFile(MELDINGEN_FILE,[]);
  const m = meldingen.find(m=>m.id==req.params.id);
  if(m && m.status==="Open") { m.claimedBy=user.username; writeFile(MELDINGEN_FILE, meldingen); }
  res.json({ok:true});
});

// API: melding afsluiten
// API: melding afsluiten
app.post("/api/melding/close/:id", (req, res) => {
  const user = readFile(USERS_FILE, []).find(u => u.id === req.cookies.userId);
  if (!user) return res.status(401).json({ error: "Niet ingelogd" });

  let meldingen = readFile(MELDINGEN_FILE, []);
  const index = meldingen.findIndex(m => m.id == req.params.id);

  if (index !== -1) {
    // Melding naar archief verplaatsen
    const archief = readFile(ARCHIEF_FILE, []);
    const geslotenMelding = meldingen.splice(index, 1)[0]; // verwijder uit meldingen.json
    geslotenMelding.status = "Gesloten"; // status bijwerken
    archief.push(geslotenMelding); // voeg toe aan archief.json
    writeFile(ARCHIEF_FILE, archief);
    writeFile(MELDINGEN_FILE, meldingen); // update actieve meldingen
  }

  res.json({ ok: true });
});


// API: archief meldingen (alle gesloten meldingen)
app.get("/api/archief", (req, res) => {
  const archief = readFile(ARCHIEF_FILE, []);
  res.json(archief);
});





// Server starten
app.listen(PORT, ()=>console.log(`Server draait op http://localhost:${PORT}`));
