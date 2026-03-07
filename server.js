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
      phone VARCHAR(50) UNIQUE,
      name VARCHAR(100),
      total_orders INTEGER DEFAULT 0,
      total_spent DECIMAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
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

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];
      if (message && message.type === 'text') {
        const phone = message.from;
        const texte = message.text.body.toLowerCase().trim();
        const phone_id = change.value.metadata.phone_number_id;

        // Menu principal — seulement si message très court (1-2 mots)
        if (['menu', 'aide', 'help'].some(m => texte === m) || 
            (['bonjour', 'salut', 'bonsoir', 'hello', 'allo', 'allô'].some(m => texte === m))) {
          await envoyerWhatsApp(phone_id, phone,
            `👋 Bienvenue sur *MarchandPro* ! 🇸🇳\n\nQue souhaitez-vous faire ?\n\n1️⃣ Tapez *catalogue* — voir nos produits\n2️⃣ Tapez *commander* — passer une commande\n3️⃣ Tapez *mes commandes* — voir vos commandes\n\nNous livrons rapidement ! 📦`
          );
        }
        // Catalogue
        else if (texte.includes('catalogue') || texte.includes('produit') || texte === '1') {
          await envoyerWhatsApp(phone_id, phone, formaterCatalogue());
        }
        // Mes commandes
        else if ((texte.includes('commande') && texte.includes('mes')) || texte === '3') {
          const result = await pool.query('SELECT * FROM orders WHERE customer_phone=$1 ORDER BY created_at DESC LIMIT 5', [phone]);
          if (result.rows.length === 0) {
            await envoyerWhatsApp(phone_id, phone, `📋 Vous n'avez pas encore de commandes.\n\nTapez *catalogue* pour voir nos produits ! 😊`);
          } else {
            let msg = `📋 *Vos dernières commandes :*\n\n`;
            result.rows.forEach(o => {
              const emoji = o.status === 'livré' ? '✅' : o.status === 'confirmé' ? '🔄' : '⏳';
              msg += `${emoji} CMD-${String(o.id).padStart(4, '0')} — ${o.status.toUpperCase()}\n`;
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
              `${emoji} *CMD-${String(o.id).padStart(4, '0')}*\n\nStatut : ${o.status.toUpperCase()}\nTotal : ${Number(o.total).toLocaleString('fr-FR')} FCFA\nDate : ${new Date(o.created_at).toLocaleDateString('fr-FR')}`
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
        // Groq AI pour tout message non reconnu
        else {
          const produits = parserCommande(texte);
          if (produits.length > 0) {
            const total = produits.reduce((sum, p) => sum + p.total, 0);
            let totalApresRemise = total;
            let remiseMsg = '';

            // Calcul remise par produit
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
            const ref = `CMD-${String(parseInt(count.rows[0].count) + 1).padStart(4, '0')}`;

            let reponse = `✅ *MarchandPro* — Commande reçue !\n\n`;
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

            await pool.query('INSERT INTO orders (customer_phone, items, total, status) VALUES ($1, $2, $3, $4)',
              [phone, JSON.stringify(produits), totalApresRemise, 'nouveau']);
            await pool.query(`INSERT INTO clients (phone, total_orders, total_spent) VALUES ($1, 1, $2) ON CONFLICT (phone) DO UPDATE SET total_orders = clients.total_orders + 1, total_spent = clients.total_spent + $2`,
              [phone, totalApresRemise]);

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
            const historique = await pool.query('SELECT COUNT(*) FROM orders WHERE customer_phone=$1', [phone]);
            const contexte = `Ce client a ${historique.rows[0].count} commandes passées.`;
            let reponseIA = null;
            try {
              reponseIA = await demanderGroq(message.text.body, contexte);
              console.log('Groq reponse v3:', reponseIA);
            } catch(err) {
              console.error('Groq erreur:', err.message);
            }
            await envoyerWhatsApp(phone_id, phone, reponseIA ||
              `👋 Bienvenue sur *MarchandPro* ! 🇸🇳\n\n1️⃣ *catalogue* — voir nos produits\n2️⃣ *commander* — passer une commande\n3️⃣ *mes commandes* — voir vos commandes`
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
    res.json({ ok: true, message: 'Migration reussie!' });
  } catch(err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/catalogue', (req, res) => res.json(CATALOGUE));

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
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'MarchandPro', version: '2.0.0' }));
app.get('/', (req, res) => res.json({ message: 'Bienvenue sur MarchandPro API 🇸🇳', version: '2.0.0', status: 'running' }));

// ============================================
// RELANCES AUTOMATIQUES
// ============================================
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
