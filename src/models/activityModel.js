const { pool } = require('../config/db');

const Activity = {
  create: (personnelId, action, meta = null) => {
    return pool.promise().query(
      'INSERT INTO activities (personnel_id, action, meta) VALUES (?, ?, ?)',
      [personnelId, action, meta ? JSON.stringify(meta) : null]
    ).then(([result]) => result.insertId);
  },
  getRecent: (limit = 20) => {
    return pool.promise().query(
      `SELECT a.*, p.full_name as user_name FROM activities a
       LEFT JOIN personnel p ON a.personnel_id = p.id
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [limit]
    ).then(([results]) => results);
  },
  getByPersonnelId: (personnelId, limit = 20) => {
    return pool.promise().query(
      `SELECT a.*, p.full_name as user_name FROM activities a
       LEFT JOIN personnel p ON a.personnel_id = p.id
       WHERE a.personnel_id = ?
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [personnelId, limit]
    ).then(([results]) => results);
  }
};

module.exports = Activity; 