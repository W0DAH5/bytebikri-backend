require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const WebTorrent = require('webtorrent');
const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, verifyJWT } = require('./middleware');
const adminRoutes = require('./admin');
const crypto = require('crypto');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-auth-token']
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: path.join(__dirname,'tmp/') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

const torrentClient = new WebTorrent();
torrentClient.maxConns = 20;

console.log('ByteBikri server initializing...');

async function authMiddleware(req, res, next) {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ error: 'Auth token required' });
  try {
    const user = await verifyJWT(token);
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    
    if (error) return res.status(400).json({ error: error.message });
    
    await supabaseAdmin.from('profiles').insert([{
      id: data.user.id,
      display_name: email.split('@')[0],
      role: 'user',
      tier: 'basic'
    }]);
    
    await supabaseAdmin.from('coin_balances').insert([{
      user_id: data.user.id,
      coins: 100
    }]);
    
    res.json({ ok: true, user: data.user });
  } catch (e) {
    console.error('Signup error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) return res.status(400).json({ error: error.message });
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    if (profile?.banned) {
      return res.status(403).json({ error: 'Account banned' });
    }
    
    res.json({ 
      ok: true, 
      user: { 
        id: data.user.id, 
        email: data.user.email,
        role: profile?.role || 'user'
      },
      token: data.session.access_token 
    });
  } catch (e) {
    console.error('Signin error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!checkRateLimit(req.user.id, 'upload')) {
      return res.status(429).json({ error: 'Rate limit reached' });
    }
    
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > 10) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ 
        error: 'File too large. Maximum 10MB allowed.' 
      });
    }

    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
    const finalPath = path.join(uploadsDir, fileHash + path.extname(file.originalname));
    
    fs.renameSync(file.path, finalPath);

    torrentClient.seed(finalPath, { 
      name: file.originalname,
      comment: `ByteBikri asset uploaded by ${req.user.id}`
    }, async (torrent) => {
      console.log('Seeding:', torrent.name);

      const { data, error } = await supabaseAdmin.from('assets').insert([{
        owner_id: req.user.id,
        title: req.body.title || file.originalname,
        file_url: `/uploads/${path.basename(finalPath)}`,
        magnet_uri: torrent.magnetURI,
        info_hash: torrent.infoHash,
        file_size: torrent.length,
        preview_url: `/uploads/${path.basename(finalPath)}`,
        price_coins: parseInt(req.body.price_coins || 10),
        type: req.body.type || 'small',
        flagged: false
      }]).select().single();

      if (error) {
        console.error('DB error:', error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ 
        ok: true, 
        asset: data, 
        magnetURI: torrent.magnetURI,
        infoHash: torrent.infoHash 
      });
    });

  } catch (e) {
    console.error('Upload error:', e);
    if (fs.existsSync(req.file?.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/assets', authMiddleware, async (req, res) => {
  try {
    const { data: assets, error } = await supabaseAdmin
      .from('assets')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) return res.status(500).json({ error: error.message });

    let purchasedMap = {};
    if (req.user && req.user.id) {
      const { data: purchases } = await supabaseAdmin
        .from('purchases')
        .select('asset_id')
        .eq('buyer_id', req.user.id);
      purchases?.forEach(p => { purchasedMap[p.asset_id] = true; });
    }

    const assetsWithStatus = assets.map(a => ({ 
      ...a, 
      unlocked: !!purchasedMap[a.id] || a.owner_id === req.user.id 
    }));
    
    res.json(assetsWithStatus);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/coins/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { data, error } = await supabaseAdmin
      .from('coin_balances')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (error) return res.status(500).json({ error: error.message });
    res.json({ balance: data?.coins || 0 });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/spend', authMiddleware, async (req, res) => {
  try {
    const { assetId, coins } = req.body;
    if (!assetId || !coins) return res.status(400).json({ error: 'Missing params' });
    if (!checkRateLimit(req.user.id, 'purchase')) {
      return res.status(429).json({ error: 'Rate limit' });
    }

    const { data: balanceRow } = await supabaseAdmin
      .from('coin_balances')
      .select('*')
      .eq('user_id', req.user.id)
      .single();
      
    if (!balanceRow || balanceRow.coins < coins) {
      return res.status(400).json({ ok: false, error: 'Insufficient funds' });
    }

    await supabaseAdmin
      .from('coin_balances')
      .update({ coins: balanceRow.coins - coins })
      .eq('user_id', req.user.id);
      
    await supabaseAdmin.from('purchases').insert([{ 
      buyer_id: req.user.id, 
      asset_id: assetId, 
      coins_spent: coins 
    }]);
    
    const bonus = Math.floor(coins * 0.05);
    await supabaseAdmin
      .from('coin_balances')
      .update({ coins: balanceRow.coins - coins + bonus })
      .eq('user_id', req.user.id);
      
    const { data: asset } = await supabaseAdmin
      .from('assets')
      .select('owner_id')
      .eq('id', assetId)
      .single();
      
    if (asset?.owner_id) {
      const { data: creatorBal } = await supabaseAdmin
        .from('coin_balances')
        .select('*')
        .eq('user_id', asset.owner_id)
        .single();
        
      const creatorCoins = (creatorBal?.coins || 0) + coins - bonus;
      await supabaseAdmin
        .from('coin_balances')
        .upsert({ user_id: asset.owner_id, coins: creatorCoins }, { onConflict: ['user_id'] });
    }
    
    return res.json({ ok: true, bonus });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/admin/security-alert', async (req, res) => {
  try {
    const { userId, deviceId, attempts, reason, timestamp, deviceModel, androidVersion } = req.body;
    
    await supabaseAdmin.from('audit_logs').insert([{
      action: 'security_alert',
      actor_id: null,
      target_id: userId,
      meta: JSON.stringify({
        deviceId,
        attempts,
        reason,
        timestamp,
        deviceModel,
        androidVersion
      })
    }]);
    
    console.log('🚨 SECURITY ALERT:', { userId, deviceId, attempts, reason });
    
    res.json({ ok: true, message: 'Alert logged' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api/admin', adminRoutes(supabaseAdmin));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ ByteBikri server running on port ${PORT}`);
});