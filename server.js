const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fetch = require('node-fetch');

const app = express();

// No-cache headers
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Route racine
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/commande', (req, res) => res.sendFile(path.join(__dirname, 'public', 'acheteur.html')));
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));

app.use(express.static(path.join(__dirname, 'public')));

// DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================
// INIT DB
// ============================================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marchands (
      id SERIAL PRIMARY KEY,
      nom_boutique TEXT NOT NULL,
      proprietaire TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      email TEXT,
      ville TEXT DEFAULT 'Dakar',
      zone TEXT,
      type_produits TEXT DEFAULT 'general',
      description TEXT,
      logo_emoji TEXT DEFAULT '🏪',
      pin VARCHAR(10) DEFAULT '1234',
      plan TEXT DEFAULT 'gratuit',
      essai_expire TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
      abonnement_expire TIMESTAMP,
      actif BOOLEAN DEFAULT true,
      nb_commandes INTEGER DEFAULT 0,
      referral_code TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS produits (
      id SERIAL PRIMARY KEY,
      marchand_id INTEGER REFERENCES marchands(id),
      nom TEXT NOT NULL,
      description TEXT,
      prix NUMERIC NOT NULL,
      prix_gros NUMERIC,
      unite TEXT DEFAULT 'unité',
      stock INTEGER DEFAULT 0,
      stock_illimite BOOLEAN DEFAULT false,
      categorie TEXT DEFAULT 'général',
      emoji TEXT DEFAULT '📦',
      disponible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS acheteurs (
      id SERIAL PRIMARY KEY,
      marchand_id INTEGER REFERENCES marchands(id),
      nom TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      adresse TEXT,
      ville TEXT DEFAULT 'Dakar',
      nb_commandes INTEGER DEFAULT 0,
      total_achats NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS commandes (
      id SERIAL PRIMARY KEY,
      marchand_id INTEGER REFERENCES marchands(id),
      acheteur_phone TEXT NOT NULL,
      acheteur_nom TEXT,
      items JSONB NOT NULL DEFAULT '[]',
      total NUMERIC NOT NULL DEFAULT 0,
      adresse_livraison TEXT,
      date_livraison TIMESTAMP,
      notes TEXT,
      statut TEXT DEFAULT 'nouveau',
      reference TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS livreurs (
      id SERIAL PRIMARY KEY,
      marchand_id INTEGER REFERENCES marchands(id),
      nom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      transport TEXT DEFAULT 'Moto',
      zone TEXT,
      disponible BOOLEAN DEFAULT true,
      pin VARCHAR(10) DEFAULT '1234',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS livraisons (
      id SERIAL PRIMARY KEY,
      livreur_id INTEGER REFERENCES livreurs(id),
      commande_id INTEGER REFERENCES commandes(id),
      marchand_id INTEGER REFERENCES marchands(id),
      statut TEXT DEFAULT 'assignée',
      adresse TEXT,
      montant NUMERIC DEFAULT 0,
      code_confirmation VARCHAR(6),
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE marchands ADD COLUMN IF NOT EXISTS whatsapp_verified BOOLEAN DEFAULT false;
    ALTER TABLE marchands ADD COLUMN IF NOT EXISTS sms_backup BOOLEAN DEFAULT true;
    ALTER TABLE marchands ADD COLUMN IF NOT EXISTS email_backup BOOLEAN DEFAULT true;
    ALTER TABLE commandes ADD COLUMN IF NOT EXISTS livreur_id INTEGER;
    ALTER TABLE commandes ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false;
  `);

  // Demo marchand
  const existing = await pool.query('SELECT id FROM marchands LIMIT 1');
  if (!existing.rows.length) {
    await pool.query(`
      INSERT INTO marchands (nom_boutique, proprietaire, whatsapp, ville, type_produits, pin, plan, referral_code)
      VALUES ('Chez Modou Grossiste', 'Modou Diallo', '221771234567', 'Dakar', 'alimentation', '1234', 'starter', 'MODOU2026')
    `);
    const m = await pool.query('SELECT id FROM marchands LIMIT 1');
    const mid = m.rows[0].id;
    await pool.query(`
      INSERT INTO produits (marchand_id, nom, prix, prix_gros, unite, stock, categorie, emoji, disponible) VALUES
      ($1, 'Riz brisé', 500, 450, 'kg', 1000, 'alimentation', '🌾', true),
      ($1, 'Huile végétale', 1200, 1100, 'litre', 500, 'alimentation', '🛢️', true),
      ($1, 'Sucre', 700, 650, 'kg', 800, 'alimentation', '🍬', true),
      ($1, 'Farine de blé', 600, 550, 'kg', 600, 'alimentation', '🌾', true),
      ($1, 'Savon de ménage', 300, 250, 'unité', 2000, 'hygiène', '🧼', true)
    `, [mid]);
  }

  console.log('✅ MarchandPro V2 DB initialisée');
}

// ============================================
// UTILS
// ============================================
function genRef() {
  return 'MP-' + Date.now().toString(36).toUpperCase().slice(-6);
}

async function envoyerWhatsApp(phone_id, to, message) {
  if (!process.env.META_TOKEN || !phone_id) return false;
  try {
    const phone = String(to).replace(/[^0-9]/g, '');
    const wa = phone.startsWith('221') ? phone : '221' + phone;
    await fetch(`https://graph.facebook.com/v18.0/${phone_id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: wa, type: 'text', text: { body: message } })
    });
    return true;
  } catch(e) { return false; }
}

async function envoyerNotification(marchandId, acheteurPhone, message) {
  const m = await pool.query('SELECT * FROM marchands WHERE id=$1', [marchandId]);
  const marchand = m.rows[0];
  if (!marchand) return;

  // Canal 1 — WhatsApp
  const waSent = await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, acheteurPhone, message);
  
  // Canal 2 — SMS backup si WhatsApp échoue
  if (!waSent && marchand.sms_backup) {
    try {
      // Twilio SMS backup
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const phone = String(acheteurPhone).replace(/[^0-9]/g, '');
        const wa = phone.startsWith('221') ? '+' + phone : '+221' + phone;
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ To: wa, From: process.env.TWILIO_WHATSAPP_NUMBER || '', Body: message })
        });
      }
    } catch(e) {}
  }
}

