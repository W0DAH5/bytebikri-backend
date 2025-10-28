const express = require('express');

module.exports = function(supabaseAdmin) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'admin required' });
    next();
  });

  router.get('/flagged', async (req, res) => {
    const { data, error } = await supabaseAdmin.from('assets').select('*').eq('flagged', true);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ assets: data });
  });

  router.post('/ban', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const { data, error } = await supabaseAdmin.from('profiles').update({ banned: true }).eq('id', userId);
    if (error) return res.status(500).json({ error: error.message });
    await supabaseAdmin.from('audit_logs').insert([{ action:'ban', target_id: userId, actor_id: req.user.id }]);
    res.json({ ok:true, data });
  });

  router.post('/unflag', async (req, res) => {
    const { assetId } = req.body;
    if (!assetId) return res.status(400).json({ error: 'assetId required' });
    const { data, error } = await supabaseAdmin.from('assets').update({ flagged:false }).eq('id', assetId);
    if (error) return res.status(500).json({ error: error.message });
    await supabaseAdmin.from('audit_logs').insert([{ action:'unflag', target_id: assetId, actor_id: req.user.id }]);
    res.json({ ok:true, data });
  });

  router.post('/remove', async (req, res) => {
    const { assetId } = req.body;
    if (!assetId) return res.status(400).json({ error: 'assetId required' });
    const { error } = await supabaseAdmin.from('assets').delete().eq('id', assetId);
    if (error) return res.status(500).json({ error: error.message });
    await supabaseAdmin.from('audit_logs').insert([{ action:'remove', target_id: assetId, actor_id: req.user.id }]);
    res.json({ ok:true });
  });

  router.get('/logs', async (req, res) => {
    const { data, error } = await supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending:false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: data });
  });

  return router;
};