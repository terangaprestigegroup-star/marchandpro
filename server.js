const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

async function demanderGroq(messageClient, contexte) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const systemPrompt = `Tu es l'assistant IA de MarchandPro, une plateforme de gestion de commandes pour commerçants sénégalais.
Tu réponds UNIQUEMENT en français. Tu es chaleureux, professionnel et efficace.

Catalogue disponible :
- Riz brisé : 22 000 FCFA/sac 50kg
- Huile végétale : 25 000 FCFA/bidon 20L
- Sucre : 30 000 FCFA/sac 50kg
- Farine : 20 000 FCFA/sac 50kg
- Mil : 18 000 FCFA/sac 50kg
- Tomate concentrée : 15 000 FCFA/carton
- Savon : 12 000 FCFA/carton
- Lait en poudre : 8 500 FCFA/boite 2.5kg

Contexte client : ${contexte}

Règles générales :
- Réponds UNIQUEMENT en français, avec des emojis 🇸🇳
- Maximum 5 lignes par réponse
- Ne jamais inventer des prix ou produits hors catalogue
- Si client demande le catalogue, liste les produits avec prix
- Si client demande ses commandes, dis-lui de taper "mes commandes"

Négociation des prix :
- 5 à 9 unités du même produit = remise 3% automatique, annonce-le
- 10 unités ou plus du même produit = remise 5% automatique, annonce-le
- Exemple : 10 sacs de riz = 220 000 - 5% = 209 000 FCFA
- Si client demande plus de remise = refuser poliment, remise max déjà appliquée

Suggestions saisonnières (mars = saison chaude Sénégal) :
- Suggère huile et sucre naturellement en fin de réponse

Délais de livraison :
- Dakar : 24h
- Autres régions : 48 à 72h

Réclamations :
- S'excuser sincèrement, proposer vérification
- Contacter gestionnaire au +221 71 128 84 39`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageClient }
      ],
      max_tokens: 300,
      temperature: 0.7
    })
  });
  const data = await response.json();
  console.log('Groq data:', JSON.stringify(data).substring(0, 200));
  return data.choices?.[0]?.message?.content || null;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(100) UNIQUE,
      password VARCHAR(200),
      role VARCHAR(20) DEFAULT 'vendeur',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      price DECIMAL,
      stock INTEGER DEFAULT 0,
      unit VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER DEFAULT 1,
      customer_phone VARCHAR(50),
      customer_name VARCHAR(100),
      items JSONB,
      total DECIMAL DEFAULT 0,
      status VARCHAR(20) DEFAULT 'nouveau',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      order_id INTEGER,
      number VARCHAR(30),
      amount DECIMAL,
      paid BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER DEFAULT 1,
      phone VARCHAR(50),
      name VARCHAR(100),
      total_orders INTEGER DEFAULT 0,
      total_spent DECIMAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS merchants (
      id SERIAL PRIMARY KEY,
      nom_boutique VARCHAR(100) NOT NULL,
      proprietaire VARCHAR(100),
      whatsapp VARCHAR(50) UNIQUE NOT NULL,
      ville VARCHAR(50) DEFAULT 'Dakar',
      plan VARCHAR(20) DEFAULT 'gratuit',
      actif BOOLEAN DEFAULT true,
      catalogue JSONB DEFAULT '[]',
      referral_code VARCHAR(20) UNIQUE,
      referral_by INTEGER,
      mois_offerts INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS referral_by INTEGER;
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS mois_offerts INTEGER DEFAULT 0;
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS secteur VARCHAR(50) DEFAULT 'alimentaire';
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS pin VARCHAR(10) DEFAULT NULL;
    INSERT INTO merchants (id, nom_boutique, proprietaire, whatsapp, ville, plan, catalogue)
    VALUES (1, 'MarchandPro Demo', 'Terangaprestige', '221711288439', 'Dakar', 'pro',
      '[{"nom":"Riz brisé","unite":"sac 50kg","prix":22000,"mots":["riz"]},{"nom":"Huile végétale","unite":"bidon 20L","prix":25000,"mots":["huile"]},{"nom":"Sucre","unite":"sac 50kg","prix":30000,"mots":["sucre"]},{"nom":"Farine","unite":"sac 50kg","prix":20000,"mots":["farine"]},{"nom":"Mil","unite":"sac 50kg","prix":18000,"mots":["mil"]},{"nom":"Tomate concentrée","unite":"carton","prix":15000,"mots":["tomate"]},{"nom":"Savon","unite":"carton","prix":12000,"mots":["savon"]},{"nom":"Lait en poudre","unite":"boite 2.5kg","prix":8500,"mots":["lait"]}]'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('✅ Base de données MarchandPro initialisée');
}

const SECTEURS = {
  alimentaire: {
    nom: 'Alimentaire',
    emoji: '🌾',
    catalogue: [
      { nom: 'Riz brisé', unite: 'sac 50kg', prix: 22000, mots: ['riz'] },
      { nom: 'Huile végétale', unite: 'bidon 20L', prix: 25000, mots: ['huile'] },
      { nom: 'Sucre', unite: 'sac 50kg', prix: 30000, mots: ['sucre'] },
      { nom: 'Farine', unite: 'sac 50kg', prix: 20000, mots: ['farine'] },
      { nom: 'Mil', unite: 'sac 50kg', prix: 18000, mots: ['mil'] },
      { nom: 'Tomate concentrée', unite: 'carton', prix: 15000, mots: ['tomate'] },
      { nom: 'Savon', unite: 'carton', prix: 12000, mots: ['savon'] },
      { nom: 'Lait en poudre', unite: 'boite 2.5kg', prix: 8500, mots: ['lait'] },
    ]
  },
  pharmacie: {
    nom: 'Pharmacie & Para',
    emoji: '💊',
    catalogue: [
      { nom: 'Paracétamol 500mg', unite: 'boite 100cp', prix: 5000, mots: ['paracetamol','para','doliprane'] },
      { nom: 'Ibuprofène 400mg', unite: 'boite 30cp', prix: 7500, mots: ['ibuprofene','ibu'] },
      { nom: 'Sérum physiologique', unite: 'carton 24 unités', prix: 18000, mots: ['serum','physiologique'] },
      { nom: 'Gants médicaux', unite: 'boite 100 pièces', prix: 12000, mots: ['gants','gant'] },
      { nom: 'Masques chirurgicaux', unite: 'boite 50 pièces', prix: 8000, mots: ['masque','masques'] },
      { nom: 'Crème hydratante', unite: 'carton 12 tubes', prix: 24000, mots: ['creme','hydratante'] },
      { nom: 'Savon médical', unite: 'carton 24 savons', prix: 15000, mots: ['savon'] },
      { nom: 'Vitamine C 1000mg', unite: 'boite 30cp', prix: 9000, mots: ['vitamine','vit'] },
    ]
  },
  quincaillerie: {
    nom: 'Quincaillerie',
    emoji: '🔧',
    catalogue: [
      { nom: 'Ciment Portland', unite: 'sac 50kg', prix: 7500, mots: ['ciment','portland'] },
      { nom: 'Fer à béton 10mm', unite: 'barre 12m', prix: 8500, mots: ['fer','beton'] },
      { nom: 'Peinture blanche', unite: 'bidon 20L', prix: 35000, mots: ['peinture','blanche'] },
      { nom: 'Visserie assortie', unite: 'boite 500 pièces', prix: 12000, mots: ['visserie','vis'] },
      { nom: 'Câble électrique 2.5mm', unite: 'rouleau 100m', prix: 45000, mots: ['cable','electrique'] },
      { nom: 'Tuyau PVC 32mm', unite: 'barre 4m', prix: 3500, mots: ['tuyau','pvc'] },
      { nom: 'Carrelage 40x40', unite: 'm² (carton)', prix: 8000, mots: ['carrelage','carreau'] },
      { nom: 'Plâtre en poudre', unite: 'sac 25kg', prix: 5500, mots: ['platre'] },
    ]
  },
  telephonie: {
    nom: 'Téléphonie',
    emoji: '📱',
    catalogue: [
      { nom: 'Recharge Orange 500F', unite: 'lot 50 codes', prix: 25000, mots: ['recharge','orange'] },
      { nom: 'Recharge Wave', unite: 'lot 50 codes', prix: 25000, mots: ['wave'] },
      { nom: 'Coque iPhone', unite: 'lot 10 pièces', prix: 15000, mots: ['coque','iphone'] },
      { nom: 'Coque Samsung', unite: 'lot 10 pièces', prix: 12000, mots: ['samsung'] },
      { nom: 'Écouteurs filaires', unite: 'lot 10 pièces', prix: 20000, mots: ['ecouteur','ecouteurs'] },
      { nom: 'Câble USB-C', unite: 'lot 10 pièces', prix: 18000, mots: ['cable','usb'] },
      { nom: 'Batterie externe 10000mAh', unite: 'lot 5 pièces', prix: 35000, mots: ['batterie','externe'] },
      { nom: 'Verre trempé', unite: 'lot 10 pièces', prix: 10000, mots: ['verre','trempe'] },
    ]
  },
  textile: {
    nom: 'Textile & Friperie',
    emoji: '👗',
    catalogue: [
      { nom: 'Bazin riche', unite: 'coupon 5m', prix: 35000, mots: ['bazin'] },
      { nom: 'Wax hollandais', unite: 'coupon 6m', prix: 45000, mots: ['wax','hollandais'] },
      { nom: 'Tissu coton uni', unite: 'rouleau 50m', prix: 60000, mots: ['coton','uni'] },
      { nom: 'Friperie mixte', unite: 'balle 45kg', prix: 85000, mots: ['friperie','frip'] },
      { nom: 'T-shirts homme', unite: 'lot 12 pièces', prix: 24000, mots: ['tshirt','shirt'] },
      { nom: 'Pantalons jeans', unite: 'lot 6 pièces', prix: 36000, mots: ['jean','pantalon'] },
      { nom: 'Robes femme', unite: 'lot 6 pièces', prix: 30000, mots: ['robe'] },
      { nom: 'Chaussures mixtes', unite: 'lot 6 paires', prix: 42000, mots: ['chaussure','chaussures'] },
    ]
  },
  menagers: {
    nom: 'Produits Ménagers',
    emoji: '🧴',
    catalogue: [
      { nom: 'Lessive Omo', unite: 'carton 12kg', prix: 18000, mots: ['omo','lessive'] },
      { nom: 'Lessive Ariel', unite: 'carton 12kg', prix: 20000, mots: ['ariel'] },
      { nom: 'Javel Canif', unite: 'carton 24 bouteilles', prix: 14000, mots: ['javel','canif'] },
      { nom: 'Ajax poudre', unite: 'carton 12kg', prix: 16000, mots: ['ajax'] },
      { nom: 'Savon Maquira', unite: 'carton 72 savons', prix: 22000, mots: ['maquira','savon'] },
      { nom: 'Bougies', unite: 'carton 144 pièces', prix: 9000, mots: ['bougie','bougies'] },
      { nom: 'Allumettes', unite: 'lot 100 boites', prix: 6000, mots: ['allumette','allumettes'] },
      { nom: 'Papier hygiénique', unite: 'lot 48 rouleaux', prix: 12000, mots: ['papier','hygienique','wc'] },
    ]
  },
  poisson: {
    nom: 'Poisson & Marée',
    emoji: '🐟',
    catalogue: [
      { nom: 'Thiof frais', unite: 'kg', prix: 4500, mots: ['thiof'] },
      { nom: 'Capitaine frais', unite: 'kg', prix: 3500, mots: ['capitaine'] },
      { nom: 'Sardine fraîche', unite: 'caisse 20kg', prix: 18000, mots: ['sardine'] },
      { nom: 'Yeet (mollusque séché)', unite: 'kg', prix: 8000, mots: ['yeet'] },
      { nom: 'Guedj (poisson séché)', unite: 'kg', prix: 6000, mots: ['guedj','guedje'] },
      { nom: 'Crevettes fraîches', unite: 'kg', prix: 7000, mots: ['crevette','crevettes'] },
      { nom: 'Sole fraîche', unite: 'kg', prix: 5000, mots: ['sole'] },
      { nom: 'Mérou frais', unite: 'kg', prix: 4000, mots: ['merou'] },
    ]
  },
  cosmetiques: {
    nom: 'Cosmétiques & Beauté',
    emoji: '💄',
    catalogue: [
      { nom: 'Crème Khess Petch', unite: 'carton 24 tubes', prix: 36000, mots: ['khess','khesspetch','creme'] },
      { nom: 'Savon Lux', unite: 'carton 72 savons', prix: 28000, mots: ['lux','savon'] },
      { nom: 'Huile de coco', unite: 'carton 12 bouteilles', prix: 24000, mots: ['coco','huile'] },
      { nom: 'Beurre de karité', unite: 'kg', prix: 5000, mots: ['karite','beurre'] },
      { nom: 'Parfum oud arabique', unite: 'lot 12 flacons', prix: 60000, mots: ['oud','parfum','arabique'] },
      { nom: 'Musc blanc', unite: 'lot 12 flacons', prix: 45000, mots: ['musc','blanc'] },
      { nom: 'Henné naturel', unite: 'kg', prix: 8000, mots: ['henne'] },
      { nom: 'Extensions cheveux', unite: 'lot 10 pièces', prix: 35000, mots: ['extension','cheveux','perruque'] },
    ]
  },
  cereales: {
    nom: 'Céréales & Légumineuses',
    emoji: '🌿',
    catalogue: [
      { nom: 'Niébé local', unite: 'sac 50kg', prix: 28000, mots: ['niebe','haricot'] },
      { nom: 'Arachide décortiquée', unite: 'sac 50kg', prix: 35000, mots: ['arachide','cacahuete'] },
      { nom: 'Mil local', unite: 'sac 50kg', prix: 18000, mots: ['mil'] },
      { nom: 'Maïs grain', unite: 'sac 50kg', prix: 16000, mots: ['mais','maïs'] },
      { nom: 'Sorgho', unite: 'sac 50kg', prix: 15000, mots: ['sorgho'] },
      { nom: 'Bissap séché', unite: 'kg', prix: 4500, mots: ['bissap','hibiscus'] },
      { nom: 'Sésame blanc', unite: 'kg', prix: 6000, mots: ['sesame'] },
      { nom: 'Lentilles', unite: 'sac 25kg', prix: 22000, mots: ['lentille','lentilles'] },
    ]
  },
  viande: {
    nom: 'Viande & Volaille',
    emoji: '🥩',
    catalogue: [
      { nom: 'Bœuf (demi-carcasse)', unite: 'kg', prix: 3500, mots: ['boeuf','vache','viande'] },
      { nom: 'Mouton entier', unite: 'tête', prix: 85000, mots: ['mouton','belier'] },
      { nom: 'Poulet de chair', unite: 'kg vif', prix: 2200, mots: ['poulet','volaille'] },
      { nom: 'Poulet congelé', unite: 'carton 10kg', prix: 22000, mots: ['congele','congelé'] },
      { nom: 'Agneau entier', unite: 'tête', prix: 65000, mots: ['agneau'] },
      { nom: 'Abats bœuf', unite: 'kg', prix: 1800, mots: ['abats','foie','tripes'] },
      { nom: 'Chèvre entière', unite: 'tête', prix: 45000, mots: ['chevre','chèvre'] },
      { nom: 'Dinde', unite: 'pièce', prix: 18000, mots: ['dinde','dindon'] },
    ]
  },
  emballage: {
    nom: 'Emballage & Conditionnement',
    emoji: '📦',
    catalogue: [
      { nom: 'Sachets plastiques 25kg', unite: 'lot 1000 pièces', prix: 12000, mots: ['sachet','plastique'] },
      { nom: 'Cartons d\'expédition', unite: 'lot 50 pièces', prix: 18000, mots: ['carton','expedition'] },
      { nom: 'Sacs kraft 5kg', unite: 'lot 500 pièces', prix: 22000, mots: ['kraft','sac'] },
      { nom: 'Boîtes alimentaires', unite: 'lot 100 pièces', prix: 15000, mots: ['boite','alimentaire'] },
      { nom: 'Film étirable', unite: 'rouleau 500m', prix: 25000, mots: ['film','etirable'] },
      { nom: 'Ficelle emballage', unite: 'rouleau 1kg', prix: 4500, mots: ['ficelle','corde'] },
      { nom: 'Étiquettes adhésives', unite: 'lot 1000 pièces', prix: 8000, mots: ['etiquette','adhesif'] },
      { nom: 'Ruban adhésif', unite: 'lot 12 rouleaux', prix: 6000, mots: ['ruban','scotch','adhesif'] },
    ]
  },
  boissons: {
    nom: 'Boissons',
    emoji: '🥤',
    catalogue: [
      { nom: 'Eau minérale 1.5L', unite: 'palette 96 bouteilles', prix: 18000, mots: ['eau','minerale','kirene','cristalline'] },
      { nom: 'Eau minérale 0.5L', unite: 'carton 24 bouteilles', prix: 4800, mots: ['eau','petite','demi'] },
      { nom: 'Jus de fruits Vitalait', unite: 'carton 24 briques', prix: 12000, mots: ['jus','vitalait','brique'] },
      { nom: 'Bissap concentré', unite: 'bidon 5L', prix: 8500, mots: ['bissap','concentre'] },
      { nom: 'Gingembre concentré', unite: 'bidon 5L', prix: 9000, mots: ['gingembre','ginger'] },
      { nom: 'Coca-Cola', unite: 'casier 24 bouteilles', prix: 9600, mots: ['coca','cola','soda'] },
      { nom: 'Lait Candia', unite: 'carton 24 briques', prix: 14400, mots: ['lait','candia'] },
      { nom: 'Yogourt Kirène', unite: 'carton 12 pots', prix: 6000, mots: ['yaourt','yogourt','kirene'] },
    ]
  },
  gaz: {
    nom: 'Gaz & Énergie',
    emoji: '⛽',
    catalogue: [
      { nom: 'Bouteille gaz 6kg', unite: 'pièce', prix: 5500, mots: ['gaz','6kg','petite bouteille'] },
      { nom: 'Bouteille gaz 12kg', unite: 'pièce', prix: 10500, mots: ['gaz','12kg','grande bouteille'] },
      { nom: 'Bouteille gaz 38kg', unite: 'pièce', prix: 32000, mots: ['gaz','38kg','industriel'] },
      { nom: 'Pétrole lampant', unite: 'bidon 20L', prix: 18000, mots: ['petrole','lampant','lampe'] },
      { nom: 'Charbon de bois', unite: 'sac 50kg', prix: 8000, mots: ['charbon','bois'] },
      { nom: 'Bougie', unite: 'carton 144 pièces', prix: 7200, mots: ['bougie','bougies'] },
      { nom: 'Régulateur gaz', unite: 'pièce', prix: 4500, mots: ['regulateur','detendeur'] },
      { nom: 'Tuyau flexible gaz', unite: 'pièce 1.5m', prix: 3500, mots: ['tuyau','flexible','gaz'] },
    ]
  }
};

const CATALOGUE = SECTEURS.alimentaire.catalogue;

function formaterCatalogue() {
  let msg = '📦 *Catalogue MarchandPro* 🇸🇳\n\n';
  CATALOGUE.forEach((p, i) => {
    msg += `${i + 1}. *${p.nom}* — ${p.prix.toLocaleString('fr-FR')} FCFA/${p.unite}\n`;
  });
  msg += '\nPour commander, écrivez :\n_"je veux 3 sacs de riz et 2 bidons d\'huile"_';
  return msg;
}

function parserCommande(message) {
  const produits = [];
  const messageNorm = message.normalize('NFC').replace(/[''‛`´]/g, "'").replace(/d'(\w)/gi, 'de $1');
  const regex = /(\d+)\s*(sacs?|bidons?|boites?|kg|litres?|unités?|cartons?|paquets?)\s+(?:de\s+)?(\w+)/gi;
  let match;
  while ((match = regex.exec(messageNorm)) !== null) {
    const quantite = parseInt(match[1]);
    const unite = match[2];
    const motProduit = match[3].toLowerCase();
    if (motProduit.length <= 1) continue; // ignorer les mots vides comme "d"
    const produitTrouve = CATALOGUE.find(p => p.mots.some(m => motProduit.includes(m)));
    if (!produitTrouve) continue; // ignorer les produits non reconnus
    produits.push({
      quantite,
      unite,
      produit: produitTrouve.nom,
      prix_unitaire: produitTrouve.prix,
      total: produitTrouve.prix * quantite
    });
  }
  return produits;
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requis' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'marchandpro2026');
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

// Middleware admin — protège les routes sensibles
function adminMiddleware(req, res, next) {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'marchandpro-admin-2026';
  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé — secret admin requis' });
  }
  next();
}

// Middleware merchant — vérifie que le merchant accède à ses propres données
async function merchantMiddleware(req, res, next) {
  try {
    const merchantId = req.body.merchant_id || req.params.merchant_id || req.query.merchant_id;
    const pin = req.headers['x-merchant-pin'] || req.query.pin;
    if (!merchantId) return next(); // Routes sans merchant_id passent
    if (pin) {
      const result = await pool.query('SELECT * FROM merchants WHERE id=$1', [merchantId]);
      const m = result.rows[0];
      if (m && m.pin && m.pin !== pin) {
        return res.status(403).json({ error: 'PIN incorrect' });
      }
    }
    next();
  } catch(e) { next(); }
}

async function envoyerWhatsApp(phone_id, to, message) {
  const token = process.env.META_TOKEN;
  await fetch(`https://graph.facebook.com/v18.0/${phone_id}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
  });
}

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
      [name, email, hash, role || 'vendeur']
    );
    const token = jwt.sign(result.rows[0], process.env.JWT_SECRET || 'marchandpro2026');
    res.json({ user: result.rows[0], token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });
    const token = jwt.sign(
      { id: result.rows[0].id, email, role: result.rows[0].role },
      process.env.JWT_SECRET || 'marchandpro2026'
    );
    res.json({ token, user: { id: result.rows[0].id, name: result.rows[0].name, email, role: result.rows[0].role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === 'marchandpro2026') {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Mémoire temporaire: quel client appartient à quel merchant
const clientMerchantMap = {};
// Commandes en attente d'adresse de livraison
const pendingAddress = {}; // phone -> { orderId, ref, total }
const pendingRecurrent = {}; // phone -> { items, total, merchant_id }
const pendingAvis = {}; // phone -> { orderId, merchantId, ref }

async function getMerchantByClient(phone) {
  // 1. Vérifier en mémoire
  if (clientMerchantMap[phone]) {
    const m = await pool.query('SELECT * FROM merchants WHERE id=$1 AND actif=true', [clientMerchantMap[phone]]);
    if (m.rows[0]) return m.rows[0];
  }
  // 2. Chercher la dernière commande du client
  const lastOrder = await pool.query(
    'SELECT merchant_id FROM orders WHERE customer_phone=$1 ORDER BY created_at DESC LIMIT 1', [phone]
  );
  if (lastOrder.rows[0]) {
    const m = await pool.query('SELECT * FROM merchants WHERE id=$1 AND actif=true', [lastOrder.rows[0].merchant_id]);
    if (m.rows[0]) { clientMerchantMap[phone] = m.rows[0].id; return m.rows[0]; }
  }
  // 3. Merchant par défaut (id=1)
  const def = await pool.query('SELECT * FROM merchants WHERE id=1');
  return def.rows[0];
}

function formaterCatalogueMerchant(merchant) {
  const catalogue = merchant.catalogue || CATALOGUE;
  let msg = `📦 *Catalogue ${merchant.nom_boutique}* 🇸🇳\n\n`;
  catalogue.forEach((p, i) => {
    msg += `${i+1}. *${p.nom}* — ${parseInt(p.prix).toLocaleString('fr-FR')} FCFA/${p.unite}\n`;
  });
  msg += '\nPour commander, écrivez :\n_"je veux 3 sacs de riz et 2 bidons d\'huile"_';
  return msg;
}

function parserCommandeMerchant(message, catalogue) {
  const produits = [];
  const messageNorm = message
    .normalize('NFC')
    .replace(/[''‛`´]/g, "'")
    .replace(/d'(\w)/gi, 'de $1')
    .replace(/l'(\w)/gi, 'le $1');

  // Pattern 1 : "3 sacs de riz", "2 bidons d'huile"
  const regex1 = /(\d+)\s*(sacs?|bidons?|boites?|kg|litres?|unités?|cartons?|paquets?|barre?s?)\s+(?:de\s+)?(\w+)/gi;
  // Pattern 2 : "riz 3 sacs", "huile 2 bidons"  
  const regex2 = /(\w+)\s+(\d+)\s*(sacs?|bidons?|boites?|cartons?|paquets?)/gi;
  // Pattern 3 : juste "3 riz", "2 huile" (quantité + nom produit)
  const regex3 = /(\d+)\s+(\w{3,})/gi;

  const ajouter = (quantite, unite, motProduit) => {
    if (motProduit.length <= 1) return;
    const motNorm = motProduit.toLowerCase()
      .replace(/é/g,'e').replace(/è/g,'e').replace(/ê/g,'e')
      .replace(/â/g,'a').replace(/û/g,'u');
    const produitTrouve = catalogue.find(p =>
      (p.mots || []).some(m => motNorm.includes(m) || m.includes(motNorm))
    );
    if (!produitTrouve) return;
    // Éviter les doublons
    if (produits.find(p => p.produit === produitTrouve.nom)) return;
    produits.push({
      quantite,
      unite: unite || produitTrouve.unite,
      produit: produitTrouve.nom,
      prix_unitaire: produitTrouve.prix,
      total: produitTrouve.prix * quantite
    });
  };

  let match;
  while ((match = regex1.exec(messageNorm)) !== null) {
    ajouter(parseInt(match[1]), match[2], match[3]);
  }
  if (produits.length === 0) {
    while ((match = regex2.exec(messageNorm)) !== null) {
      ajouter(parseInt(match[2]), match[3], match[1]);
    }
  }
  if (produits.length === 0) {
    while ((match = regex3.exec(messageNorm)) !== null) {
      const mot = match[2].toLowerCase();
      if (['veux','vois','sacs','sac','des','les','une','pour','avec'].includes(mot)) continue;
      ajouter(parseInt(match[1]), null, mot);
    }
  }
  return produits;
}

// ============================================
// TRANSCRIPTION VOCALE — Groq Whisper
// ============================================
async function transcrireVocal(mediaId) {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const META_TOKEN = process.env.META_TOKEN;

    // 1. Récupérer URL du fichier audio depuis Meta
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${META_TOKEN}` }
    });
    const mediaData = await mediaRes.json();
    if (!mediaData.url) throw new Error('URL audio introuvable');

    // 2. Télécharger le fichier audio
    const audioRes = await fetch(mediaData.url, {
      headers: { 'Authorization': `Bearer ${META_TOKEN}` }
    });
    const audioBuffer = await audioRes.arrayBuffer();
    const audioBytes = Buffer.from(audioBuffer);

    // 3. Envoyer à Groq Whisper
    const formData = new FormData();
    const blob = new Blob([audioBytes], { type: 'audio/ogg' });
    formData.append('file', blob, 'vocal.ogg');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'fr');
    formData.append('response_format', 'json');

    const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: formData
    });
    const whisperData = await whisperRes.json();
    console.log('Whisper transcription:', whisperData.text);
    return whisperData.text || null;
  } catch(e) {
    console.error('Erreur Whisper:', e.message);
    return null;
  }
}

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      // ============================================
      // GESTION MESSAGES VOCAUX (audio/ogg)
      // ============================================
      if (message && (message.type === 'audio' || message.type === 'voice')) {
        const phone = message.from;
        const phone_id = change.value.metadata.phone_number_id;
        const mediaId = message.audio?.id || message.voice?.id;

        // Accusé de réception immédiat
        await envoyerWhatsApp(phone_id, phone, `🎙️ *Vocal reçu !* Je transcris votre message...`);

        const transcription = await transcrireVocal(mediaId);

        if (!transcription) {
          await envoyerWhatsApp(phone_id, phone,
            `❌ Je n'ai pas pu comprendre votre vocal.\n\nEssayez de parler plus clairement ou tapez votre commande en texte. 😊`
          );
          return res.sendStatus(200);
        }

        // Log et traitement comme un message texte
        console.log(`🎙️ Vocal transcrit [${phone}]: "${transcription}"`);

        const merchant = await getMerchantByClient(phone);
        const catalogue = merchant.catalogue || CATALOGUE;
        const texte = transcription.toLowerCase();
        const produits = parserCommandeMerchant(texte, catalogue);

        if (produits.length > 0) {
          // Calculer total + remises
          const total = produits.reduce((sum, p) => sum + p.total, 0);
          let totalApresRemise = total;
          let remiseMsg = '';
          produits.forEach(p => {
            if (p.quantite >= 10) {
              const remise = Math.round(p.total * 0.05);
              totalApresRemise -= remise;
              remiseMsg += `🎁 Remise 5% sur ${p.produit} : -${remise.toLocaleString('fr-FR')} FCFA\n`;
            } else if (p.quantite >= 5) {
              const remise = Math.round(p.total * 0.03);
              totalApresRemise -= remise;
              remiseMsg += `🎁 Remise 3% sur ${p.produit} : -${remise.toLocaleString('fr-FR')} FCFA\n`;
            }
          });

          const count = await pool.query('SELECT COUNT(*) FROM orders');
          const ref = `CMD-${String(parseInt(count.rows[0].count) + 1).padStart(4,'0')}`;
          const lignes = produits.map(p => `• ${p.quantite} ${p.unite} de *${p.produit}* — ${p.total.toLocaleString('fr-FR')} FCFA`).join('\n');

          await pool.query(
            'INSERT INTO orders (merchant_id, customer_phone, items, total, status, reference) VALUES ($1,$2,$3,$4,$5,$6)',
            [merchant.id, phone, JSON.stringify(produits), totalApresRemise, 'nouveau', ref]
          );
          const orderId = (await pool.query('SELECT id FROM orders WHERE reference=$1', [ref])).rows[0]?.id;
          if (orderId) pendingAddress[phone] = { orderId, ref, total: totalApresRemise };

          await envoyerWhatsApp(phone_id, phone,
            `🎙️ *J'ai bien entendu :* _"${transcription}"_\n\n` +
            `✅ *Commande enregistrée !*\n\n${lignes}\n\n${remiseMsg}` +
            `💰 *Total : ${totalApresRemise.toLocaleString('fr-FR')} FCFA*\n📋 Réf : *${ref}*\n\n` +
            `📍 À quelle adresse souhaitez-vous être livré ?`
          );
        } else {
          await envoyerWhatsApp(phone_id, phone,
            `🎙️ *J'ai transcrit :* _"${transcription}"_\n\n` +
            `❓ Je n'ai pas reconnu de produit dans votre vocal.\n\n` +
            `Dites par exemple :\n_"je veux cinq sacs de riz et deux bidons d'huile"_\n\n` +
            `Ou tapez *catalogue* pour voir les produits disponibles.`
          );
        }
        return res.sendStatus(200);
      }

      if (message && message.type === 'text') {
        const phone = message.from;
        const texteOriginal = message.text.body.trim();
        const texte = texteOriginal.toLowerCase();
        const phone_id = change.value.metadata.phone_number_id;

        // ============================================
        // DÉTECTION MERCHANT VIA CODE (Option C)
        // ============================================
        // Si le message commence par un code merchant (ex: "AMADOU", "BOUTIQUE123")
        const codeMatch = texteOriginal.match(/^([A-Z0-9]{3,20})\s*$/);
        if (codeMatch) {
          const code = codeMatch[1].toUpperCase();
          // Chercher merchant par nom_boutique ou whatsapp contenant ce code
          const merchantResult = await pool.query(
            `SELECT * FROM merchants WHERE actif=true AND (
              UPPER(REPLACE(nom_boutique,' ','')) LIKE $1 OR
              UPPER(proprietaire) LIKE $1
            ) LIMIT 1`,
            [`%${code}%`]
          );
          if (merchantResult.rows[0]) {
            const m = merchantResult.rows[0];
            clientMerchantMap[phone] = m.id;
            await envoyerWhatsApp(phone_id, phone,
              `👋 Bienvenue chez *${m.nom_boutique}* ! 🇸🇳\n\n` +
              `Je suis votre assistant de commande automatique.\n\n` +
              `1️⃣ Tapez *catalogue* — voir les produits\n` +
              `2️⃣ Tapez *commander* — passer une commande\n` +
              `3️⃣ Tapez *mes commandes* — voir vos commandes\n\n` +
              `Livraison rapide à ${m.ville} ! 📦`
            );
            return res.status(200).send('OK');
          }
        }

        // Récupérer le merchant du client
        const merchant = await getMerchantByClient(phone);
        const catalogue = merchant.catalogue || CATALOGUE;

        // Menu principal
        if (['menu', 'aide', 'help'].includes(texte) ||
            ['bonjour', 'salut', 'bonsoir', 'hello', 'allo', 'allô'].includes(texte)) {
          await envoyerWhatsApp(phone_id, phone,
            `👋 Bienvenue chez *${merchant.nom_boutique}* ! 🇸🇳\n\n` +
            `1️⃣ *catalogue* — voir nos produits\n` +
            `2️⃣ *commander* — passer une commande\n` +
            `3️⃣ *mes commandes* — suivre mes commandes\n` +
            `4️⃣ *annuler* — annuler une commande\n` +
            `5️⃣ *problème* — signaler un problème\n\n` +
            `Livraison rapide à ${merchant.ville} ! 📦`
          );
        }
        // Catalogue
        else if (texte.includes('catalogue') || texte.includes('produit') || texte === '1') {
          await envoyerWhatsApp(phone_id, phone, formaterCatalogueMerchant(merchant));
        }
        // Mes commandes
        else if ((texte.includes('commande') && texte.includes('mes')) || texte === '3') {
          const result = await pool.query('SELECT * FROM orders WHERE customer_phone=$1 AND merchant_id=$2 ORDER BY created_at DESC LIMIT 5', [phone, merchant.id]);
          if (result.rows.length === 0) {
            await envoyerWhatsApp(phone_id, phone, `📋 Vous n'avez pas encore de commandes.\n\nTapez *catalogue* pour voir nos produits ! 😊`);
          } else {
            let msg = `📋 *Vos dernières commandes :*\n\n`;
            result.rows.forEach(o => {
              const emoji = o.status === 'livré' ? '✅' : o.status === 'confirmé' ? '🔄' : o.status === 'annulé' ? '❌' : '⏳';
              msg += `${emoji} CMD-${String(o.id).padStart(4,'0')} — ${o.status.toUpperCase()} — ${Number(o.total).toLocaleString('fr-FR')} FCFA\n`;
            });
            msg += `\nPour suivre une commande, tapez son numéro. Ex: *CMD-0027*\nPour annuler, tapez *annuler CMD-XXXX*`;
            await envoyerWhatsApp(phone_id, phone, msg);
          }
        }
        // Suivi commande CMD-XXXX
        else if (texte.match(/cmd-\d+/i) && !texte.includes('annul')) {
          const ref = texte.match(/cmd-(\d+)/i)[1];
          const result = await pool.query('SELECT * FROM orders WHERE id=$1', [parseInt(ref)]);
          if (result.rows[0]) {
            const o = result.rows[0];
            const emoji = o.status === 'livré' ? '✅' : o.status === 'confirmé' ? '🔄' : o.status === 'annulé' ? '❌' : '⏳';
            const items = (o.items || []).map(i => `• ${i.quantite} ${i.unite} de ${i.produit}`).join('\n');
            await envoyerWhatsApp(phone_id, phone,
              `${emoji} *CMD-${String(o.id).padStart(4,'0')}*\n\n` +
              `📦 Produits :\n${items}\n\n` +
              `💰 Total : *${Number(o.total).toLocaleString('fr-FR')} FCFA*\n` +
              `📌 Statut : *${o.status.toUpperCase()}*\n` +
              `📅 Date : ${new Date(o.created_at).toLocaleDateString('fr-FR')}\n\n` +
              `Pour annuler cette commande, tapez *annuler CMD-${String(o.id).padStart(4,'0')}*`
            );
          } else {
            await envoyerWhatsApp(phone_id, phone, `❌ Commande introuvable. Vérifiez le numéro et réessayez.`);
          }
        }
        // Annulation commande
        else if (texte.includes('annul')) {
          const cmdMatch = texte.match(/cmd-(\d+)/i);
          if (cmdMatch) {
            const cmdId = parseInt(cmdMatch[1]);
            const result = await pool.query('SELECT * FROM orders WHERE id=$1 AND customer_phone=$2', [cmdId, phone]);
            if (result.rows[0]) {
              const o = result.rows[0];
              if (['livré', 'annulé'].includes(o.status)) {
                await envoyerWhatsApp(phone_id, phone,
                  `⚠️ CMD-${String(o.id).padStart(4,'0')} ne peut plus être annulée.\n` +
                  `Statut actuel : *${o.status.toUpperCase()}*\n\n` +
                  `Pour toute assistance, appelez le *+221 71 128 84 39* 📞`
                );
              } else {
                await pool.query('UPDATE orders SET status=$1 WHERE id=$2', ['annulé', cmdId]);
                await envoyerWhatsApp(phone_id, phone,
                  `✅ *CMD-${String(o.id).padStart(4,'0')} annulée avec succès.*\n\n` +
                  `Nous avons bien pris en compte votre annulation.\n` +
                  `Montant : ${Number(o.total).toLocaleString('fr-FR')} FCFA\n\n` +
                  `Tapez *catalogue* pour passer une nouvelle commande 🛒`
                );
              }
            } else {
              await envoyerWhatsApp(phone_id, phone,
                `❌ Commande introuvable ou vous n'êtes pas autorisé à l'annuler.\n\n` +
                `Tapez *mes commandes* pour voir vos commandes.`
              );
            }
          } else {
            // Annulation sans numéro — demander lequel
            const result = await pool.query(
              `SELECT * FROM orders WHERE customer_phone=$1 AND merchant_id=$2 AND status NOT IN ('livré','annulé') ORDER BY created_at DESC LIMIT 3`,
              [phone, merchant.id]
            );
            if (result.rows.length === 0) {
              await envoyerWhatsApp(phone_id, phone, `📋 Vous n'avez aucune commande en cours à annuler.`);
            } else {
              let msg = `❌ *Quelle commande voulez-vous annuler ?*\n\n`;
              result.rows.forEach(o => {
                msg += `• CMD-${String(o.id).padStart(4,'0')} — ${Number(o.total).toLocaleString('fr-FR')} FCFA — ${o.status}\n`;
              });
              msg += `\nRépondez avec le numéro. Ex: *annuler CMD-${String(result.rows[0].id).padStart(4,'0')}*`;
              await envoyerWhatsApp(phone_id, phone, msg);
            }
          }
        }
        // Réclamations / Problèmes
        else if (texte.includes('problème') || texte.includes('probleme') || texte.includes('réclamation') ||
                 texte.includes('reclamation') || texte.includes('erreur') || texte.includes('plainte') ||
                 texte.includes('mauvais') || texte.includes('pas reçu') || texte.includes('manquant') || texte === '5') {
          const derniereCmd = await pool.query(
            `SELECT * FROM orders WHERE customer_phone=$1 AND merchant_id=$2 ORDER BY created_at DESC LIMIT 1`,
            [phone, merchant.id]
          );
          let msgReclamation = `🙏 *Nous sommes désolés pour ce problème.*\n\n`;
          if (derniereCmd.rows[0]) {
            const o = derniereCmd.rows[0];
            msgReclamation += `Votre dernière commande :\n`;
            msgReclamation += `📦 CMD-${String(o.id).padStart(4,'0')} — ${Number(o.total).toLocaleString('fr-FR')} FCFA\n`;
            msgReclamation += `📌 Statut : ${o.status.toUpperCase()}\n\n`;
          }
          msgReclamation += `Notre équipe va traiter votre réclamation dans les plus brefs délais.\n\n`;
          msgReclamation += `📞 Contactez directement notre gestionnaire :\n*+221 71 128 84 39*\n\n`;
          msgReclamation += `Merci de votre patience ! 🇸🇳`;
          await envoyerWhatsApp(phone_id, phone, msgReclamation);
        }
        // Commander
        else if (texte.includes('commander') || texte === '2') {
          await envoyerWhatsApp(phone_id, phone,
            `🛒 Pour commander, écrivez simplement ce que vous voulez :\n\n_Exemple : "je veux 3 sacs de riz et 2 bidons d'huile"_\n\nTapez *catalogue* pour voir tous nos produits et prix. 📦`
          );
        }
        // Groq AI + Parser commande
        else {

          // ============================================
          // AVIS CLIENT — après livraison
          // ============================================
          if (pendingAvis[phone]) {
            const { orderId, merchantId, ref } = pendingAvis[phone];
            let note = null;
            if (['1', '⭐', 'mauvais', 'nul', 'pas bien'].includes(texte)) note = 1;
            else if (['2', '3', 'correct', 'bien', 'moyen', 'ok', 'bof'].includes(texte)) note = 3;
            else if (['3', '4', '5', 'excellent', 'parfait', 'super', 'top', 'très bien', 'tres bien', 'bravo'].includes(texte)) note = 5;

            if (note !== null) {
              delete pendingAvis[phone];
              const etoiles = '⭐'.repeat(note);
              // Sauvegarder l'avis
              await pool.query(
                `UPDATE orders SET items = items || jsonb_build_object('avis', $1, 'note', $2) WHERE id=$3`,
                [texte, note, orderId]
              );
              await envoyerWhatsApp(phone_id, phone,
                `${etoiles} *Merci pour votre avis !*\n\n` +
                `Votre retour nous aide à améliorer notre service 🙏\n\n` +
                `À très bientôt chez nous ! 🇸🇳`
              );
              // Notifier le grossiste
              try {
                const mRes = await pool.query('SELECT * FROM merchants WHERE id=$1', [merchantId]);
                if (mRes.rows[0]?.whatsapp) {
                  await envoyerWhatsApp(phone_id, mRes.rows[0].whatsapp,
                    `⭐ *Nouvel avis client !*\n\n` +
                    `Commande : *${ref}*\n` +
                    `Note : *${etoiles} (${note}/5)*\n` +
                    `Client : ${phone}`
                  );
                }
              } catch(e) {}
            } else {
              await envoyerWhatsApp(phone_id, phone,
                `❓ Tapez :\n1️⃣ pour Mauvais\n2️⃣ pour Correct\n3️⃣ pour Excellent`
              );
            }
            return res.sendStatus(200);
          }

          // ============================================
          // COMMANDE RÉCURRENTE — "commande habituelle"
          // ============================================
          const motsCles = ['habituelle','comme d\'habitude','comme la derniere','comme avant','meme chose','même chose','recommande','re-commande','renouveler','habituel','habituel','encore pareil'];
          const isHabituelle = motsCles.some(m => texte.includes(m)) || texte === 'habituelle' || texte === 'récurrente';

          if (isHabituelle) {
            // Retrouver la dernière commande du client
            const lastOrder = await pool.query(
              `SELECT * FROM orders WHERE customer_phone=$1 AND merchant_id=$2 AND status NOT IN ('annulé') ORDER BY created_at DESC LIMIT 1`,
              [phone, merchant.id]
            );
            if (!lastOrder.rows[0]) {
              await envoyerWhatsApp(phone_id, phone,
                `😊 Vous n'avez pas encore de commande précédente.\n\nTapez *catalogue* pour voir nos produits et passer votre première commande !`
              );
            } else {
              const derniere = lastOrder.rows[0];
              const items = Array.isArray(derniere.items) ? derniere.items : [];
              const lignes = items.filter(i => i.produit).map(i => `• ${i.quantite} ${i.unite || ''} de *${i.produit}* — ${Number(i.total || 0).toLocaleString('fr-FR')} FCFA`).join('\n');
              const total = Number(derniere.total);

              // Sauvegarder en attente de confirmation
              pendingRecurrent[phone] = { items, total, merchant_id: merchant.id };

              await envoyerWhatsApp(phone_id, phone,
                `🔄 *Votre commande habituelle :*\n\n${lignes}\n\n💰 *Total : ${total.toLocaleString('fr-FR')} FCFA*\n\n` +
                `Tapez *OUI* pour confirmer cette commande\nTapez *NON* pour annuler`
              );
            }
            return res.sendStatus(200);
          }

          // Confirmation commande récurrente
          if (pendingRecurrent[phone]) {
            if (['oui','yes','ok','confirme','confirmer','yep','ouai','ouais'].includes(texte)) {
              const { items, total, merchant_id } = pendingRecurrent[phone];
              delete pendingRecurrent[phone];

              const count = await pool.query('SELECT COUNT(*) FROM orders');
              const ref = `CMD-${String(parseInt(count.rows[0].count) + 1).padStart(4,'0')}`;

              await pool.query(
                'INSERT INTO orders (merchant_id, customer_phone, items, total, status, reference) VALUES ($1,$2,$3,$4,$5,$6)',
                [merchant_id, phone, JSON.stringify(items), total, 'nouveau', ref]
              );

              const orderId = (await pool.query('SELECT id FROM orders WHERE reference=$1', [ref])).rows[0]?.id;
              if (orderId) pendingAddress[phone] = { orderId, ref, total };

              const lignes = items.filter(i => i.produit).map(i => `• ${i.quantite} ${i.unite || ''} de *${i.produit}*`).join('\n');
              await envoyerWhatsApp(phone_id, phone,
                `✅ *Commande habituelle confirmée !*\n\n${lignes}\n\n💰 *Total : ${total.toLocaleString('fr-FR')} FCFA*\n📋 Réf : *${ref}*\n\n📍 À quelle adresse souhaitez-vous être livré ?`
              );

              // Notifier le grossiste
              try {
                await envoyerWhatsApp(phone_id, merchant.whatsapp,
                  `🔄 *Commande habituelle reçue !*\n\n` +
                  `👤 Client : ${phone}\n${lignes}\n💰 Total : *${total.toLocaleString('fr-FR')} FCFA*\n📋 Réf : *${ref}*`
                );
              } catch(e) {}

            } else if (['non','no','annule','annuler','nope'].includes(texte)) {
              delete pendingRecurrent[phone];
              await envoyerWhatsApp(phone_id, phone,
                `❌ Commande annulée.\n\nTapez *catalogue* pour voir nos produits ou *commander* pour passer une nouvelle commande. 😊`
              );
            } else {
              await envoyerWhatsApp(phone_id, phone,
                `❓ Tapez *OUI* pour confirmer votre commande habituelle ou *NON* pour annuler.`
              );
            }
            return res.sendStatus(200);
          }

          // Si client en attente d'adresse de livraison
          if (pendingAddress[phone]) {
            const { orderId, ref, total } = pendingAddress[phone];
            const adresse = texte.trim();
            // Sauvegarder adresse dans la commande
            await pool.query("UPDATE orders SET items = items || jsonb_build_object('adresse_livraison', $1) WHERE id=$2", [adresse, orderId]);
            delete pendingAddress[phone];
            await envoyerWhatsApp(phone_id, phone,
              `📍 *Adresse enregistrée !*\n\n` +
              `Commande *${ref}* — *${total.toLocaleString('fr-FR')} FCFA*\n` +
              `Livraison à : *${adresse}*\n\n` +
              `✅ Votre commande est confirmée. Le grossiste vous contactera pour la livraison.\n\n` +
              `_MarchandPro 🇸🇳_`
            );
            return res.sendStatus(200);
          }
          const produits = parserCommandeMerchant(texte, catalogue);
          if (produits.length > 0) {
            const total = produits.reduce((sum, p) => sum + p.total, 0);
            let totalApresRemise = total;
            let remiseMsg = '';

            produits.forEach(p => {
              if (p.quantite >= 10) {
                const remise = Math.round(p.total * 0.05);
                totalApresRemise -= remise;
                remiseMsg += `🎁 Remise 5% sur ${p.produit} : -${remise.toLocaleString('fr-FR')} FCFA\n`;
              } else if (p.quantite >= 5) {
                const remise = Math.round(p.total * 0.03);
                totalApresRemise -= remise;
                remiseMsg += `🎁 Remise 3% sur ${p.produit} : -${remise.toLocaleString('fr-FR')} FCFA\n`;
              }
            });

            const count = await pool.query('SELECT COUNT(*) FROM orders');
            const ref = `CMD-${String(parseInt(count.rows[0].count) + 1).padStart(4,'0')}`;

            let reponse = `✅ *${merchant.nom_boutique}* — Commande reçue !\n\n`;
            produits.forEach(p => {
              reponse += `• ${p.quantite} ${p.unite} de ${p.produit}`;
              if (p.total > 0) reponse += ` — ${p.total.toLocaleString('fr-FR')} FCFA`;
              reponse += '\n';
            });
            if (remiseMsg) reponse += `\n${remiseMsg}`;
            if (totalApresRemise !== total) {
              reponse += `💰 *Total après remise : ${totalApresRemise.toLocaleString('fr-FR')} FCFA*`;
            } else if (total > 0) {
              reponse += `💰 *Total : ${total.toLocaleString('fr-FR')} FCFA*`;
            }
            reponse += `\n📋 Référence : ${ref}\n⏳ Confirmation sous peu. Merci ! 🙏`;

            await pool.query('INSERT INTO orders (merchant_id, customer_phone, items, total, status) VALUES ($1, $2, $3, $4, $5)',
              [merchant.id, phone, JSON.stringify(produits), totalApresRemise, 'nouveau']);
            await pool.query(`INSERT INTO clients (merchant_id, phone, total_orders, total_spent) VALUES ($1, $2, 1, $3)
              ON CONFLICT DO NOTHING`,
              [merchant.id, phone, totalApresRemise]);

            await envoyerWhatsApp(phone_id, phone, reponse);

            // Demander adresse de livraison
            const orderResult = await pool.query('SELECT id FROM orders WHERE customer_phone=$1 ORDER BY created_at DESC LIMIT 1', [phone]);
            if (orderResult.rows[0]) {
              pendingAddress[phone] = { orderId: orderResult.rows[0].id, ref, total: totalApresRemise };
              setTimeout(async () => {
                await envoyerWhatsApp(phone_id, phone,
                  `📍 *Adresse de livraison*\n\nOù souhaitez-vous être livré ?\n\n_Exemple : "Quartier Médina, rue 12, près de la mosquée"_`
                );
              }, 2000);
            }

            // Générer lien de paiement PayDunya si total > 0
            if (totalApresRemise > 0) {
              try {
                const paydunyaRes = await fetch('https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_TOKEN,
                    'PAYDUNYA-PUBLIC-KEY': process.env.PAYDUNYA_PUBLIC_KEY,
                    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
                    'PAYDUNYA-MODE': 'test'
                  },
                  body: JSON.stringify({
                    invoice: {
                      total_amount: totalApresRemise,
                      description: `Commande ${ref} — MarchandPro`
                    },
                    store: {
                      name: 'MarchandPro',
                      tagline: 'Votre grossiste digital 🇸🇳',
                      phone: '+221711288439',
                      website_url: 'https://marchandpro-production-b529.up.railway.app'
                    },
                    actions: {
                      cancel_url: 'https://marchandpro-production-b529.up.railway.app',
                      return_url: 'https://marchandpro-production-b529.up.railway.app',
                      callback_url: 'https://marchandpro-production-b529.up.railway.app/api/paydunya/webhook'
                    }
                  })
                });
                const paydunyaData = await paydunyaRes.json();
                console.log('PayDunya:', JSON.stringify(paydunyaData).substring(0, 200));

                if (paydunyaData.response_code === '00' && paydunyaData.response_text) {
                  const lienPaiement = paydunyaData.response_text;
                  await envoyerWhatsApp(phone_id, phone,
                    `💳 *Payez votre commande ${ref}*\n\n` +
                    `Montant : *${totalApresRemise.toLocaleString('fr-FR')} FCFA*\n\n` +
                    `👇 Cliquez ici pour payer via Orange Money ou Wave :\n${lienPaiement}\n\n` +
                    `✅ Votre commande sera confirmée automatiquement après paiement.`
                  );
                }
              } catch(payErr) {
                console.error('PayDunya erreur:', payErr.message);
              }
            }
          } else {
            // Groq répond à tout message non reconnu
            const historique = await pool.query('SELECT COUNT(*) FROM orders WHERE customer_phone=$1 AND merchant_id=$2', [phone, merchant.id]);
            const contexte = `Boutique: ${merchant.nom_boutique}. Ce client a ${historique.rows[0].count} commandes passées.`;
            let reponseIA = null;
            try {
              reponseIA = await demanderGroq(message.text.body, contexte);
            } catch(err) {
              console.error('Groq erreur:', err.message);
            }
            await envoyerWhatsApp(phone_id, phone, reponseIA ||
              `👋 Bienvenue chez *${merchant.nom_boutique}* ! 🇸🇳\n\n1️⃣ *catalogue* — voir nos produits\n2️⃣ *commander* — passer une commande\n3️⃣ *mes commandes* — voir vos commandes`
            );
          }
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/products', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM products ORDER BY name');
  res.json(result.rows);
});