// ============================================
// API MARCHANDS
// ============================================
app.post('/api/marchand/inscription', async (req, res) => {
  try {
    const { nom_boutique, proprietaire, whatsapp, email, ville, type_produits } = req.body;
    if (!nom_boutique || !proprietaire || !whatsapp) return res.status(400).json({ error: 'Champs obligatoires manquants' });
    const phone = String(whatsapp).replace(/[^0-9]/g, '');
    const wa = phone.startsWith('221') ? phone : '221' + phone;
    const ref = 'MP' + Math.random().toString(36).toUpperCase().slice(-6);
    const r = await pool.query(
      `INSERT INTO marchands (nom_boutique, proprietaire, whatsapp, email, ville, type_produits, referral_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, referral_code`,
      [nom_boutique, proprietaire, wa, email, ville || 'Dakar', type_produits || 'general', ref]
    );
    const marchand = r.rows[0];
    // Notifier marchand
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, wa,
      `🎉 *Bienvenue sur MarchandPro !*\n\n🏪 ${nom_boutique}\n\nVotre espace est prêt !\n👉 https://marchandpro.up.railway.app/app?id=${marchand.id}\n\nPIN par défaut : *1234*\n\n_MarchandPro 🇸🇳_`
    );
    res.json({ ok: true, id: marchand.id, ref: marchand.referral_code });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/marchand/login', async (req, res) => {
  try {
    const { marchand_id, pin } = req.body;
    const r = await pool.query('SELECT * FROM marchands WHERE id=$1 AND actif=true', [marchand_id]);
    const m = r.rows[0];
    if (!m) return res.json({ ok: false, error: 'Marchand introuvable' });
    if (m.pin !== String(pin)) return res.json({ ok: false, error: 'PIN incorrect' });
    res.json({ ok: true, marchand: m });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/marchand/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM marchands WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/marchand/:id', async (req, res) => {
  try {
    const { nom_boutique, description, ville, zone, type_produits, email, logo_emoji } = req.body;
    await pool.query(
      `UPDATE marchands SET nom_boutique=COALESCE($1,nom_boutique), description=COALESCE($2,description),
       ville=COALESCE($3,ville), zone=COALESCE($4,zone), type_produits=COALESCE($5,type_produits),
       email=COALESCE($6,email), logo_emoji=COALESCE($7,logo_emoji) WHERE id=$8`,
      [nom_boutique, description, ville, zone, type_produits, email, logo_emoji, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API PRODUITS
// ============================================
app.get('/api/produits/:marchand_id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM produits WHERE marchand_id=$1 ORDER BY categorie, nom', [req.params.marchand_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/produits', async (req, res) => {
  try {
    const { marchand_id, nom, description, prix, prix_gros, unite, stock, stock_illimite, categorie, emoji } = req.body;
    const r = await pool.query(
      `INSERT INTO produits (marchand_id, nom, description, prix, prix_gros, unite, stock, stock_illimite, categorie, emoji)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [marchand_id, nom, description, prix, prix_gros || prix, unite || 'unité', stock || 0, stock_illimite || false, categorie || 'général', emoji || '📦']
    );
    res.json({ ok: true, produit: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/produits/:id', async (req, res) => {
  try {
    const { nom, prix, prix_gros, stock, disponible, emoji, unite, categorie } = req.body;
    await pool.query(
      `UPDATE produits SET nom=COALESCE($1,nom), prix=COALESCE($2,prix), prix_gros=COALESCE($3,prix_gros),
       stock=COALESCE($4,stock), disponible=COALESCE($5,disponible), emoji=COALESCE($6,emoji),
       unite=COALESCE($7,unite), categorie=COALESCE($8,categorie) WHERE id=$9`,
      [nom, prix, prix_gros, stock, disponible, emoji, unite, categorie, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/produits/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM produits WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API COMMANDES
// ============================================
app.get('/api/commandes/:marchand_id', async (req, res) => {
  try {
    const { statut, limit } = req.query;
    let q = `SELECT c.*,
      (SELECT l.nom FROM livraisons lv JOIN livreurs l ON l.id=lv.livreur_id
       WHERE lv.commande_id=c.id ORDER BY lv.created_at DESC LIMIT 1) as livreur_nom
      FROM commandes c WHERE c.marchand_id=$1`;
    const params = [req.params.marchand_id];
    if (statut) { q += ` AND c.statut=$${params.length+1}`; params.push(statut); }
    q += ' ORDER BY c.created_at DESC LIMIT ' + (limit || 50);
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/commandes', async (req, res) => {
  try {
    const { marchand_id, acheteur_phone, acheteur_nom, items, total, adresse_livraison, date_livraison, notes } = req.body;
    const ref = genRef();
    const r = await pool.query(
      `INSERT INTO commandes (marchand_id, acheteur_phone, acheteur_nom, items, total, adresse_livraison, date_livraison, notes, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [marchand_id, acheteur_phone, acheteur_nom, JSON.stringify(items || []), total || 0, adresse_livraison, date_livraison, notes, ref]
    );
    const cmd = r.rows[0];

    // Mettre à jour acheteur
    const phone = String(acheteur_phone).replace(/[^0-9]/g, '');
    await pool.query(
      `INSERT INTO acheteurs (marchand_id, phone, nom, adresse, nb_commandes, total_achats)
       VALUES ($1,$2,$3,$4,1,$5)
       ON CONFLICT (phone) DO UPDATE SET nb_commandes=acheteurs.nb_commandes+1, total_achats=acheteurs.total_achats+$5`,
      [marchand_id, phone, acheteur_nom, adresse_livraison, total || 0]
    ).catch(() => {});

    res.json({ ok: true, commande: cmd });

    // Notification acheteur
    const resume = (items || []).map(i => `• ${i.quantite}x ${i.nom} — ${Number(i.prix * i.quantite).toLocaleString('fr-FR')} FCFA`).join('\n');
    const m = await pool.query('SELECT * FROM marchands WHERE id=$1', [marchand_id]);
    const marchand = m.rows[0];
    await envoyerNotification(marchand_id, acheteur_phone,
      `✅ *Commande reçue !*\n\n🏪 ${marchand?.nom_boutique}\n📋 Réf: *${ref}*\n\n${resume}\n\n💰 *Total: ${Number(total).toLocaleString('fr-FR')} FCFA*\n\n_Pour annuler: ANNULER ${ref}_\n\n_MarchandPro 🇸🇳_`
    );

    // Notification marchand
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, marchand?.whatsapp,
      `🔔 *Nouvelle commande !*\n\n👤 ${acheteur_nom || acheteur_phone}\n📋 ${ref}\n💰 ${Number(total).toLocaleString('fr-FR')} FCFA\n\n_MarchandPro 🇸🇳_`
    );

    // Auto-confirmation 2 minutes
    setTimeout(async () => {
      try {
        const check = await pool.query("SELECT statut FROM commandes WHERE id=$1", [cmd.id]);
        if (check.rows[0]?.statut === 'nouveau') {
          await pool.query("UPDATE commandes SET statut='confirmé' WHERE id=$1", [cmd.id]);
          await envoyerNotification(marchand_id, acheteur_phone,
            `✅ *Commande confirmée !*\n\n📋 Réf: ${ref}\n💰 ${Number(total).toLocaleString('fr-FR')} FCFA\n\n_En préparation 📦_\n\n_Pour annuler: ANNULER ${ref}_\n\n_MarchandPro 🇸🇳_`
          );
        }
      } catch(e) {}
    }, 2 * 60 * 1000);

  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/commandes/:id', async (req, res) => {
  try {
    const { statut, marchand_id } = req.body;
    const r = await pool.query('UPDATE commandes SET statut=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [statut, req.params.id]);
    const cmd = r.rows[0];
    if (!cmd) return res.status(404).json({ error: 'Commande introuvable' });

    // Notifier acheteur
    const msgs = {
      'confirmé': `✅ *Commande confirmée !*\n\n📋 ${cmd.reference}\n💰 ${Number(cmd.total).toLocaleString('fr-FR')} FCFA\n\n_En préparation 📦_`,
      'en route': `🚚 *Votre commande est en route !*\n\n📋 ${cmd.reference}\n📍 ${cmd.adresse_livraison || 'Livraison en cours'}`,
      'livré': `🎉 *Commande livrée !*\n\n📋 ${cmd.reference}\nMerci pour votre achat ! 🙏\n\n_Comment noteriez-vous cette commande ? (1-5)_`,
      'annulé': `❌ *Commande annulée*\n\n📋 ${cmd.reference}\nNous sommes désolés. Contactez-nous pour plus d'infos.`
    };

    if (msgs[statut]) {
      await envoyerNotification(cmd.marchand_id, cmd.acheteur_phone, msgs[statut]);
    }

    res.json({ ok: true, commande: cmd });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API DASHBOARD STATS
// ============================================
app.get('/api/stats/:marchand_id', async (req, res) => {
  try {
    const id = req.params.marchand_id;
    const [cmds, revenus, acheteurs, produits, nouvelles] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM commandes WHERE marchand_id=$1', [id]),
      pool.query("SELECT COALESCE(SUM(total),0) as total FROM commandes WHERE marchand_id=$1 AND statut != 'annulé'", [id]),
      pool.query('SELECT COUNT(DISTINCT acheteur_phone) FROM commandes WHERE marchand_id=$1', [id]),
      pool.query('SELECT COUNT(*) FROM produits WHERE marchand_id=$1 AND disponible=true', [id]),
      pool.query("SELECT COUNT(*) FROM commandes WHERE marchand_id=$1 AND statut='nouveau'", [id])
    ]);

    // Revenus aujourd'hui
    const today = await pool.query(
      "SELECT COALESCE(SUM(total),0) as total FROM commandes WHERE marchand_id=$1 AND DATE(created_at)=CURRENT_DATE AND statut != 'annulé'",
      [id]
    );

    // Revenus 7 jours
    const sept = await pool.query(
      `SELECT DATE(created_at) as jour, COALESCE(SUM(total),0) as total
       FROM commandes WHERE marchand_id=$1 AND created_at >= NOW()-INTERVAL '7 days' AND statut != 'annulé'
       GROUP BY DATE(created_at) ORDER BY jour`,
      [id]
    );

    res.json({
      nb_commandes: cmds.rows[0].count,
      revenus_total: revenus.rows[0].total,
      revenus_aujourd_hui: today.rows[0].total,
      nb_acheteurs: acheteurs.rows[0].count,
      nb_produits: produits.rows[0].count,
      nouvelles_commandes: nouvelles.rows[0].count,
      revenus_7j: sept.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API LIVREURS
// ============================================
app.get('/api/livreurs/:marchand_id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.*, COUNT(lv.id) as nb_livraisons,
       SUM(CASE WHEN lv.statut='livrée' THEN 1 ELSE 0 END) as nb_livrees
       FROM livreurs l LEFT JOIN livraisons lv ON lv.livreur_id=l.id
       WHERE l.marchand_id=$1 GROUP BY l.id ORDER BY l.nom`,
      [req.params.marchand_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/livreurs', async (req, res) => {
  try {
    const { marchand_id, nom, telephone, transport, zone } = req.body;
    const r = await pool.query(
      'INSERT INTO livreurs (marchand_id, nom, telephone, transport, zone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [marchand_id, nom, telephone, transport || 'Moto', zone]
    );
    res.json({ ok: true, livreur: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API ACHETEURS
// ============================================
app.get('/api/acheteurs/:marchand_id', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM acheteurs WHERE marchand_id=$1 ORDER BY total_achats DESC',
      [req.params.marchand_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// WEBHOOK WHATSAPP
// ============================================
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;
    const phone = msg.from;
    const texte = msg.text?.body?.trim() || '';
    const phone_id = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    // Trouver le marchand
    const cmdClient = await pool.query(
      'SELECT marchand_id FROM commandes WHERE acheteur_phone=$1 ORDER BY created_at DESC LIMIT 1',
      [phone.replace(/[^0-9]/g, '')]
    );
    if (!cmdClient.rows[0]) return;
    const marchand_id = cmdClient.rows[0].marchand_id;

    // ANNULER commande
    const annulMatch = texte.match(/annuler?\s+(MP-[A-Z0-9]+)/i);
    if (annulMatch) {
      const ref = annulMatch[1].toUpperCase();
      const cmd = await pool.query("SELECT * FROM commandes WHERE reference=$1 AND acheteur_phone=$2", [ref, phone.replace(/[^0-9]/g,'')]);
      if (!cmd.rows[0]) {
        await envoyerWhatsApp(phone_id, phone, `❌ Commande *${ref}* introuvable.`);
      } else if (['livré', 'en route'].includes(cmd.rows[0].statut)) {
        await envoyerWhatsApp(phone_id, phone, `❌ Impossible d'annuler — commande déjà ${cmd.rows[0].statut}.`);
      } else {
        await pool.query("UPDATE commandes SET statut='annulé' WHERE id=$1", [cmd.rows[0].id]);
        const m = await pool.query('SELECT * FROM marchands WHERE id=$1', [marchand_id]);
        await envoyerWhatsApp(phone_id, m.rows[0]?.whatsapp, `❌ *Commande annulée*\n\n📋 ${ref}\n👤 ${phone}\n\n_MarchandPro 🇸🇳_`);
        await envoyerWhatsApp(phone_id, phone, `✅ Commande *${ref}* annulée avec succès.`);
      }
    }
  } catch(e) {}
});

// ============================================
// ADMIN
// ============================================
app.get('/api/admin/backup', async (req, res) => {
  try {
    const secret = req.query.secret;
    if (secret !== (process.env.ADMIN_SECRET || 'marchandpro-admin-2026')) return res.status(403).json({ error: 'Accès refusé' });
    const tables = ['marchands','produits','acheteurs','commandes','livreurs','livraisons'];
    const backup = { date: new Date().toISOString(), tables: {} };
    for(const t of tables){
      try { const r = await pool.query(`SELECT * FROM ${t}`); backup.tables[t] = r.rows; } catch(e) { backup.tables[t] = []; }
    }
    res.setHeader('Content-Disposition', 'attachment; filename=marchandpro-backup.json');
    res.json(backup);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ MarchandPro V2 — Port ${PORT}`));
}).catch(e => {
  console.error('DB Error:', e);
  process.exit(1);
});
