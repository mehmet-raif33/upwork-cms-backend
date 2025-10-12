const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// Health check endpoint
router.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    deployment: {
      platform: 'Railway',
      version: '1.0.0'
    },
    database: 'Connected', // Basit kontrol
    jwt_secret_configured: !!process.env.JWT_SECRET,
    cors_origins: [
      'http://localhost:3000',
      'http://localhost:5173', 
      'http://localhost:3001',
      'https://ulasapp.site',
      'https://ulasserver-production.up.railway.app',
      'https://ulasfront-production.up.railway.app',
      process.env.FRONTEND_URL
    ].filter(Boolean)
  });
});

// Debug endpoint for Railway deployment
router.get('/debug', (req, res) => {
  const envVars = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DB_HOST: process.env.DB_HOST ? '[CONFIGURED]' : '[NOT SET]',
    DB_USER: process.env.DB_USER ? '[CONFIGURED]' : '[NOT SET]',
    DB_PASSWORD: process.env.DB_PASSWORD ? '[CONFIGURED]' : '[NOT SET]',
    DB_NAME: process.env.DB_NAME ? '[CONFIGURED]' : '[NOT SET]',
    JWT_SECRET: process.env.JWT_SECRET ? '[CONFIGURED]' : '[NOT SET]',
    FRONTEND_URL: process.env.FRONTEND_URL || '[NOT SET]'
  };

  res.json({
    status: 'Debug Info',
    timestamp: new Date().toISOString(),
    environment_variables: envVars,
    server_info: {
      uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      platform: process.platform,
      node_version: process.version
    }
  });
});

// Veritabanı verilerini kontrol et
router.get('/data-check', (req, res) => {
  pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM vehicles) as vehicle_count,
      (SELECT COUNT(*) FROM personnel) as personnel_count,
      (SELECT COUNT(*) FROM transaction_categories) as category_count
  `, (err, results) => {
    if (err) {
      console.error('Data check MySQL hatası:', err.message);
      return res.status(500).json({ 
        status: 'error', 
        error: err.message
      });
    }
    
    res.json({ 
      status: 'ok', 
      data: results[0],
      timestamp: new Date().toISOString()
    });
  });
});

// Araçları listele
router.get('/vehicles', (req, res) => {
  pool.query('SELECT plate, year, customer_email, customer_phone, created_at FROM vehicles LIMIT 10', (err, results) => {
    if (err) {
      console.error('Vehicles check MySQL hatası:', err.message);
      return res.status(500).json({ 
        status: 'error', 
        error: err.message
      });
    }
    
    res.json({ 
      status: 'ok', 
      data: results,
      count: results.length,
      timestamp: new Date().toISOString()
    });
  });
});

// Personeli listele
router.get('/personnel', (req, res) => {
  pool.query('SELECT id, full_name, email, status, is_active FROM personnel LIMIT 10', (err, results) => {
    if (err) {
      console.error('Personnel check MySQL hatası:', err.message);
      return res.status(500).json({ 
        status: 'error', 
        error: err.message
      });
    }
    
    res.json({ 
      status: 'ok', 
      data: results,
      count: results.length,
      timestamp: new Date().toISOString()
    });
  });
});

// Kategorileri listele
router.get('/categories', (req, res) => {
  pool.query('SELECT id, name FROM transaction_categories LIMIT 10', (err, results) => {
    if (err) {
      console.error('Categories check MySQL hatası:', err.message);
      return res.status(500).json({ 
        status: 'error', 
        error: err.message
      });
    }
    
    res.json({ 
      status: 'ok', 
      data: results,
      count: results.length,
      timestamp: new Date().toISOString()
    });
  });
});

module.exports = router; 