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
      created_at TIMESTAMP DEFAULT NOW()
    );
    INSERT INTO merchants (id, nom_boutique, proprietaire, whatsapp, ville, plan, catalogue)
    VALUES (1, 'MarchandPro Demo', 'Terangaprestige', '221711288439', 'Dakar', 'pro',
      '[{"nom":"Riz brise","unite":"sac 50kg","prix":22000,"mots":["riz"]},{"nom":"Huile vegetale","unite":"bidon 20L","prix":25000,"mots":["huile"]},{"nom":"Sucre","unite":"sac 50kg","prix":30000,"mots":["sucre"]},{"nom":"Farine","unite":"sac 50kg","prix":20000,"mots":["farine"]},{"nom":"Mil","unite":"sac 50kg","prix":18000,"mots":["mil"]},{"nom":"Tomate concentree","unite":"carton","prix":15000,"mots":["tomate"]},{"nom":"Savon","unite":"carton","prix":12000,"mots":["savon"]},{"nom":"Lait en poudre","unite":"boite 2.5kg","prix":8500,"mots":["lait"]}]'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('✅ Base de données MarchandPro initialisée');
}

const CATALOGUE = [
  { nom: 'Riz brisé', unite: 'sac 50kg', prix: 22000, mots: ['riz'] },
  { nom: 'Huile végétale', unite: 'bidon 20L', prix: 25000, mots: ['huile'] },
  { nom: 'Sucre', unite: 'sac 50kg', prix: 30000, mots: ['sucre'] },
  { nom: 'Farine', unite: 'sac 50kg', prix: 20000, mots: ['farine'] },
  { nom: 'Mil', unite: 'sac 50kg', prix: 18000, mots: ['mil'] },
  { nom: 'Tomate concentrée', unite: 'carton', prix: 15000, mots: ['tomate'] },
  { nom: 'Savon', unite: 'carton', prix: 12000, mots: ['savon'] },
  { nom: 'Lait en poudre', unite: 'boite 2.5kg', prix: 8500, mots: ['lait'] },
];

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
  const messageNorm = message.normalize('NFC').replace(/[''‛`´]/g, "'").replace(/d'(\w)/gi, 'de $1');
  const regex = /(\d+)\s*(sacs?|bidons?|boites?|kg|litres?|unités?|cartons?|paquets?)\s+(?:de\s+)?(\w+)/gi;
  let match;
  while ((match = regex.exec(messageNorm)) !== null) {
    const quantite = parseInt(match[1]);
    const unite = match[2];
    const motProduit = match[3].toLowerCase();
    if (motProduit.length <= 1) continue;
    const produitTrouve = catalogue.find(p => (p.mots||[]).some(m => motProduit.includes(m)));
    if (!produitTrouve) continue;
    produits.push({ quantite, unite, produit: produitTrouve.nom, prix_unitaire: produitTrouve.prix, total: produitTrouve.prix * quantite });
  }
  return produits;
}

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];
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
            `👋 Bienvenue chez *${merchant.nom_boutique}* ! 🇸🇳\n\n1️⃣ Tapez *catalogue* — voir nos produits\n2️⃣ Tapez *commander* — passer une commande\n3️⃣ Tapez *mes commandes* — voir vos commandes\n\nNous livrons rapidement ! 📦`
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
              const emoji = o.status === 'livré' ? '✅' : o.status === 'confirmé' ? '🔄' : '⏳';
              msg += `${emoji} CMD-${String(o.id).padStart(4,'0')} — ${o.status.toUpperCase()}\n`;
            });
            msg += `\nPour suivre une commande, tapez son numéro. Ex: *CMD-0027*`;
            await envoyerWhatsApp(phone_id, phone, msg);
          }
        }
        // Suivi commande CMD-XXXX
        else if (texte.match(/cmd-\d+/i)) {
          const ref = texte.match(/cmd-(\d+)/i)[1];
          const result = await pool.query('SELECT * FROM orders WHERE id=$1', [parseInt(ref)]);
          if (result.rows[0]) {
            const o = result.rows[0];
            const emoji = o.status === 'livré' ? '✅' : o.status === 'confirmé' ? '🔄' : '⏳';
            await envoyerWhatsApp(phone_id, phone,
              `${emoji} *CMD-${String(o.id).padStart(4,'0')}*\n\nStatut : ${o.status.toUpperCase()}\nTotal : ${Number(o.total).toLocaleString('fr-FR')} FCFA\nDate : ${new Date(o.created_at).toLocaleDateString('fr-FR')}`
            );
          } else {
            await envoyerWhatsApp(phone_id, phone, `❌ Commande introuvable. Vérifiez le numéro et réessayez.`);
          }
        }
        // Commander
        else if (texte.includes('commander') || texte === '2') {
          await envoyerWhatsApp(phone_id, phone,
            `🛒 Pour commander, écrivez simplement ce que vous voulez :\n\n_Exemple : "je veux 3 sacs de riz et 2 bidons d'huile"_\n\nTapez *catalogue* pour voir tous nos produits et prix. 📦`
          );
        }
        // Groq AI + Parser commande
        else {
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

app.put('/api/orders/:id', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const result = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
  res.json(result.rows[0]);
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
<style>
  body { font-family: Arial, sans-serif; padding: 40px; color: #1a2e1a; max-width: 700px; margin: 0 auto; }
  .header { background: #006633; color: white; padding: 24px; border-radius: 12px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: center; }
  .logo { font-size: 24px; font-weight: bold; }
  .ref { font-size: 14px; opacity: 0.8; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .info-box { background: #f5f7f5; padding: 16px; border-radius: 8px; }
  .info-label { font-size: 11px; color: #5a7a5a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .info-value { font-weight: bold; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #006633; color: white; padding: 10px 12px; text-align: left; font-size: 12px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
  tr:hover td { background: #f5f7f5; }
  .total-row { background: #e8f5e9; font-weight: bold; font-size: 15px; }
  .total-row td { border: none; padding: 14px 12px; }
  .footer { text-align: center; color: #5a7a5a; font-size: 12px; border-top: 2px solid #e8f5e9; padding-top: 16px; }
  .badge { display: inline-block; background: #e8f5e9; color: #006633; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">🛒 MarchandPro</div>
      <div style="font-size:12px;opacity:0.7;margin-top:4px">Votre grossiste digital 🇸🇳</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:bold">${ref}</div>
      <div class="ref">${date}</div>
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
  </div>

  <table>
    <thead>
      <tr>
        <th>Produit</th>
        <th style="text-align:center">Quantite</th>
        <th style="text-align:right">Prix unitaire</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lignes}
      <tr class="total-row">
        <td colspan="3">TOTAL</td>
        <td style="text-align:right">${total.toLocaleString('fr-FR')} FCFA</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p><b>MarchandPro</b> — WhatsApp : +221 71 128 84 39 | Dakar, Senegal</p>
    <p style="margin-top:4px">Merci pour votre confiance ! 🇸🇳</p>
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
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'MarchandPro', version: '2.0.0' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/api', (req, res) => res.json({ message: 'Bienvenue sur MarchandPro API 🇸🇳', version: '2.1.0', status: 'running' }));

// ============================================
// ONBOARDING MULTI-CLIENTS
// ============================================

// Inscription nouveau grossiste
app.post('/api/merchants/register', async (req, res) => {
  try {
    const { nom_boutique, proprietaire, whatsapp, ville, produits } = req.body;
    if (!nom_boutique || !whatsapp) return res.status(400).json({ error: 'Nom boutique et WhatsApp requis' });

    // Nettoyer le numéro WhatsApp
    const wa = whatsapp.replace(/\D/g, '');

    // Catalogue personnalisé ou catalogue par défaut
    const catalogue = produits && produits.length > 0 ? produits : CATALOGUE.map(p => ({
      nom: p.nom, unite: p.unite, prix: p.prix, mots: p.mots
    }));

    const result = await pool.query(
      `INSERT INTO merchants (nom_boutique, proprietaire, whatsapp, ville, plan, catalogue)
       VALUES ($1,$2,$3,$4,'gratuit',$5) RETURNING *`,
      [nom_boutique, proprietaire || '', wa, ville || 'Dakar', JSON.stringify(catalogue)]
    );

    const merchant = result.rows[0];
    console.log(`✅ Nouveau grossiste inscrit: ${nom_boutique} (${wa})`);

    // Envoyer message de bienvenue
    const msgBienvenue = `🎉 Bienvenue sur *MarchandPro* !\n\n` +
      `Bonjour *${proprietaire || nom_boutique}* 🇸🇳\n\n` +
      `Votre boutique *${nom_boutique}* est maintenant active !\n\n` +
      `📊 Votre dashboard : ${process.env.BASE_URL || 'https://marchandpro-production-b529.up.railway.app'}/merchant/${merchant.id}\n\n` +
      `Vos clients peuvent maintenant commander via WhatsApp 📱\n` +
      `Plan actuel : *Gratuit* (50 commandes/mois)\n\n` +
      `Pour passer au plan Starter à 15 000 FCFA/mois, répondez *UPGRADE* 🚀`;

    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, wa, msgBienvenue);

    res.json({ ok: true, merchant_id: merchant.id, message: 'Inscription réussie !' });
  } catch (err) {
    if (err.message.includes('unique')) return res.status(400).json({ error: 'Ce numéro WhatsApp est déjà inscrit' });
    res.status(500).json({ error: err.message });
  }
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
  <div class="card">
    <div class="card-title">📋 Commandes récentes</div>
    <div id="commandes">Chargement...</div>
  </div>
</div>
<div class="footer">MarchandPro 🇸🇳 — <a href="/" style="color:#006633">Accueil</a></div>
<script>
const API = 'https://marchandpro-production-b529.up.railway.app';
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
</script>
</body>
</html>`);
});

