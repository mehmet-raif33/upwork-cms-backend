require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./config/db');
const app = express();

// Pool'u app.locals'a ekle
//dssd
app.locals.pool = pool;

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    'https://ulasapp.site', // Yeni frontend domain (trailing slash olmadan)
    'https://www.ulasapp.site', // www ile de ekleyelim
    process.env.FRONTEND_URL, // Environment variable'dan al
    // Wildcard için (güvenlik açısından dikkatli kullanın)
    // 'https://*.railway.app',
    // 'https://*.vercel.app'
  ].filter(Boolean), // undefined değerleri filtrele
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());

// Route'ları dahil et
const indexRoutes = require('./routes/index');
const userRoutes = require('./routes/user');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const transactionCategoriesRoutes = require('./routes/transactionCategories');
const vehiclesRoutes = require('./routes/vehicles');
const personnelRoutes = require('./routes/personnel');
const transactionsRoutes = require('./routes/transactions');
const activitiesRoutes = require('./routes/activities');
const testRoutes = require('./routes/test');

// Yeni ayrılmış route'lar
const profitRoutes = require('./routes/profit');
const revenueRoutes = require('./routes/revenue');
//sdfds
app.use('/', indexRoutes);
app.use('/api/user', userRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/transaction-categories', transactionCategoriesRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/transactions', transactionsRoutes);  
app.use('/api/activities', activitiesRoutes);
app.use('/api/test', testRoutes);

// Yeni ayrılmış endpoint'ler
app.use('/api/profit', profitRoutes);   // Kar hesaplama endpoint'leri
app.use('/api/revenue', revenueRoutes); // Ciro hesaplama endpoint'leri

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log('📊 Profit routes: /profit/daily, /profit/weekly, /profit/monthly, /profit/yearly');
  console.log('💰 Revenue routes: /revenue/daily, /revenue/weekly, /revenue/monthly, /revenue/yearly');
});