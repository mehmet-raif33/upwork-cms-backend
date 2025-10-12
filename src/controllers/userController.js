exports.getUser = (req, res) => {
  res.json({ id: 1, name: 'Test User' });
};

exports.getAllUsers = (req, res) => {
  const { pool } = require('../config/db');
  pool.promise().query('SELECT id, username, email, role, is_active, full_name FROM personnel')
    .then(([rows]) => res.json(rows))
    .catch(err => {
      console.error('Kullanıcı listesi hatası:', err);
      res.status(500).json({ message: 'Kullanıcılar alınamadı.' });
    });
}; 