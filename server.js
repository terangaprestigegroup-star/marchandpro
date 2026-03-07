const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');

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

function parserCommande(message) {
  const produits = [];
  const regex = /(\d+)\s*(sacs?|bidons?|boites?|kg|litres?|unités?|cartons?|paquets?)\s+(?:de\s+)?(\w+)/gi;
  let match;
  while ((match = regex.exec(message)) !== null) {
    produits.push({ quantite: parseInt(match[1]), unite: match[2], produit: match[3].toLowerCase() });
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

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const message = req.body.Body || '';
    const expediteur = req.body.From || '';
    const phone = expediteur.substring(0, 49);
    console.log('📱 Message reçu:', message, 'de', phone);
    const produits = parserCommande(message);
    if (produits.length > 0) {
      const count = await pool.query('SELECT COUNT(*) FROM orders');
      const ref = `CMD-${String(parseInt(count.rows[0].count) + 1).padStart(4, '0')}`;
      let reponse = `✅ *MarchandPro* — Commande reçue !\n\n`;
      produits.forEach(p => { reponse += `• ${p.quantite} ${p.unite} de ${p.produit}\n`; });
      reponse += `\n📋 Référence : ${ref}\n⏳ Confirmation sous peu. Merci ! 🙏`;
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(reponse);
      res.type('text/xml').send(twiml.toString());
      pool.query('INSERT INTO orders (customer_phone, items, status) VALUES ($1, $2, $3)', [phone, JSON.stringify(produits), 'nouveau']);
      pool.query(`INSERT INTO clients (phone, total_orders) VALUES ($1, 1) ON CONFLICT (phone) DO UPDATE SET total_orders = clients.total_orders + 1`, [phone]);
    } else {
      const reponse = `👋 Bienvenue sur *MarchandPro* !\n\nPour commander, écrivez :\n_"je veux 3 sacs de riz et 2 bidons d'huile"_\n\nNous traitons votre commande automatiquement. 📦`;
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(reponse);
      res.type('text/xml').send(twiml.toString());
    }
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
    const revenus = await pool.query("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status='livré'");
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

app.get('/api/roi', authMiddleware, async (req, res) => {
  const commandes = await pool.query("SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '30 days'");
  const revenus = await pool.query("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status='livré' AND created_at > NOW() - INTERVAL '30 days'");
  res.json({ periode: '30 derniers jours', commandes: parseInt(commandes.rows[0].count), revenus_fcfa: parseFloat(revenus.rows[0].total), cout_abonnement: 10000, roi: `${Math.round((parseFloat(revenus.rows[0].total) / 10000) * 100)}%` });
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

app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === 'marchandpro2026') {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'MarchandPro', version: '1.0.0' }));
app.get('/', (req, res) => res.json({ message: 'Bienvenue sur MarchandPro API 🇸🇳', status: 'running' }));

setInterval(() => {
  fetch('https://marchandpro.onrender.com/health').catch(()=>{});
}, 840000);

initDB().then(() => {app.listen(process.env.PORT || 3000, () => console.log('🚀 MarchandPro démarré sur port ' + (process.env.PORT || 3000)));
}).catch(err => console.error('Erreur démarrage:', err));