// Formulaire d'inscription grossiste
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
    <p>Inscrivez votre boutique — C'est gratuit !</p>
  </div>
  <label>Nom de votre boutique *</label>
  <input id="nom_boutique" type="text" placeholder="Ex: Boutique Amadou, Grossiste Fatou..." />
  <label>Votre nom *</label>
  <input id="proprietaire" type="text" placeholder="Ex: Amadou Diallo" />
  <label>Numéro WhatsApp *</label>
  <input id="whatsapp" type="tel" placeholder="Ex: 221771234567" />
  <label>Ville</label>
  <select id="ville">
    <option>Dakar</option>
    <option>Thiès</option>
    <option>Pikine</option>
    <option>Guédiawaye</option>
    <option>Rufisque</option>
    <option>Saint-Louis</option>
    <option>Ziguinchor</option>
    <option>Autre</option>
  </select>
  <button class="btn" onclick="inscrire()">🚀 Créer mon espace gratuit</button>
  <div class="success" id="success"></div>
  <div class="error" id="error"></div>
</div>
<script>
async function inscrire() {
  const nom_boutique = document.getElementById('nom_boutique').value.trim();
  const proprietaire = document.getElementById('proprietaire').value.trim();
  const whatsapp = document.getElementById('whatsapp').value.trim();
  const ville = document.getElementById('ville').value;
  if (!nom_boutique || !whatsapp) { 
    document.getElementById('error').style.display='block';
    document.getElementById('error').textContent='Nom de boutique et WhatsApp sont obligatoires !';
    return; 
  }
  document.querySelector('.btn').textContent = '⏳ Inscription en cours...';
  document.querySelector('.btn').disabled = true;
  try {
    const res = await fetch('/api/merchants/register', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nom_boutique,proprietaire,whatsapp,ville})
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('success').style.display='block';
      document.getElementById('success').innerHTML = '🎉 Inscription réussie !<br>Vous allez recevoir un message WhatsApp de bienvenue.<br><br><a href="/merchant/'+data.merchant_id+'" style="color:#006633;font-weight:700">👉 Accéder à mon dashboard</a>';
      document.querySelector('.btn').style.display='none';
    } else {
      throw new Error(data.error);
    }
  } catch(err) {
    document.getElementById('error').style.display='block';
    document.getElementById('error').textContent = 'Erreur: ' + err.message;
    document.querySelector('.btn').textContent='🚀 Créer mon espace gratuit';
    document.querySelector('.btn').disabled=false;
  }
}
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