app.post('/api/products', authMiddleware, async (req, res) => {
  try {
    const { name, price, stock, unit } = req.body;
    const result = await pool.query('INSERT INTO products (name, price, stock, unit) VALUES ($1,$2,$3,$4) RETURNING *', [name, price, stock, unit]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', authMiddleware, async (req, res) => {
  const { name, price, stock, unit } = req.body;
  const result = await pool.query('UPDATE products SET name=$1, price=$2, stock=$3, unit=$4 WHERE id=$5 RETURNING *', [name, price, stock, unit, req.params.id]);
  res.json(result.rows[0]);
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.json(result.rows);
});

app.put('/api/orders/:id', async (req, res) => {
  const { status, merchant_id } = req.body;
  // Vérifier que la commande appartient au merchant si merchant_id fourni
  let query = 'UPDATE orders SET status=$1 WHERE id=$2';
  let params = [status, req.params.id];
  if (merchant_id) {
    query += ' AND merchant_id=$3';
    params.push(merchant_id);
  }
  query += ' RETURNING *';
  const result = await pool.query(query, params);
  if (!result.rows[0]) return res.status(404).json({ error: 'Commande introuvable ou accès refusé' });
  const order = result.rows[0];

  // ── NOTIFICATIONS STATUT CLIENT ──
  if (order && order.customer_phone) {
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    const notifs = {
      'confirmé': `🔄 *Votre commande ${order.reference} est confirmée !*\n\nVotre grossiste prépare votre commande. Vous serez livré bientôt. 📦`,
      'en route': `🚚 *Votre commande ${order.reference} est en route !*\n\nVotre livraison est en chemin. Restez disponible. 📍`,
      'livré': null, // Géré par le système d'avis
      'annulé': `❌ *Votre commande ${order.reference} a été annulée.*\n\nPour plus d'informations, contactez votre grossiste. 📞`
    };
    const msg = notifs[status];
    if (msg) {
      setTimeout(async () => {
        try {
          await envoyerWhatsApp(PHONE_NUMBER_ID, order.customer_phone, msg);
        } catch(e) { console.error('Erreur notif statut:', e.message); }
      }, 1000);
    }
  }

  // ── AVIS CLIENT — Envoi automatique quand statut = "livré"
  if (status === 'livré' && order) {
    try {
      const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
      const merchantRes = await pool.query('SELECT * FROM merchants WHERE id=$1', [order.merchant_id]);
      const merchant = merchantRes.rows[0];
      if (merchant && order.customer_phone) {
        // Marquer commande en attente d'avis
        pendingAvis[order.customer_phone] = { orderId: order.id, merchantId: order.merchant_id, ref: order.reference };
        setTimeout(async () => {
          try {
            await envoyerWhatsApp(PHONE_NUMBER_ID, order.customer_phone,
              `✅ *Votre commande ${order.reference} a été livrée !*\n\n` +
              `Merci d'avoir commandé chez *${merchant.nom_boutique}* 🙏\n\n` +
              `⭐ Comment s'est passée votre livraison ?\n\n` +
              `1️⃣ ⭐ Mauvais\n2️⃣ ⭐⭐⭐ Correct\n3️⃣ ⭐⭐⭐⭐⭐ Excellent !`
            );
          } catch(e) { console.error('Erreur envoi demande avis:', e.message); }
        }, 2000);
      }
    } catch(e) { console.error('Erreur avis livraison:', e.message); }
  }

  res.json(order);
});


app.get('/api/clients', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM clients ORDER BY total_orders DESC');
  res.json(result.rows);
});

app.post('/api/invoices', authMiddleware, async (req, res) => {
  try {
    const { order_id, amount } = req.body;
    const count = await pool.query('SELECT COUNT(*) FROM invoices');
    const number = `FAC-2026-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;
    const result = await pool.query('INSERT INTO invoices (order_id, number, amount) VALUES ($1,$2,$3) RETURNING *', [order_id, number, amount]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC');
  res.json(result.rows);
});

app.put('/api/invoices/:id/pay', authMiddleware, async (req, res) => {
  const result = await pool.query('UPDATE invoices SET paid=true WHERE id=$1 RETURNING *', [req.params.id]);
  res.json(result.rows[0]);
});

app.get('/dashboard', async (req, res) => {
  try {
    const commandes = await pool.query('SELECT COUNT(*) FROM orders');
    const revenus = await pool.query("SELECT COALESCE(SUM(CAST(total AS NUMERIC)),0) as total FROM orders");
    const impayes = await pool.query('SELECT COUNT(*) FROM invoices WHERE paid=false');
    const clients = await pool.query('SELECT COUNT(*) FROM clients');
    const recentes = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10');
    const produits_faible = await pool.query('SELECT * FROM products WHERE stock < 5');
    res.json({
      app: 'MarchandPro 🇸🇳',
      kpis: { commandes: parseInt(commandes.rows[0].count), revenus_fcfa: parseFloat(revenus.rows[0].total), impayes: parseInt(impayes.rows[0].count), clients: parseInt(clients.rows[0].count) },
      alertes: { stock_faible: produits_faible.rows },
      commandes_recentes: recentes.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/migrate', async (req, res) => {
  try {
    await pool.query(`ALTER TABLE orders ALTER COLUMN customer_phone TYPE VARCHAR(50)`);
    await pool.query(`ALTER TABLE clients ALTER COLUMN phone TYPE VARCHAR(50)`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_id INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS merchant_id INTEGER DEFAULT 1`);
    await pool.query(`UPDATE orders SET merchant_id=1 WHERE merchant_id IS NULL`);
    await pool.query(`UPDATE clients SET merchant_id=1 WHERE merchant_id IS NULL`);
    res.json({ ok: true, message: 'Migration reussie!' });
  } catch(err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/catalogue', (req, res) => res.json(CATALOGUE));

// ============================================
// GENERER LIEN PAYDUNYA
// ============================================
async function genererLienPaiement(ref, total, phone) {
  try {
    const paydunyaRes = await fetch('https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_TOKEN,
        'PAYDUNYA-PUBLIC-KEY': process.env.PAYDUNYA_PUBLIC_KEY,
        'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
        'PAYDUNYA-MODE': 'test'
      },
      body: JSON.stringify({
        invoice: {
          total_amount: total,
          description: `Commande ${ref} — MarchandPro`
        },
        store: {
          name: 'MarchandPro',
          tagline: 'Votre grossiste digital 🇸🇳',
          phone: '+221711288439',
          website_url: 'https://marchandpro-production-b529.up.railway.app'
        },
        actions: {
          cancel_url: 'https://marchandpro-production-b529.up.railway.app',
          return_url: 'https://marchandpro-production-b529.up.railway.app',
          callback_url: 'https://marchandpro-production-b529.up.railway.app/api/paydunya/webhook'
        },
        custom_data: { ref, phone }
      })
    });
    const data = await paydunyaRes.json();
    console.log('PayDunya response:', JSON.stringify(data).substring(0, 300));
    if (data.response_code === '00') return data.response_text;
    return null;
  } catch(err) {
    console.error('PayDunya erreur:', err.message);
    return null;
  }
}

// ============================================
// GENERER FACTURE HTML
// ============================================
function genererFactureHTML(commande) {
  const ref = `CMD-${String(commande.id).padStart(4,'0')}`;
  const date = new Date(commande.created_at).toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'});
  const items = commande.items || [];
  const total = parseInt(commande.total || 0);

  let lignes = items.filter(i => i.produit && i.produit.length > 1).map(i => `
    <tr>
      <td>${i.produit}</td>
      <td style="text-align:center">${i.quantite} ${i.unite}</td>
      <td style="text-align:right">${(i.prix_unitaire||0).toLocaleString('fr-FR')} FCFA</td>
      <td style="text-align:right"><b>${(i.total||0).toLocaleString('fr-FR')} FCFA</b></td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Facture ${ref} — MarchandPro</title>
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family: Arial, sans-serif; padding: 32px 20px; color: #1a2e1a; max-width: 720px; margin: 0 auto; background:#f5f7f5; }
  .page { background:white; border-radius:16px; padding:40px; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg,#004d26,#006633); color: white; padding: 24px 28px; border-radius: 12px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: center; }
  .logo { font-size: 22px; font-weight: bold; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px; }
  .info-box { background: #f5f7f5; padding: 14px 16px; border-radius: 10px; border-left:3px solid #006633; }
  .info-label { font-size: 11px; color: #5a7a5a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .info-value { font-weight: bold; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #006633; color: white; padding: 10px 14px; text-align: left; font-size: 12px; }
  th:first-child { border-radius:8px 0 0 8px; }
  th:last-child { border-radius:0 8px 8px 0; }
  td { padding: 11px 14px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
  .total-row td { background:#e8f5e9; font-weight:bold; font-size:15px; border:none; padding:14px; }
  .footer { text-align: center; color: #5a7a5a; font-size: 12px; border-top: 2px solid #e8f5e9; padding-top: 16px; margin-top:8px; }
  .badge { display:inline-block; background:#e8f5e9; color:#006633; padding:3px 12px; border-radius:20px; font-size:12px; font-weight:bold; }
  .btn-print { display:block; width:100%; background:#006633; color:white; border:none; padding:14px; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer; margin-top:24px; font-family:inherit; }
  .btn-print:hover { background:#004d26; }
  @media print {
    body { background:white; padding:0; }
    .page { box-shadow:none; border-radius:0; padding:20px; }
    .btn-print { display:none; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="logo">🛒 MarchandPro</div>
      <div style="font-size:12px;opacity:0.7;margin-top:4px">Votre grossiste digital 🇸🇳</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:bold">${ref}</div>
      <div style="font-size:13px;opacity:0.8;margin-top:2px">${date}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-label">Client</div>
      <div class="info-value">+${commande.customer_phone}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Statut</div>
      <div class="info-value"><span class="badge">${commande.status}</span></div>
    </div>
    ${items.adresse_livraison ? `
    <div class="info-box" style="grid-column:1/-1">
      <div class="info-label">📍 Adresse de livraison</div>
      <div class="info-value">${items.adresse_livraison}</div>
    </div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Produit</th>
        <th style="text-align:center">Quantité</th>
        <th style="text-align:right">Prix unitaire</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lignes}
      <tr class="total-row">
        <td colspan="3">TOTAL À PAYER</td>
        <td style="text-align:right">${total.toLocaleString('fr-FR')} FCFA</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p><b>MarchandPro</b> — WhatsApp : +221 71 128 84 39 | Dakar, Sénégal</p>
    <p style="margin-top:4px">Merci pour votre confiance ! 🇸🇳</p>
  </div>

  <button class="btn-print" onclick="window.print()">📥 Télécharger / Imprimer la facture</button>
</div>
</body>
</html>`;
}

// Webhook PayDunya — confirmation de paiement
app.post('/api/paydunya/webhook', async (req, res) => {
  try {
    const data = req.body;
    console.log('PayDunya webhook:', JSON.stringify(data).substring(0, 300));
    if (data.status === 'completed') {
      const description = data.invoice?.description || '';
      const refMatch = description.match(/CMD-(\d+)/i);
      if (refMatch) {
        const cmdId = parseInt(refMatch[1]);
        await pool.query('UPDATE orders SET status=$1 WHERE id=$2', ['payé', cmdId]);
        console.log(`✅ Commande CMD-${String(cmdId).padStart(4,'0')} marquée payée`);
      }
    }
    res.status(200).json({ ok: true });
  } catch(err) {
    console.error('PayDunya webhook erreur:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/test-paiement', async (req, res) => {
  const lien = await genererLienPaiement('CMD-TEST', 5000, '221700000000');
  if (lien) {
    res.json({ ok: true, lien, message: 'Lien PayDunya généré avec succès !' });
  } else {
    res.json({ ok: false, message: 'Erreur PayDunya — vérifiez les clés API' });
  }
});

// Route facture par commande
app.get('/api/facture/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
    const html = genererFactureHTML(result.rows[0]);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'MarchandPro', version: '3.0.0' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/api', (req, res) => res.json({ message: 'Bienvenue sur MarchandPro API 🇸🇳', version: '3.0.0', status: 'running' }));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));
app.get('/sw.js', (req, res) => { res.setHeader('Content-Type','application/javascript'); res.sendFile(path.join(__dirname, 'public', 'sw.js')); });
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// Facture PDF téléchargeable
app.get('/api/facture/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
    const o = result.rows[0];
    const html = genererFactureHTML(o);
    // On renvoie le HTML avec header pour impression/PDF
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="facture-CMD-${String(o.id).padStart(4,'0')}.pdf"`);
    res.send(html + `<script>
      window.onload = function() {
        document.title = 'Facture CMD-${String(o.id).padStart(4,'0')}';
        setTimeout(() => window.print(), 800);
      };
    </script>`);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ONBOARDING MULTI-CLIENTS + PARRAINAGE
// ============================================

function genererCodeParrainage(nom) {
  const base = nom.toUpperCase().replace(/[^A-Z0-9]/g,'').substring(0,6);
  const suffix = Math.random().toString(36).substring(2,5).toUpperCase();
  return base + suffix;
}

// Inscription nouveau grossiste
app.post('/api/merchants/register', async (req, res) => {
  try {
    const { nom_boutique, proprietaire, whatsapp, ville, secteur, produits, ref } = req.body;
    if (!nom_boutique || !whatsapp) return res.status(400).json({ error: 'Nom boutique et WhatsApp requis' });

    const wa = whatsapp.replace(/\D/g, '');
    const secteurKey = secteur || 'alimentaire';
    const catalogue = produits && produits.length > 0 ? produits :
      (SECTEURS[secteurKey]?.catalogue || SECTEURS.alimentaire.catalogue);

    // Code parrainage unique
    let referralCode = genererCodeParrainage(nom_boutique);
    // S'assurer qu'il est unique
    const existing = await pool.query('SELECT id FROM merchants WHERE referral_code=$1', [referralCode]);
    if (existing.rows[0]) referralCode = referralCode + Math.floor(Math.random()*9);

    // Trouver le parrain
    let referralBy = null;
    let parrain = null;
    if (ref) {
      const parrainResult = await pool.query('SELECT * FROM merchants WHERE referral_code=$1', [ref.toUpperCase()]);
      if (parrainResult.rows[0]) { parrain = parrainResult.rows[0]; referralBy = parrain.id; }
    }

    const result = await pool.query(
      `INSERT INTO merchants (nom_boutique, proprietaire, whatsapp, ville, plan, catalogue, referral_code, referral_by)
       VALUES ($1,$2,$3,$4,'gratuit',$5,$6,$7) RETURNING *`,
      [nom_boutique, proprietaire||'', wa, ville||'Dakar', JSON.stringify(catalogue), referralCode, referralBy]
    );

    const merchant = result.rows[0];
    const BASE = 'https://marchandpro-production-b529.up.railway.app';
    console.log(`✅ Nouveau grossiste: ${nom_boutique} (${wa}) — Code parrainage: ${referralCode}`);

    // Message bienvenue avec lien parrainage
    const msgBienvenue =
      `🎉 Bienvenue sur *MarchandPro* ! 🇸🇳\n\n` +
      `Bonjour *${proprietaire || nom_boutique}*\n\n` +
      `✅ Votre boutique *${nom_boutique}* est active !\n\n` +
      `📊 Dashboard : ${BASE}/merchant/${merchant.id}\n` +
      `📦 Catalogue : ${BASE}/catalogue/${merchant.id}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🤝 *Votre lien de parrainage :*\n` +
      `${BASE}/inscription?ref=${referralCode}\n\n` +
      `Partagez ce lien à vos collègues grossistes.\n` +
      `Chaque inscription = *1 mois offert* pour vous ! 🎁\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `Plan actuel : *Gratuit* — 50 commandes/mois\n` +
      `Tapez *UPGRADE* pour passer au plan Pro 🚀`;

    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, wa, msgBienvenue);

    // Notifier et récompenser le parrain
    if (parrain) {
      await pool.query('UPDATE merchants SET mois_offerts = COALESCE(mois_offerts,0) + 1 WHERE id=$1', [parrain.id]);
      const msgParrain =
        `🎉 *Bonne nouvelle ${parrain.proprietaire || parrain.nom_boutique} !*\n\n` +
        `*${nom_boutique}* vient de s'inscrire sur MarchandPro via votre lien ! 🙌\n\n` +
        `🎁 *1 mois gratuit* a été ajouté à votre compte.\n\n` +
        `Continuez à partager votre lien :\n` +
        `${BASE}/inscription?ref=${parrain.referral_code}\n\n` +
        `Merci de faire grandir MarchandPro ! 🇸🇳`;
      await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, parrain.whatsapp, msgParrain);
    }

    res.json({ ok: true, merchant_id: merchant.id, referral_code: referralCode, message: 'Inscription réussie !' });
  } catch (err) {
    if (err.message.includes('unique')) return res.status(400).json({ error: 'Ce numéro WhatsApp est déjà inscrit' });
    res.status(500).json({ error: err.message });
  }
});

