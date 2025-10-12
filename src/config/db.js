const mysql = require('mysql2');
require('dotenv').config();

// Ortama göre veritabanı ayarlarını seç
let dbConfig;
if (process.env.NODE_ENV === 'production') {
  // Production (server) veritabanı ayarları
  dbConfig = {
    host: process.env.PROD_MYSQLHOST,
    user: process.env.PROD_MYSQLUSER,
    password: process.env.PROD_MYSQLPASSWORD,
    database: process.env.PROD_MYSQL_DATABASE,
    port: process.env.PROD_MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
} else {
  // Development (local) veritabanı ayarları
  dbConfig = {
    host: process.env.DEV_MYSQLHOST || 'localhost',
    user: process.env.DEV_MYSQLUSER || 'root',
    password: process.env.DEV_MYSQLPASSWORD || '',
    database: process.env.DEV_MYSQL_DATABASE || 'test',
    port: process.env.DEV_MYSQLPORT || 3306
  };
}

// Connection pool oluştur
const pool = mysql.createPool(dbConfig);
const promisePool = pool.promise();

// Bağlantı testi
pool.getConnection((err, connection) => {
  if (err) {
    console.error('MySQL bağlantı hatası:', err.message);
    return;
  }
  console.log('MySQL veritabanına başarıyla bağlandı');
  connection.release();
});

module.exports = { pool, promisePool }; 