// Activer/désactiver un merchant
app.put('/api/merchants/:id/toggle', async (req, res) => {
  try {
    await pool.query('UPDATE merchants SET actif = NOT actif WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Catalogue Pro — page partageable par grossiste
app.get('/catalogue/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'catalogue.html')));

// Page admin
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
async function envoyerRelances() {
  try {
    console.log('🔔 Vérification des relances...');

    // Clients inactifs depuis 7 jours
    const result = await pool.query(`
      SELECT DISTINCT customer_phone,
        MAX(created_at) as derniere_commande,
        COUNT(*) as nb_commandes,
        SUM(CAST(total AS NUMERIC)) as total_achats
      FROM orders
      GROUP BY customer_phone
      HAVING MAX(created_at) < NOW() - INTERVAL '7 days'
    `);

    console.log(`📊 ${result.rows.length} client(s) inactif(s) trouvé(s)`);

    for (const client of result.rows) {
      const phone = client.customer_phone;
      const nbCommandes = parseInt(client.nb_commandes);
      const totalAchats = parseInt(client.total_achats || 0);
      const joursInactif = Math.floor((Date.now() - new Date(client.derniere_commande)) / (1000 * 60 * 60 * 24));

      const message = `👋 Bonjour ! Ici *MarchandPro* 🇸🇳\n\n` +
        `Vous nous manquez ! Votre dernière commande date de *${joursInactif} jours*.\n\n` +
        `🎁 *Offre spéciale* pour vous :\n` +
        `Commandez aujourd'hui et bénéficiez d'une remise *5%* sur toute commande de 10 unités ou plus !\n\n` +
        `📦 Nos produits disponibles :\n` +
        `• Riz brisé — 22 000 FCFA/sac\n` +
        `• Huile végétale — 25 000 FCFA/bidon\n` +
        `• Sucre — 30 000 FCFA/sac\n\n` +
        `Répondez *catalogue* pour voir tous nos produits 🛒`;

      const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
      const META_TOKEN = process.env.META_TOKEN;

      await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: message }
        })
      });

      console.log(`✅ Relance envoyée à +${phone} (${joursInactif} jours inactif)`);

      // Attendre 2 secondes entre chaque message
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('✅ Relances terminées');
  } catch (err) {
    console.error('❌ Erreur relances:', err.message);
  }
}

// Route manuelle pour tester les relances
app.get('/api/relances', async (req, res) => {
  await envoyerRelances();
  res.json({ ok: true, message: 'Relances envoyées !' });
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
    setInterval(envoyerRelances, 24 * 60 * 60 * 1000); // Toutes les 24h
  }, delai);
}

initDB().then(() => {
  app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 MarchandPro v2.1 démarré sur port ' + (process.env.PORT || 3000));
    planifierRelances();
  });
}).catch(err => console.error('Erreur démarrage:', err));