// Générer codes parrainage manquants
app.get('/api/admin/generer-codes', adminMiddleware, async (req, res) => {
  try {
    const merchants = await pool.query("SELECT * FROM merchants WHERE referral_code IS NULL OR referral_code = ''");
    let updated = 0;
    for (const m of merchants.rows) {
      const code = genererCodeParrainage(m.nom_boutique);
      await pool.query('UPDATE merchants SET referral_code=$1 WHERE id=$2', [code, m.id]);
      updated++;
    }
    // Retourner tous les codes actuels
    const tous = await pool.query('SELECT id, nom_boutique, referral_code FROM merchants ORDER BY id');
    res.json({ ok: true, message: `${updated} codes générés !`, merchants: tous.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Stats parrainage d'un grossiste
app.get('/api/merchants/:id/parrainage', async (req, res) => {
  try {
    const { id } = req.params;
    const merchant = await pool.query('SELECT * FROM merchants WHERE id=$1', [id]);
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Merchant introuvable' });
    const m = merchant.rows[0];
    const filleuls = await pool.query('SELECT nom_boutique, proprietaire, ville, created_at FROM merchants WHERE referral_by=$1 ORDER BY created_at DESC', [id]);
    res.json({
      ok: true,
      referral_code: m.referral_code,
      lien: `https://marchandpro-production-b529.up.railway.app/inscription?ref=${m.referral_code}`,
      mois_offerts: m.mois_offerts || 0,
      filleuls: filleuls.rows
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Liste tous les grossistes (admin)
app.get('/api/merchants', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, 
        COUNT(o.id) as nb_commandes,
        COALESCE(SUM(CAST(o.total AS NUMERIC)),0) as revenus
      FROM merchants m
      LEFT JOIN orders o ON o.merchant_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Dashboard d'un grossiste spécifique
app.get('/api/merchants/:id/dashboard', async (req, res) => {
  try {
    const { id } = req.params;
    const merchant = await pool.query('SELECT * FROM merchants WHERE id=$1', [id]);
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Grossiste introuvable' });

    const commandes = await pool.query('SELECT COUNT(*) FROM orders WHERE merchant_id=$1', [id]);
    const revenus = await pool.query('SELECT COALESCE(SUM(CAST(total AS NUMERIC)),0) as total FROM orders WHERE merchant_id=$1', [id]);
    const clients = await pool.query('SELECT COUNT(DISTINCT customer_phone) FROM orders WHERE merchant_id=$1', [id]);
    const recentes = await pool.query('SELECT * FROM orders WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 10', [id]);

    res.json({
      merchant: merchant.rows[0],
      kpis: {
        commandes: parseInt(commandes.rows[0].count),
        revenus_fcfa: parseFloat(revenus.rows[0].total),
        clients: parseInt(clients.rows[0].count)
      },
      commandes_recentes: recentes.rows
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Page dashboard d'un grossiste
app.get('/merchant/:id', async (req, res) => {
  const { id } = req.params;
  const merchant = await pool.query('SELECT * FROM merchants WHERE id=$1', [id]).catch(() => null);
  if (!merchant?.rows[0]) return res.status(404).send('Grossiste introuvable');
  const m = merchant.rows[0];
  const BASE = 'https://marchandpro-production-b529.up.railway.app';
  const lienParrainage = m.referral_code ? `${BASE}/inscription?ref=${m.referral_code}` : null;
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${m.nom_boutique} — MarchandPro</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
* { margin:0;padding:0;box-sizing:border-box; }
body { font-family:'DM Sans',sans-serif;background:#f0f4f0;color:#1a2e1a;min-height:100vh; }
.header { background:linear-gradient(135deg,#004d26,#006633);color:white;padding:24px;text-align:center; }
.header h1 { font-size:22px;font-weight:700; }
.header p { font-size:13px;opacity:0.8;margin-top:4px; }
.plan { display:inline-block;background:rgba(255,215,0,0.2);color:#FFD700;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:8px;text-transform:uppercase; }
.container { max-width:700px;margin:0 auto;padding:20px; }
.kpis { display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px; }
.kpi { background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:0 2px 12px rgba(0,102,51,0.08); }
.kpi-num { font-size:24px;font-weight:700;color:#006633; }
.kpi-label { font-size:12px;color:#5a7a5a;margin-top:4px; }
.card { background:white;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,102,51,0.08); }
.card-title { font-weight:700;font-size:15px;margin-bottom:14px;color:#1a2e1a; }
table { width:100%;border-collapse:collapse;font-size:13px; }
th { background:#f0f4f0;padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a7a5a; }
td { padding:10px 8px;border-bottom:1px solid #f5f5f5; }
.badge { display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#fff9e6;color:#cc9900; }
.referral-box { background:#e8f5e9;border:1.5px solid #006633;border-radius:14px;padding:20px;margin-bottom:16px; }
.referral-title { font-weight:700;font-size:16px;color:#006633;margin-bottom:8px; }
.referral-link { font-size:12px;color:#004d26;word-break:break-all;background:white;padding:10px;border-radius:8px;margin:10px 0; }
.btn-copy { background:#006633;color:white;border:none;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;width:100%; }
.mois-badge { display:inline-block;background:#FFD700;color:#1a2e1a;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;margin-left:8px; }
.footer { text-align:center;color:#5a7a5a;font-size:12px;padding:20px; }
</style>
</head>
<body>
<div class="header">
  <h1>🛒 ${m.nom_boutique}</h1>
  <p>${m.ville} — ${m.proprietaire}</p>
  <div class="plan">Plan ${m.plan}</div>
</div>
<div class="container">
  <div class="kpis" id="kpis"><div style="grid-column:1/-1;text-align:center;padding:20px;color:#5a7a5a">Chargement...</div></div>

  ${lienParrainage ? `
  <!-- PARRAINAGE -->
  <div class="referral-box">
    <div class="referral-title">🤝 Votre programme de parrainage
      ${m.mois_offerts > 0 ? `<span class="mois-badge">🎁 ${m.mois_offerts} mois offert${m.mois_offerts>1?'s':''}</span>` : ''}
    </div>
    <p style="font-size:13px;color:#5a7a5a;margin-bottom:8px">Partagez ce lien à vos collègues grossistes. Chaque inscription = <b>1 mois gratuit</b> pour vous !</p>
    <div class="referral-link">${lienParrainage}</div>
    <button class="btn-copy" onclick="copierLien()">📋 Copier le lien de parrainage</button>
    <div id="filleuls-section" style="margin-top:14px"></div>
  </div>
  ` : ''}

  <div class="card">
    <div class="card-title">📦 Liens rapides</div>
    <div style="display:grid;gap:10px">
      <a href="/catalogue/${id}" style="display:block;background:#e8f5e9;color:#006633;padding:12px 16px;border-radius:10px;font-weight:700;text-decoration:none">📦 Mon catalogue client</a>
      <a href="/api/relances" style="display:block;background:#fff9e6;color:#cc9900;padding:12px 16px;border-radius:10px;font-weight:700;text-decoration:none">🔔 Envoyer relances</a>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📋 Commandes récentes</div>
    <div id="commandes">Chargement...</div>
  </div>
</div>
<div class="footer">MarchandPro 🇸🇳 — <a href="/" style="color:#006633">Accueil</a></div>
<script>
const API = 'https://marchandpro-production-b529.up.railway.app';
const LIEN_PARRAINAGE = '${lienParrainage || ""}';

function copierLien() {
  navigator.clipboard.writeText(LIEN_PARRAINAGE).then(() => {
    const btn = document.querySelector('.btn-copy');
    btn.textContent = '✅ Lien copié !';
    setTimeout(() => btn.textContent = '📋 Copier le lien de parrainage', 2000);
  });
}

fetch(API+'/api/merchants/${id}/dashboard').then(r=>r.json()).then(data=>{
  const {kpis,commandes_recentes} = data;
  document.getElementById('kpis').innerHTML = \`
    <div class="kpi"><div class="kpi-num">\${kpis.commandes}</div><div class="kpi-label">Commandes</div></div>
    <div class="kpi"><div class="kpi-num">\${(kpis.revenus_fcfa/1000).toFixed(0)}k</div><div class="kpi-label">FCFA revenus</div></div>
    <div class="kpi"><div class="kpi-num">\${kpis.clients}</div><div class="kpi-label">Clients</div></div>
  \`;
  document.getElementById('commandes').innerHTML = commandes_recentes.length ? \`
    <table>
      <thead><tr><th>Réf.</th><th>Client</th><th>Total</th><th>Statut</th></tr></thead>
      <tbody>\${commandes_recentes.map(c=>\`
        <tr>
          <td>CMD-\${String(c.id).padStart(4,'0')}</td>
          <td>+\${c.customer_phone}</td>
          <td>\${parseInt(c.total).toLocaleString('fr-FR')} FCFA</td>
          <td><span class="badge">\${c.status}</span></td>
        </tr>
      \`).join('')}</tbody>
    </table>
  \` : '<div style="text-align:center;color:#5a7a5a;padding:20px">Aucune commande pour l instant</div>';
}).catch(()=>{document.getElementById('kpis').innerHTML='<div style="grid-column:1/-1;color:red">Erreur chargement</div>';});

// Charger filleuls
fetch(API+'/api/merchants/${id}/parrainage').then(r=>r.json()).then(data=>{
  if(data.filleuls && data.filleuls.length > 0) {
    document.getElementById('filleuls-section').innerHTML = \`
      <div style="font-weight:700;font-size:13px;margin-bottom:8px">👥 Vos filleuls (\${data.filleuls.length}) :</div>
      \${data.filleuls.map(f=>\`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #e8f5e9;font-size:13px">
          <span>🏪 \${f.nom_boutique}</span>
          <span style="color:#5a7a5a">\${new Date(f.created_at).toLocaleDateString('fr-FR')}</span>
        </div>
      \`).join('')}
    \`;
  }
}).catch(()=>{});
</script>
</body>
</html>`);
});

// Mini-site boutique publique
app.get('/boutique/:slug', async (req, res) => {
  const { slug } = req.params;
  // Chercher par nom normalisé ou par id
  const result = await pool.query(`
    SELECT * FROM merchants 
    WHERE actif=true AND (
      LOWER(REPLACE(REPLACE(nom_boutique,' ','-'),'_','-')) = LOWER($1)
      OR id::text = $1
    ) LIMIT 1
  `, [slug]);
  if (!result.rows[0]) return res.status(404).send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#f5f7f5">
    <div style="font-size:60px">🔍</div>
    <h2 style="color:#006633;margin:20px 0">Boutique introuvable</h2>
    <p>Ce lien n'existe pas ou la boutique est inactive.</p>
    <a href="/" style="color:#006633;font-weight:700">← Retour à MarchandPro</a>
    </body></html>
  `);

  const m = result.rows[0];
  const catalogue = Array.isArray(m.catalogue) ? m.catalogue : JSON.parse(m.catalogue || '[]');
  const BASE = 'https://marchandpro-production-b529.up.railway.app';
  const WA = `https://wa.me/221711288439?text=${encodeURIComponent(`Bonjour ${m.nom_boutique} ! Je veux commander.`)}`;

  // Récupérer les avis clients
  const avisRes = await pool.query(
    `SELECT items, customer_phone, created_at FROM orders 
     WHERE merchant_id=$1 AND items->>'note' IS NOT NULL 
     ORDER BY created_at DESC LIMIT 10`,
    [m.id]
  );
  const avisListe = avisRes.rows.map(r => ({
    note: parseInt(r.items?.note || 0),
    avis: r.items?.avis || '',
    phone: (r.customer_phone || '').replace('whatsapp:+','').replace('whatsapp:','').slice(-4),
    date: new Date(r.created_at).toLocaleDateString('fr-FR')
  })).filter(a => a.note > 0);

  const noteMoyenne = avisListe.length > 0
    ? (avisListe.reduce((s, a) => s + a.note, 0) / avisListe.length).toFixed(1)
    : null;

  const SECTEUR_COLORS = {
    alimentaire: '#006633', menagers: '#1565C0', poisson: '#00838F',
    pharmacie: '#AD1457', quincaillerie: '#E65100', telephonie: '#4527A0',
    textile: '#558B2F', cosmetiques: '#880E4F',
    cereales: '#5D4037', viande: '#B71C1C', emballage: '#37474F', boissons: '#0277BD', gaz: '#F57F17'
  };
  const SECTEUR_EMOJIS = {
    alimentaire:'🌾', menagers:'🧴', poisson:'🐟',
    pharmacie:'💊', quincaillerie:'🔧', telephonie:'📱',
    textile:'👗', cosmetiques:'💄',
    cereales:'🌿', viande:'🥩', emballage:'📦', boissons:'🥤', gaz:'⛽'
  };
  const SECTEUR_LABELS = {
    alimentaire:'Alimentaire', menagers:'Ménagers', poisson:'Poisson & Marée',
    pharmacie:'Pharmacie', quincaillerie:'Quincaillerie', telephonie:'Téléphonie',
    textile:'Textile', cosmetiques:'Cosmétiques',
    cereales:'Céréales', viande:'Viande & Volaille', emballage:'Emballage',
    boissons:'Boissons', gaz:'Gaz & Énergie'
  };

  const couleur = SECTEUR_COLORS[m.secteur] || '#006633';
  const emoji = SECTEUR_EMOJIS[m.secteur] || '🛒';
  const secteurLabel = SECTEUR_LABELS[m.secteur] || m.secteur || 'Général';

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${m.nom_boutique} — MarchandPro</title>
<meta property="og:title" content="${m.nom_boutique} — Commandez sur WhatsApp">
<meta property="og:description" content="Commandez facilement chez ${m.nom_boutique} via WhatsApp. Catalogue digital, livraison rapide.">
<meta property="og:image" content="${BASE}/images/og-marchandpro.png">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#f5f7f5;color:#1a2e1a;min-height:100vh}
.header{background:linear-gradient(135deg,${couleur}dd,${couleur});color:white;padding:0 0 40px}
.header-top{display:flex;align-items:center;justify-content:space-between;padding:16px 20px}
.header-logo{font-size:13px;font-weight:700;opacity:0.8}
.header-share{background:rgba(255,255,255,0.2);border:none;color:white;padding:8px 16px;border-radius:50px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.avatar-wrap{text-align:center;padding:24px 20px 0}
.avatar{width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,0.2);border:4px solid rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;font-size:44px;margin:0 auto 16px}
.boutique-nom{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;margin-bottom:6px}
.boutique-meta{font-size:14px;opacity:0.85;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
.meta-badge{background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:50px;font-size:12px;font-weight:600}
.container{max-width:600px;margin:0 auto;padding:20px}
.card{background:white;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 2px 16px rgba(0,0,0,0.06)}
.card-title{font-weight:700;font-size:15px;margin-bottom:16px;color:#1a2e1a;display:flex;align-items:center;gap:8px}
.btn-wa{display:flex;align-items:center;justify-content:center;gap:10px;background:#25D366;color:white;padding:16px 24px;border-radius:14px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:12px;box-shadow:0 4px 20px rgba(37,211,102,0.35)}
.btn-catalogue{display:flex;align-items:center;justify-content:center;gap:8px;background:#e8f5e9;color:${couleur};padding:13px 24px;border-radius:14px;font-size:14px;font-weight:700;text-decoration:none;border:2px solid ${couleur}}
.produit{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f5f5f5}
.produit:last-child{border-bottom:none}
.produit-left{display:flex;align-items:center;gap:12px}
.produit-emoji{font-size:28px}
.produit-nom{font-weight:600;font-size:14px}
.produit-unite{font-size:12px;color:#5a7a5a;margin-top:2px}
.produit-prix{font-weight:800;font-size:15px;color:${couleur};white-space:nowrap}
.info-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f5f5f5;font-size:14px}
.info-row:last-child{border-bottom:none}
.info-icon{font-size:18px;flex-shrink:0;width:28px;text-align:center}
.info-label{color:#5a7a5a;font-size:12px}
.info-val{font-weight:600}
.plan-badge{display:inline-block;padding:4px 12px;border-radius:50px;font-size:11px;font-weight:800;background:#fff9e6;color:#cc9900;border:1px solid #FFD700}
.avis-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.note-globale{display:flex;align-items:center;gap:10px}
.note-num{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:${couleur};line-height:1}
.note-etoiles{font-size:16px;margin-bottom:2px}
.note-count{font-size:12px;color:#5a7a5a}
.avis-item{padding:14px 0;border-bottom:1px solid #f5f5f5}
.avis-item:last-child{border-bottom:none}
.avis-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.avis-etoiles{font-size:14px}
.avis-date{font-size:11px;color:#5a7a5a}
.avis-phone{font-size:12px;color:#5a7a5a;margin-bottom:4px}
.avis-texte{font-size:13px;font-style:italic;color:#1a2e1a}
.avis-vide{text-align:center;padding:24px;color:#5a7a5a;font-size:13px}
.badge-note{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:50px;font-size:12px;font-weight:700}

.qr-label{font-size:13px;color:#5a7a5a;margin-top:12px}
.remise-note{background:#e8f5e9;border-radius:10px;padding:12px 14px;font-size:13px;color:${couleur};font-weight:600;margin-bottom:16px}
.footer-mini{text-align:center;padding:24px 20px;color:#5a7a5a;font-size:12px}
.footer-mini a{color:${couleur};font-weight:700;text-decoration:none}
.powered{display:inline-flex;align-items:center;gap:6px;background:white;border:1px solid #e8f5e9;padding:6px 14px;border-radius:50px;font-size:12px;font-weight:700;color:#006633;text-decoration:none;margin-top:8px}
</style>
</head>
<body>

<div class="header">
  <div class="header-top">
    <div class="header-logo">🛒 MarchandPro</div>
    <button class="header-share" onclick="partager()">📤 Partager</button>
  </div>
  <div class="avatar-wrap">
    <div class="avatar">${emoji}</div>
    <div class="boutique-nom">${m.nom_boutique}</div>
    <div class="boutique-meta">
      <span class="meta-badge">📍 ${m.ville}</span>
      <span class="meta-badge">${emoji} ${secteurLabel}</span>
      <span class="meta-badge">✅ Ouvert</span>
      ${noteMoyenne ? `<span class="meta-badge">⭐ ${noteMoyenne}/5 (${avisListe.length} avis)</span>` : ''}
    </div>
  </div>
</div>

<div class="container">

  <!-- COMMANDER -->
  <div class="card">
    <div class="remise-note">🎁 Remise 3% dès 5 unités · Remise 5% dès 10 unités</div>
    <a href="${WA}" class="btn-wa" target="_blank">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      Commander sur WhatsApp
    </a>
    <a href="${BASE}/catalogue/${m.id}" class="btn-catalogue">📦 Voir le catalogue complet</a>
  </div>

  <!-- INFOS BOUTIQUE -->
  <div class="card">
    <div class="card-title">ℹ️ Infos boutique</div>
    <div class="info-row">
      <div class="info-icon">🏪</div>
      <div><div class="info-label">Boutique</div><div class="info-val">${m.nom_boutique}</div></div>
    </div>
    <div class="info-row">
      <div class="info-icon">👤</div>
      <div><div class="info-label">Propriétaire</div><div class="info-val">${m.proprietaire || 'Non renseigné'}</div></div>
    </div>
    <div class="info-row">
      <div class="info-icon">📍</div>
      <div><div class="info-label">Ville</div><div class="info-val">${m.ville}</div></div>
    </div>
    <div class="info-row">
      <div class="info-icon">📦</div>
      <div><div class="info-label">Secteur</div><div class="info-val">${emoji} ${secteurLabel}</div></div>
    </div>
    <div class="info-row">
      <div class="info-icon">⭐</div>
      <div><div class="info-label">Plan</div><div class="info-val"><span class="plan-badge">${m.plan === 'pro' ? '⭐ Pro' : m.plan === 'starter' ? '🔵 Starter' : '⚪ Gratuit'}</span></div></div>
    </div>
    <div class="info-row">
      <div class="info-icon">🕐</div>
      <div><div class="info-label">Disponibilité bot</div><div class="info-val">24h/24 — 7j/7</div></div>
    </div>
  </div>

  <!-- PRODUITS -->
  ${catalogue.length > 0 ? `
  <div class="card">
    <div class="card-title">📦 Produits disponibles</div>
    ${catalogue.slice(0,6).map(p => {
      const emojis = {'riz':'🌾','huile':'🫙','sucre':'🍚','farine':'🥖','mil':'🌾','tomate':'🥫','savon':'🧼','lait':'🥛','omo':'🧴','javel':'🧹','thiof':'🐟','capitaine':'🐠','sardine':'🐟'};
      const em = Object.entries(emojis).find(([k]) => p.nom.toLowerCase().includes(k))?.[1] || '📦';
      return `<div class="produit">
        <div class="produit-left">
          <span class="produit-emoji">${em}</span>
          <div><div class="produit-nom">${p.nom}</div><div class="produit-unite">${p.unite}</div></div>
        </div>
        <div class="produit-prix">${(p.prix||0).toLocaleString('fr-FR')} F</div>
      </div>`;
    }).join('')}
    ${catalogue.length > 6 ? `<div style="text-align:center;padding:12px 0;font-size:13px;color:#5a7a5a">+ ${catalogue.length-6} autres produits →  <a href="${BASE}/catalogue/${m.id}" style="color:${couleur};font-weight:700">Voir tout</a></div>` : ''}
  </div>` : ''}

  <!-- AVIS CLIENTS -->
  <div class="card">
    <div class="avis-header">
      <div class="b-card-title">⭐ Avis clients</div>
      ${noteMoyenne ? `
      <div class="note-globale">
        <div class="note-num">${noteMoyenne}</div>
        <div>
          <div class="note-etoiles">${'⭐'.repeat(Math.round(parseFloat(noteMoyenne)))}</div>
          <div class="note-count">${avisListe.length} avis</div>
        </div>
      </div>` : ''}
    </div>
    ${avisListe.length === 0 ? `
    <div class="avis-vide">
      <div style="font-size:32px;margin-bottom:8px">💬</div>
      <div>Aucun avis pour l'instant</div>
      <div style="margin-top:4px;font-size:12px">Commandez et partagez votre expérience !</div>
    </div>` :
    avisListe.slice(0,5).map(a => `
    <div class="avis-item">
      <div class="avis-top">
        <div class="avis-etoiles">${'⭐'.repeat(a.note)}</div>
        <div class="avis-date">${a.date}</div>
      </div>
      <div class="avis-phone">Client •••• ${a.phone}</div>
      ${a.avis && !['1','2','3','4','5','oui','non'].includes(a.avis) ? `<div class="avis-texte">"${a.avis}"</div>` : ''}
    </div>`).join('')}
  </div>

  <!-- QR CODE -->
  <div class="card">
    <div class="card-title">📱 Partagez cette boutique</div>
    <div class="qr-wrap">
      <div id="qr-boutique"></div>
      <div class="qr-label">Scannez pour accéder à la boutique</div>
    </div>
  </div>

</div>

<div class="footer-mini">
  <div>Propulsé par</div>
  <a href="/" class="powered">🛒 MarchandPro — La solution des grossistes sénégalais</a>
</div>

<script>
const URL_BOUTIQUE = '${BASE}/boutique/${slug}';

new QRCode(document.getElementById('qr-boutique'), {
  text: URL_BOUTIQUE,
  width: 150, height: 150,
  colorDark: '${couleur}',
  colorLight: '#ffffff',
  correctLevel: QRCode.CorrectLevel.H
});

function partager() {
  if (navigator.share) {
    navigator.share({
      title: '${m.nom_boutique} — Commandez sur WhatsApp',
      text: 'Commandez facilement chez ${m.nom_boutique} via WhatsApp !',
      url: URL_BOUTIQUE
    });
  } else {
    navigator.clipboard.writeText(URL_BOUTIQUE).then(() => {
      alert('Lien copié ! Partagez-le sur WhatsApp 📤');
    });
  }
}
</script>
</body>
</html>`);
});

// Alias /boutique/:slug par nom
app.get('/b/:slug', (req, res) => res.redirect('/boutique/' + req.params.slug));
app.get('/inscription', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inscription — MarchandPro</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
* { margin:0;padding:0;box-sizing:border-box; }
body { font-family:'DM Sans',sans-serif;background:#f0f4f0;color:#1a2e1a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px; }
.card { background:white;border-radius:20px;padding:36px;max-width:480px;width:100%;box-shadow:0 8px 40px rgba(0,102,51,0.12); }
.logo { text-align:center;margin-bottom:28px; }
.logo h1 { font-size:24px;font-weight:700;color:#006633; }
.logo p { font-size:14px;color:#5a7a5a;margin-top:4px; }
label { display:block;font-size:13px;font-weight:600;color:#1a2e1a;margin-bottom:6px;margin-top:16px; }
input, select { width:100%;padding:12px 16px;border:1.5px solid #dde8dd;border-radius:10px;font-size:14px;font-family:inherit;color:#1a2e1a;outline:none;transition:border 0.2s; }
input:focus, select:focus { border-color:#006633; }
.secteurs { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px; }
.secteur-btn { padding:12px 8px;border:2px solid #dde8dd;border-radius:12px;text-align:center;cursor:pointer;transition:all 0.2s;background:white;font-family:inherit;font-size:13px;font-weight:600;color:#5a7a5a; }
.secteur-btn:hover { border-color:#006633;color:#006633; }
.secteur-btn.selected { border-color:#006633;background:#e8f5e9;color:#006633; }
.secteur-emoji { font-size:24px;display:block;margin-bottom:4px; }
.btn { width:100%;background:#006633;color:white;border:none;padding:14px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:24px;font-family:inherit;transition:all 0.2s; }
.btn:hover { background:#004d26; }
.success { background:#e8f5e9;color:#006633;border-radius:10px;padding:16px;text-align:center;margin-top:16px;font-weight:600;display:none; }
.error { background:#fdecea;color:#c0392b;border-radius:10px;padding:16px;text-align:center;margin-top:16px;font-weight:600;display:none; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <h1>🛒 MarchandPro</h1>
    <p>Inscrivez votre boutique — C'est gratuit ! 🇸🇳</p>
  </div>
  <label>Votre secteur d'activité *</label>
  <div class="secteurs">
    <button class="secteur-btn selected" onclick="selSecteur('alimentaire',this)"><span class="secteur-emoji">🌾</span>Alimentaire</button>
    <button class="secteur-btn" onclick="selSecteur('menagers',this)"><span class="secteur-emoji">🧴</span>Ménagers</button>
    <button class="secteur-btn" onclick="selSecteur('poisson',this)"><span class="secteur-emoji">🐟</span>Poisson & Marée</button>
    <button class="secteur-btn" onclick="selSecteur('cosmetiques',this)"><span class="secteur-emoji">💄</span>Cosmétiques</button>
    <button class="secteur-btn" onclick="selSecteur('cereales',this)"><span class="secteur-emoji">🌿</span>Céréales</button>
    <button class="secteur-btn" onclick="selSecteur('viande',this)"><span class="secteur-emoji">🥩</span>Viande & Volaille</button>
    <button class="secteur-btn" onclick="selSecteur('emballage',this)"><span class="secteur-emoji">📦</span>Emballage</button>
    <button class="secteur-btn" onclick="selSecteur('pharmacie',this)"><span class="secteur-emoji">💊</span>Pharmacie</button>
    <button class="secteur-btn" onclick="selSecteur('quincaillerie',this)"><span class="secteur-emoji">🔧</span>Quincaillerie</button>
    <button class="secteur-btn" onclick="selSecteur('telephonie',this)"><span class="secteur-emoji">📱</span>Téléphonie</button>
    <button class="secteur-btn" onclick="selSecteur('boissons',this)"><span class="secteur-emoji">🥤</span>Boissons</button>
    <button class="secteur-btn" onclick="selSecteur('gaz',this)"><span class="secteur-emoji">⛽</span>Gaz & Énergie</button>
    <button class="secteur-btn" onclick="selSecteur('textile',this)" style="grid-column:1/-1"><span class="secteur-emoji">👗</span>Textile</button>
  </div>
  <input type="hidden" id="secteur" value="alimentaire" />
  <label>Nom de votre boutique *</label>
  <input id="nom_boutique" type="text" placeholder="Ex: Boutique Amadou, Pharmacie Fatou..." />
  <label>Votre nom *</label>
  <input id="proprietaire" type="text" placeholder="Ex: Amadou Diallo" />
  <label>Numéro WhatsApp *</label>
  <input id="whatsapp" type="tel" placeholder="Ex: 221771234567" />
  <label>Ville</label>
  <select id="ville">
    <option>Dakar</option><option>Thiès</option><option>Pikine</option>
    <option>Guédiawaye</option><option>Rufisque</option><option>Saint-Louis</option>
    <option>Ziguinchor</option><option>Autre</option>
  </select>
  <button class="btn" onclick="inscrire()">🚀 Créer mon espace gratuit</button>
  <div class="success" id="success"></div>
  <div class="error" id="error"></div>
</div>
<script>
function selSecteur(val, el) {
  document.querySelectorAll('.secteur-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('secteur').value = val;
}
async function inscrire() {
  const nom_boutique = document.getElementById('nom_boutique').value.trim();
  const proprietaire = document.getElementById('proprietaire').value.trim();
  const whatsapp = document.getElementById('whatsapp').value.trim();
  const ville = document.getElementById('ville').value;
  const secteur = document.getElementById('secteur').value;
  const ref = new URLSearchParams(window.location.search).get('ref') || '';
  if (!nom_boutique || !whatsapp) {
    document.getElementById('error').style.display='block';
    document.getElementById('error').textContent='Nom de boutique et WhatsApp sont obligatoires !';
    return;
  }
  document.querySelector('.btn').textContent = '⏳ Inscription en cours...';
  document.querySelector('.btn').disabled = true;
  try {
    const res = await fetch('/api/merchants/register', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nom_boutique,proprietaire,whatsapp,ville,secteur,ref})
    });
    const data = await res.json();
    if (data.ok) {
      const lienParrainage = window.location.origin + '/inscription?ref=' + data.referral_code;
      document.getElementById('success').style.display='block';
      document.getElementById('success').innerHTML =
        '🎉 Inscription réussie !<br>Vous allez recevoir un message WhatsApp de bienvenue.<br><br>' +
        '<a href="/merchant/'+data.merchant_id+'" style="color:#006633;font-weight:700">👉 Mon dashboard</a> &nbsp;|&nbsp; ' +
        '<a href="/catalogue/'+data.merchant_id+'" style="color:#006633;font-weight:700">📦 Mon catalogue</a>' +
        '<br><br><div style="background:#e8f5e9;padding:14px;border-radius:10px;margin-top:8px">' +
        '🤝 <b>Votre lien de parrainage :</b><br>' +
        '<span style="font-size:12px;word-break:break-all;color:#006633">' + lienParrainage + '</span><br>' +
        '<button onclick="navigator.clipboard.writeText(\''+lienParrainage+'\').then(()=>alert(\'Lien copié !\'))" ' +
        'style="margin-top:8px;background:#006633;color:white;border:none;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer">📋 Copier le lien</button>' +
        '</div>';
      document.querySelector('.btn').style.display='none';
    } else { throw new Error(data.error); }
  } catch(err) {
    document.getElementById('error').style.display='block';
    document.getElementById('error').textContent = 'Erreur: ' + err.message;
    document.querySelector('.btn').textContent='🚀 Créer mon espace gratuit';
    document.querySelector('.btn').disabled=false;
  }
}

// Afficher badge parrain si ref dans URL
window.onload = function() {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) {
    const badge = document.createElement('div');
    badge.style.cssText = 'background:#e8f5e9;border:1.5px solid #006633;color:#006633;padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:14px;font-weight:600;text-align:center';
    badge.innerHTML = '🎁 Vous avez été invité(e) par un grossiste MarchandPro !<br><small style="font-weight:400">Inscrivez-vous et bénéficiez d\'un démarrage prioritaire.</small>';
    document.querySelector('.card').insertBefore(badge, document.querySelector('.logo').nextSibling);
  }
};
</script>
</body>
</html>`);
});

// Changer le plan d'un merchant
app.put('/api/merchants/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['gratuit','starter','pro'].includes(plan)) return res.status(400).json({ error: 'Plan invalide' });
    await pool.query('UPDATE merchants SET plan=$1 WHERE id=$2', [plan, req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/merchants/:id/secteur', async (req, res) => {
  try {
    const { secteur } = req.body;
    const secteurs = ['alimentaire','menagers','poisson','pharmacie','quincaillerie','telephonie','textile','cosmetiques','cereales','viande','emballage','boissons','gaz'];
    if (!secteurs.includes(secteur)) return res.status(400).json({ error: 'Secteur invalide' });
    await pool.query('UPDATE merchants SET secteur=$1 WHERE id=$2', [secteur, req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Activer/désactiver un merchant
app.put('/api/merchants/:id/toggle', async (req, res) => {
  try {
    await pool.query('UPDATE merchants SET actif = NOT actif WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Hub de navigation
app.get('/hub', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hub.html')));

// Page QR codes
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));

// ============================================
// TABLEAU LIVREUR
// ============================================
app.get('/livreur/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const merchantRes = await pool.query('SELECT * FROM merchants WHERE id=$1', [merchant_id]);
    if (!merchantRes.rows[0]) return res.status(404).send('Boutique introuvable');
    const m = merchantRes.rows[0];

    const ordersRes = await pool.query(
      `SELECT * FROM orders WHERE merchant_id=$1 AND status IN ('confirmé','en route') ORDER BY created_at DESC`,
      [merchant_id]
    );
    const orders = ordersRes.rows;

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Livraisons — ${m.nom_boutique}</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@800&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#f4f6f4;min-height:100vh}
.header{background:linear-gradient(135deg,#004d26,#006633);color:white;padding:16px 20px;position:sticky;top:0;z-index:100}
.header h1{font-family:'Syne',sans-serif;font-size:18px;font-weight:800}
.header p{font-size:12px;opacity:0.8;margin-top:2px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}
.stat{background:white;border-radius:12px;padding:14px;text-align:center;border-left:4px solid #006633}
.stat-val{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#006633}
.stat-label{font-size:12px;color:#5a7a5a;margin-top:2px}
.section-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;padding:0 16px 10px;color:#0d1f0d}
.cmd-card{background:white;margin:0 16px 12px;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)}
.cmd-header{padding:14px 16px;border-bottom:1px solid #f5f5f5;display:flex;align-items:center;justify-content:space-between}
.cmd-ref{font-weight:800;font-size:14px;color:#006633}
.cmd-badge{padding:4px 10px;border-radius:50px;font-size:11px;font-weight:700}
.badge-confirme{background:#e3f2fd;color:#1565C0}
.badge-route{background:#fff9e6;color:#cc9900}
.cmd-body{padding:14px 16px}
.cmd-client{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.cmd-phone{font-weight:700;font-size:14px}
.cmd-adresse{background:#f4f6f4;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:12px;line-height:1.5}
.cmd-produits{font-size:12px;color:#5a7a5a;margin-bottom:14px;line-height:1.6}
.cmd-total{font-weight:800;font-size:16px;color:#006633;margin-bottom:14px}
.btn-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.btn{border:none;padding:12px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.2s}
.btn-livrer{background:#006633;color:white}
.btn-livrer:active{background:#004d26}
.btn-appeler{background:#25D366;color:white}
.btn-itineraire{background:#1565C0;color:white}
.btn-probleme{background:#fce4ec;color:#c0392b}
.empty{text-align:center;padding:60px 20px;color:#5a7a5a}
.empty-icon{font-size:48px;margin-bottom:12px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#006633;color:white;padding:12px 24px;border-radius:50px;font-weight:700;font-size:14px;z-index:999;opacity:0;transition:opacity 0.3s;white-space:nowrap}
.toast.show{opacity:1}
</style>
</head>
<body>

<div class="header">
  <h1>🚚 Livraisons du jour</h1>
  <p>${m.nom_boutique} · ${new Date().toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long'})}</p>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-val">${orders.length}</div>
    <div class="stat-label">📦 À livrer</div>
  </div>
  <div class="stat">
    <div class="stat-val">${orders.filter(o=>o.status==='en route').length}</div>
    <div class="stat-label">🚚 En route</div>
  </div>
</div>

<div class="section-title">📋 Commandes à livrer</div>

${orders.length === 0 ? `
<div class="empty">
  <div class="empty-icon">✅</div>
  <div style="font-weight:800;font-size:16px;margin-bottom:8px">Toutes les livraisons sont faites !</div>
  <div style="font-size:13px">Aucune commande en attente.</div>
</div>` :
orders.map(o => {
  const items = Array.isArray(o.items) ? o.items.filter(i => i.produit && i.produit.length > 2) : [];
  const produitsStr = items.map(i => `${i.quantite}x ${i.produit}`).join(' · ') || '—';
  const adresse = o.delivery_address || o.items?.find?.(i => i.adresse)?.adresse || 'Adresse non renseignée';
  const phone = (o.customer_phone||'').replace('whatsapp:+','+').replace('whatsapp:','');
  const phoneWa = phone.replace('+','');
  const badge = o.status === 'en route' ? '<span class="cmd-badge badge-route">🚚 En route</span>' : '<span class="cmd-badge badge-confirme">✅ Confirmé</span>';
  return `
<div class="cmd-card" id="card-${o.id}">
  <div class="cmd-header">
    <span class="cmd-ref">${o.reference || 'CMD-' + String(o.id).padStart(4,'0')}</span>
    ${badge}
  </div>
  <div class="cmd-body">
    <div class="cmd-client">
      <span style="font-size:20px">👤</span>
      <span class="cmd-phone">${phone}</span>
    </div>
    <div class="cmd-adresse">📍 ${adresse}</div>
    <div class="cmd-produits">📦 ${produitsStr}</div>
    <div class="cmd-total">💰 ${Number(o.total||0).toLocaleString('fr-FR')} FCFA</div>
    <div class="btn-row">
      <button class="btn btn-livrer" onclick="marquerLivre(${o.id}, this)">✅ Livré</button>
      <a href="https://wa.me/${phoneWa}" class="btn btn-appeler" style="text-decoration:none;display:flex;align-items:center;justify-content:center">📲 Appeler</a>
    </div>
    <div style="margin-top:8px">
      <a href="https://www.google.com/maps/search/${encodeURIComponent(adresse + ', Dakar, Sénégal')}" target="_blank" class="btn btn-itineraire" style="display:block;text-decoration:none;text-align:center;padding:10px">🗺️ Itinéraire Google Maps</a>
    </div>
  </div>
</div>`;
}).join('')}

<div style="height:30px"></div>
<div class="toast" id="toast"></div>

<script>
const MERCHANT_ID = ${merchant_id};

async function marquerLivre(orderId, btn) {
  btn.disabled = true;
  btn.textContent = '⏳ En cours...';
  try {
    const r = await fetch('/api/livreur/livrer/' + orderId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_id: MERCHANT_ID })
    });
    if (r.ok) {
      toast('✅ Livraison confirmée !');
      const card = document.getElementById('card-' + orderId);
      card.style.opacity = '0.4';
      card.style.transition = 'opacity 0.5s';
      setTimeout(() => card.remove(), 600);
    } else {
      btn.disabled = false;
      btn.textContent = '✅ Livré';
      toast('❌ Erreur — réessaye');
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '✅ Livré';
    toast('❌ Erreur réseau');
  }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
</script>
</body>
</html>`);
  } catch(e) {
    console.error('Erreur livreur:', e);
    res.status(500).send('Erreur serveur');
  }
});

// Catalogue Pro — page partageable par grossiste
app.get('/catalogue/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'catalogue.html')));

// Page admin
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
async function envoyerRelances() {
  try {
    console.log('🔔 Vérification des relances impayés...');

    // Commandes impayées avec total > 0, en nettoyant le préfixe whatsapp:
    const result = await pool.query(`
      SELECT o.id, 
        REPLACE(REPLACE(o.customer_phone, 'whatsapp:+', ''), 'whatsapp:', '') as customer_phone,
        o.total, o.created_at, o.merchant_id,
        m.nom_boutique,
        EXTRACT(EPOCH FROM (NOW() - o.created_at))/86400 as jours
      FROM orders o
      JOIN merchants m ON m.id = o.merchant_id
      WHERE o.status = 'nouveau'
      AND CAST(o.total AS NUMERIC) > 0
      AND o.created_at < NOW() - INTERVAL '1 day'
      ORDER BY o.created_at ASC
    `);

    console.log(`📊 ${result.rows.length} commande(s) impayée(s)`);
    let envoyes = 0;

    for (const cmd of result.rows) {
      const jours = Math.floor(cmd.jours);
      const ref = `CMD-${String(cmd.id).padStart(4,'0')}`;
      const montant = parseInt(cmd.total).toLocaleString('fr-FR');
      let message = '';

      if (jours >= 1 && jours < 3) {
        message =
          `👋 Bonjour !\n\n` +
          `Votre commande *${ref}* d'un montant de *${montant} FCFA* est en attente de paiement.\n\n` +
          `Réglez facilement via *Orange Money* ou *Wave* 📱\n\n` +
          `Une question ? Répondez à ce message.\n\n` +
          `_MarchandPro 🇸🇳_`;
      } else if (jours >= 3 && jours < 7) {
        message =
          `🔔 *Rappel de paiement*\n\n` +
          `Commande *${ref}* — *${montant} FCFA*\n` +
          `En attente depuis *${jours} jours*.\n\n` +
          `Merci de régulariser votre situation dans les plus brefs délais.\n\n` +
          `Contactez-nous : +221 71 128 84 39\n\n` +
          `_MarchandPro 🇸🇳_`;
      } else if (jours >= 7) {
        message =
          `⚠️ *Dernier rappel — ${ref}*\n\n` +
          `Montant dû : *${montant} FCFA*\n` +
          `Impayé depuis *${jours} jours*.\n\n` +
          `Sans retour de votre part, votre accès au service sera suspendu.\n\n` +
          `Réglez maintenant ou appelez le *+221 71 128 84 39*\n\n` +
          `_MarchandPro 🇸🇳_`;
      }

      if (message) {
        await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, cmd.customer_phone, message);
        console.log(`✅ Relance J+${jours} → +${cmd.customer_phone} — ${ref} — ${montant} FCFA`);
        envoyes++;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Clients inactifs depuis 7 à 30 jours
    const inactifs = await pool.query(`
      SELECT DISTINCT
        REPLACE(REPLACE(customer_phone, 'whatsapp:+', ''), 'whatsapp:', '') as customer_phone,
        MAX(created_at) as derniere_commande
      FROM orders
      GROUP BY customer_phone
      HAVING MAX(created_at) < NOW() - INTERVAL '7 days'
        AND MAX(created_at) > NOW() - INTERVAL '30 days'
    `);

    for (const client of inactifs.rows) {
      const jours = Math.floor((Date.now() - new Date(client.derniere_commande)) / 86400000);
      const message =
        `👋 Bonjour ! Ici *MarchandPro* 🇸🇳\n\n` +
        `Votre dernière commande date de *${jours} jours*.\n\n` +
        `🎁 Revenez commander aujourd'hui :\n` +
        `• Remise *3%* dès 5 unités\n` +
        `• Remise *5%* dès 10 unités\n\n` +
        `Répondez *catalogue* pour voir nos produits 🛒`;

      await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, client.customer_phone, message);
      console.log(`✅ Relance inactif → +${client.customer_phone} (${jours}j)`);
      envoyes++;
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`✅ ${envoyes} relance(s) envoyée(s)`);
    return envoyes;
  } catch (err) {
    console.error('❌ Erreur relances:', err.message);
    return 0;
  }
}

// Route manuelle pour déclencher les relances
app.get('/api/relances', async (req, res) => {
  const envoyes = await envoyerRelances();
  res.json({ ok: true, message: `${envoyes} relance(s) envoyée(s) !` });
});

// ============================================
// BILAN MENSUEL PDF
// ============================================
app.get('/api/bilan/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { mois, annee } = req.query;
    const now = new Date();
    const m = parseInt(mois) || now.getMonth() + 1;
    const a = parseInt(annee) || now.getFullYear();
    const debut = new Date(a, m - 1, 1);
    const fin = new Date(a, m, 0, 23, 59, 59);

    const merchantRes = await pool.query('SELECT * FROM merchants WHERE id=$1', [merchant_id]);
    if (!merchantRes.rows[0]) return res.status(404).json({ error: 'Merchant introuvable' });
    const merchant = merchantRes.rows[0];

    const ordersRes = await pool.query(
      `SELECT * FROM orders WHERE merchant_id=$1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at DESC`,
      [merchant_id, debut, fin]
    );
    const orders = ordersRes.rows;

    const totalRevenu = orders.filter(o => Number(o.total) > 0).reduce((s, o) => s + Number(o.total || 0), 0);
    const nbCommandes = orders.filter(o => Number(o.total) > 0).length;
    const clients = new Set(orders.map(o => o.customer_phone).filter(Boolean)).size;
    const nbLivres = orders.filter(o => o.status === 'livré').length;
    const nbNouveaux = orders.filter(o => o.status === 'nouveau').length;
    const nbAnnules = orders.filter(o => o.status === 'annulé').length;

    const moisNoms = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bilan ${moisNoms[m]} ${a} — ${merchant.nom_boutique}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'DM Sans',Arial,sans-serif;color:#0d1f0d;background:white;padding:40px 32px}
  .header{background:linear-gradient(135deg,#004d26,#006633);color:white;border-radius:16px;padding:32px;margin-bottom:32px;display:flex;align-items:center;justify-content:space-between}
  .header-left h1{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;margin-bottom:4px}
  .header-left p{opacity:0.8;font-size:14px}
  .header-right{text-align:right}
  .header-right .periode{font-size:20px;font-weight:800;color:#FFD700}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px}
  .kpi{background:#f4f6f4;border-radius:12px;padding:20px;border-left:4px solid #006633}
  .kpi-val{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;color:#006633}
  .kpi-label{font-size:13px;color:#5a7a5a;margin-top:4px}
  .kpi.or{border-left-color:#FFD700}
  .kpi.or .kpi-val{color:#cc9900}
  table{width:100%;border-collapse:collapse;margin-bottom:32px}
  th{background:#006633;color:white;padding:12px 14px;font-size:13px;text-align:left;font-weight:700}
  td{padding:10px 14px;font-size:13px;border-bottom:1px solid #e8f5e9}
  tr:nth-child(even){background:#f9fdf9}
  .badge{display:inline-block;padding:3px 10px;border-radius:50px;font-size:11px;font-weight:700}
  .badge-livr{background:#e8f5e9;color:#006633}
  .badge-new{background:#e3f2fd;color:#1565C0}
  .badge-ann{background:#fce4ec;color:#c0392b}
  .badge-autre{background:#fff9e6;color:#cc9900}
  .footer{text-align:center;color:#5a7a5a;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #e8f5e9}
  .section-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;margin-bottom:16px;color:#006633}
  @media print{body{padding:20px}button{display:none}}
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <h1>🛒 ${merchant.nom_boutique}</h1>
    <p>Bilan mensuel · MarchandPro 🇸🇳</p>
  </div>
  <div class="header-right">
    <div class="periode">${moisNoms[m]} ${a}</div>
    <div style="font-size:13px;opacity:0.8;margin-top:4px">Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
  </div>
</div>

<div class="kpis">
  <div class="kpi or">
    <div class="kpi-val">${totalRevenu.toLocaleString('fr-FR')} F</div>
    <div class="kpi-label">💰 Revenus du mois</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${nbCommandes}</div>
    <div class="kpi-label">📋 Commandes totales</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${clients}</div>
    <div class="kpi-label">👥 Clients actifs</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${nbLivres}</div>
    <div class="kpi-label">✅ Commandes livrées</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${nbNouveaux}</div>
    <div class="kpi-label">⏳ En attente</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${nbAnnules}</div>
    <div class="kpi-label">❌ Annulées</div>
  </div>
</div>

<div class="section-title">📋 Détail des commandes</div>
<table>
  <thead>
    <tr><th>Référence</th><th>Client</th><th>Produits</th><th>Total</th><th>Statut</th><th>Date</th></tr>
  </thead>
  <tbody>
    ${orders.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:#5a7a5a">Aucune commande ce mois</td></tr>' :
      orders.map(o => {
        const phoneClean = (o.customer_phone || '—').replace('whatsapp:+', '+').replace('whatsapp:', '');
        const items = Array.isArray(o.items) ? o.items : [];
        const produitsStr = items.filter(i => i.produit && i.produit.length > 2).map(i => `${i.quantite}x ${i.produit}`).join(', ') || '—';
        const badgeClass = o.status === 'livré' ? 'badge-livr' : o.status === 'annulé' ? 'badge-ann' : o.status === 'nouveau' ? 'badge-new' : 'badge-autre';
        const totalVal = Number(o.total || 0);
        return `<tr>
          <td><b>${o.reference || 'CMD-' + String(o.id).padStart(4,'0')}</b></td>
          <td>${phoneClean}</td>
          <td style="max-width:200px">${produitsStr}</td>
          <td><b>${totalVal > 0 ? totalVal.toLocaleString('fr-FR') + ' F' : '<span style="color:#999">—</span>'}</b></td>
          <td><span class="badge ${badgeClass}">${o.status?.toUpperCase()}</span></td>
          <td>${new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
        </tr>`;
      }).join('')
    }
  </tbody>
</table>

<div class="footer">
  <p>🛒 MarchandPro · La solution digitale pour les grossistes sénégalais 🇸🇳</p>
  <p style="margin-top:4px">marchandpro-production-b529.up.railway.app · +221 71 128 84 39</p>
</div>

<div style="text-align:center;margin-top:24px">
  <button onclick="window.print()" style="background:#006633;color:white;border:none;padding:14px 32px;border-radius:50px;font-size:15px;font-weight:800;cursor:pointer">🖨️ Imprimer / Sauvegarder en PDF</button>
</div>
</body>
</html>`;

    res.send(html);
  } catch(e) {
    console.error('Erreur bilan:', e);
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/promo', authMiddleware, async (req, res) => {
  try {
    const { merchant_id, message, produit, remise } = req.body;
    if (!merchant_id || !message) return res.status(400).json({ error: 'merchant_id et message requis' });

    // Récupérer le merchant
    const merchantRes = await pool.query('SELECT * FROM merchants WHERE id=$1 AND actif=true', [merchant_id]);
    if (!merchantRes.rows[0]) return res.status(404).json({ error: 'Merchant introuvable' });
    const merchant = merchantRes.rows[0];

    // Récupérer tous les clients uniques du merchant
    const clientsRes = await pool.query(
      `SELECT DISTINCT customer_phone FROM orders WHERE merchant_id=$1 AND customer_phone IS NOT NULL`,
      [merchant_id]
    );
    const clients = clientsRes.rows.map(r => r.customer_phone);

    if (clients.length === 0) return res.json({ ok: true, envoyes: 0, message: 'Aucun client à contacter' });

    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    const catalogueUrl = `https://marchandpro-production-b529.up.railway.app/catalogue/${merchant_id}`;

    // Construire le message promo
    const remiseText = remise ? `\n🎁 *Remise spéciale : -${remise}%* aujourd'hui seulement !` : '';
    const produitText = produit ? `\n📦 Produit : *${produit}*` : '';
    const promoMsg =
      `🏷️ *PROMOTION FLASH chez ${merchant.nom_boutique}* 🇸🇳\n\n` +
      `${message}${produitText}${remiseText}\n\n` +
      `⏰ Offre limitée — commandez maintenant !\n\n` +
      `👉 Voir le catalogue : ${catalogueUrl}\n` +
      `💬 Ou tapez *commander* pour passer votre commande directement`;

    // Envoyer à tous les clients
    let envoyes = 0;
    for (const phone of clients) {
      try {
        await envoyerWhatsApp(PHONE_NUMBER_ID, phone, promoMsg);
        envoyes++;
        // Pause entre envois pour éviter le spam Meta
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        console.error(`Erreur promo client ${phone}:`, e.message);
      }
    }

    console.log(`📣 Promo envoyée à ${envoyes}/${clients.length} clients de ${merchant.nom_boutique}`);
    res.json({
      ok: true,
      envoyes,
      total_clients: clients.length,
      message: `Promotion envoyée à ${envoyes} client(s) !`
    });
  } catch(e) {
    console.error('Erreur promo:', e);
    res.status(500).json({ error: e.message });
  }
});



// Lancer les relances tous les jours à 9h du matin
function planifierRelances() {
  const maintenant = new Date();
  const prochaine9h = new Date();
  prochaine9h.setHours(9, 0, 0, 0);
  if (prochaine9h <= maintenant) prochaine9h.setDate(prochaine9h.getDate() + 1);
  const delai = prochaine9h - maintenant;
  console.log(`⏰ Prochaines relances dans ${Math.round(delai/1000/60)} minutes`);
  setTimeout(() => {
    envoyerRelances();
    setInterval(envoyerRelances, 24 * 60 * 60 * 1000);
  }, delai);
}

// ============================================
// CARTE DES GROSSISTES
// ============================================
// ============================================
// CARTE DES GROSSISTES
// ============================================
// Route admin — corriger noms produits merchant #1
app.get('/api/admin/fix-produits', adminMiddleware, async (req, res) => {
  try {
    await pool.query(`
      UPDATE merchants SET catalogue = '[
        {"nom":"Riz brisé","unite":"sac 50kg","prix":22000,"mots":["riz"]},
        {"nom":"Huile végétale","unite":"bidon 20L","prix":25000,"mots":["huile"]},
        {"nom":"Sucre","unite":"sac 50kg","prix":30000,"mots":["sucre"]},
        {"nom":"Farine","unite":"sac 50kg","prix":20000,"mots":["farine"]},
        {"nom":"Mil","unite":"sac 50kg","prix":18000,"mots":["mil"]},
        {"nom":"Tomate concentrée","unite":"carton","prix":15000,"mots":["tomate"]},
        {"nom":"Savon","unite":"carton","prix":12000,"mots":["savon"]},
        {"nom":"Lait en poudre","unite":"boite 2.5kg","prix":8500,"mots":["lait"]}
      ]'::jsonb WHERE id = 1
    `);
    res.json({ ok: true, message: 'Produits corrigés !' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/livreur/livrer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant_id } = req.body;
    const result = await pool.query(
      'UPDATE orders SET status=$1 WHERE id=$2 AND merchant_id=$3 RETURNING *',
      ['livré', id, merchant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
    const order = result.rows[0];
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    if (order.customer_phone) {
      try {
        await envoyerWhatsApp(PHONE_NUMBER_ID, order.customer_phone,
          `📦 *Votre commande ${order.reference} a été livrée !*\n\nMerci pour votre confiance 🙏\n\n⭐ Comment s'est passée votre livraison ?\n1️⃣ Mauvais  2️⃣ Correct  3️⃣ Excellent`
        );
        pendingAvis[order.customer_phone] = { orderId: order.id, merchantId: order.merchant_id, ref: order.reference };
      } catch(e) { console.error('Erreur notif livreur:', e.message); }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/carte', (req, res) => res.sendFile(path.join(__dirname, 'public', 'carte.html')));

app.get('/api/merchants-public', async (req, res) => {
  try {
    // Découvrir les vraies colonnes
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='merchants' ORDER BY ordinal_position
    `);
    const colNames = cols.rows.map(r => r.column_name);
    console.log('Colonnes merchants:', colNames);
    
    const hasSecteur = colNames.includes('secteur');
    const hasTypeCommerce = colNames.includes('type_commerce');
    const hasVille = colNames.includes('ville');
    
    const secteurExpr = hasSecteur ? 'secteur' : hasTypeCommerce ? 'type_commerce as secteur' : "'alimentaire' as secteur";
    const villeExpr = hasVille ? 'ville' : "'Dakar' as ville";
    
    const data = await pool.query(`SELECT id, nom_boutique, ${villeExpr}, ${secteurExpr} FROM merchants ORDER BY id`);
    const rows = data.rows.map(m => ({
      ...m,
      secteur: m.secteur || 'alimentaire',
      ville: m.ville || 'Dakar'
    }));
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ============================================
// RAPPORT HEBDO WHATSAPP — Chaque lundi 9h
// ============================================
async function envoyerRapportHebdo() {
  try {
    console.log('📊 Envoi rapports hebdo WhatsApp...');
    const merchants = await pool.query(`SELECT * FROM merchants`);
    const maintenant = new Date();
    const lundiDernier = new Date(maintenant);
    lundiDernier.setDate(maintenant.getDate() - 7);

    for (const m of merchants.rows) {
      try {
        const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
        const phone = m.whatsapp_number || m.phone;
        if (!phone) continue;

        const stats = await pool.query(`
          SELECT COUNT(*) as total_commandes,
            COALESCE(SUM(total), 0) as revenus,
            COUNT(DISTINCT customer_phone) as clients_actifs
          FROM orders WHERE merchant_id = $1 AND created_at >= $2
        `, [m.id, lundiDernier]);

        const s = stats.rows[0];
        const totalCmds = parseInt(s.total_commandes) || 0;
        const revenus = parseInt(s.revenus) || 0;
        const clients = parseInt(s.clients_actifs) || 0;

        const produitStar = await pool.query(`
          SELECT elem->>'produit' as produit, SUM((elem->>'quantite')::int) as total_qte
          FROM orders, jsonb_array_elements(items) as elem
          WHERE merchant_id = $1 AND created_at >= $2
          AND elem->>'produit' IS NOT NULL AND length(elem->>'produit') > 2
          GROUP BY elem->>'produit' ORDER BY total_qte DESC LIMIT 1
        `, [m.id, lundiDernier]);

        const star = produitStar.rows[0];
        const starText = star ? `⭐ Produit star : *${star.produit}* (${star.total_qte}x)` : '';

        const semPrec = await pool.query(`
          SELECT COUNT(*) as total FROM orders WHERE merchant_id = $1
          AND created_at >= $2 AND created_at < $3
        `, [m.id, new Date(maintenant.getTime() - 14*24*60*60*1000), lundiDernier]);

        const cmdsPrecedentes = parseInt(semPrec.rows[0].total) || 0;
        let tendance = totalCmds > cmdsPrecedentes ? `📈 +${totalCmds - cmdsPrecedentes} vs semaine dernière`
          : totalCmds < cmdsPrecedentes ? `📉 -${cmdsPrecedentes - totalCmds} vs semaine dernière`
          : `➡️ Stable vs semaine dernière`;

        const dateDebut = lundiDernier.toLocaleDateString('fr-FR', {day:'numeric', month:'long'});
        const dateFin = maintenant.toLocaleDateString('fr-FR', {day:'numeric', month:'long'});

        const message = `📊 *Bilan semaine — ${m.nom_boutique}*\n🗓️ Du ${dateDebut} au ${dateFin}\n\n━━━━━━━━━━━━━━━\n📋 Commandes : *${totalCmds}*\n💰 Revenus : *${revenus.toLocaleString('fr-FR')} FCFA*\n👥 Clients actifs : *${clients}*\n${starText}\n━━━━━━━━━━━━━━━\n${tendance}\n\n🔗 Dashboard :\nhttps://marchandpro-production-b529.up.railway.app/app\n\nBonne semaine ! 💪🇸🇳\n— *MarchandPro*`;

        await envoyerWhatsApp(PHONE_NUMBER_ID, phone, message);
        console.log(`✅ Rapport hebdo envoyé à ${m.nom_boutique}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch(e) { console.error(`❌ Erreur rapport ${m.nom_boutique}:`, e.message); }
    }
    console.log('📊 Rapports hebdo terminés');
  } catch(e) { console.error('❌ Erreur rapport hebdo:', e.message); }
}

function planifierRapportHebdo() {
  const now = new Date();
  const lundi = new Date(now);
  const jour = now.getDay();
  const joursAvantLundi = jour === 0 ? 1 : jour === 1 && now.getHours() < 9 ? 0 : 8 - (jour === 0 ? 7 : jour);
  lundi.setDate(now.getDate() + joursAvantLundi);
  lundi.setHours(9, 0, 0, 0);
  const delai = lundi - now;
  console.log(`📊 Prochain rapport hebdo dans ${Math.round(delai/1000/60/60)}h`);
  setTimeout(() => {
    envoyerRapportHebdo();
    setInterval(envoyerRapportHebdo, 7 * 24 * 60 * 60 * 1000);
  }, delai);
}


// Route test manuel rapport hebdo
app.get('/api/rapport-hebdo', adminMiddleware, async (req, res) => {
  try {
    await envoyerRapportHebdo();
    res.json({ ok: true, message: 'Rapports hebdo envoyés !' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// SÉCURITÉ — LOGIN MERCHANT PAR PIN
// ============================================

// Vérifier PIN merchant
app.post('/api/merchant/login', async (req, res) => {
  try {
    const { merchant_id, pin } = req.body;
    if (!merchant_id || !pin) return res.status(400).json({ error: 'merchant_id et pin requis' });
    const result = await pool.query('SELECT id, nom_boutique, pin, plan FROM merchants WHERE id=$1', [merchant_id]);
    const m = result.rows[0];
    if (!m) return res.status(404).json({ error: 'Merchant introuvable' });
    // Si pas de PIN configuré → accepter n'importe quel PIN (premier accès)
    if (!m.pin) {
      return res.json({ ok: true, merchant_id: m.id, nom: m.nom_boutique, plan: m.plan, first_login: true });
    }
    if (m.pin !== pin) return res.status(401).json({ error: 'PIN incorrect' });
    res.json({ ok: true, merchant_id: m.id, nom: m.nom_boutique, plan: m.plan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Définir/changer PIN merchant
app.post('/api/merchant/set-pin', async (req, res) => {
  try {
    const { merchant_id, pin_actuel, nouveau_pin } = req.body;
    if (!merchant_id || !nouveau_pin) return res.status(400).json({ error: 'Données manquantes' });
    if (nouveau_pin.length !== 4 || !/^\d+$/.test(nouveau_pin)) {
      return res.status(400).json({ error: 'PIN doit être 4 chiffres' });
    }
    const result = await pool.query('SELECT pin FROM merchants WHERE id=$1', [merchant_id]);
    const m = result.rows[0];
    if (!m) return res.status(404).json({ error: 'Merchant introuvable' });
    // Si PIN déjà défini → vérifier l'ancien
    if (m.pin && m.pin !== pin_actuel) {
      return res.status(401).json({ error: 'PIN actuel incorrect' });
    }
    await pool.query('UPDATE merchants SET pin=$1 WHERE id=$2', [nouveau_pin, merchant_id]);
    res.json({ ok: true, message: 'PIN mis à jour !' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

initDB().then(() => {
  app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 MarchandPro v3.1 démarré sur port ' + (process.env.PORT || 3000));
    planifierRelances();
    planifierRapportHebdo();
  });
}).catch(err => console.error('Erreur démarrage:', err));
