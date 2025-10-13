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
    'https://ulasapp.site',
    'https://ulasserver-production.up.railway.app',
    'https://ulasfront-production.up.railway.app', // Yeni frontend domain
    // Yeni domain'i buraya ekleyin
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

app.use('/', indexRoutes);
app.use('/user', userRoutes);
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/transaction-categories', transactionCategoriesRoutes);
app.use('/vehicles', vehiclesRoutes);
app.use('/personnel', personnelRoutes);
app.use('/transactions', transactionsRoutes);  
app.use('/activities', activitiesRoutes);
app.use('/test', testRoutes);

// Yeni ayrılmış endpoint'ler
app.use('/profit', profitRoutes);   // Kar hesaplama endpoint'leri
app.use('/revenue', revenueRoutes); // Ciro hesaplama endpoint'leri

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log('📊 Profit routes: /profit/daily, /profit/weekly, /profit/monthly, /profit/yearly');
  console.log('💰 Revenue routes: /revenue/daily, /revenue/weekly, /revenue/monthly, /revenue/yearly');
});