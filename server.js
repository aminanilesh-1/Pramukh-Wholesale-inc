const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const PDFDocument = require('pdfkit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pramukh_wholesale';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// 1. Settings Schema
const settingsSchema = new mongoose.Schema({
  adminEmail: { type: String, default: 'Anileshamin@hotmail.com' },
  businessName: { type: String, default: 'Pramukh Wholesale Inc.' },
  interacEmail: { type: String, default: 'payments@pramukhwholesale.ca' },
  wmsApiKey: { type: String, default: 'WMS_SYNC_TOKEN_SECURE_2026' }
});
const Settings = mongoose.model('Settings', settingsSchema);

async function initSettings() {
  const count = await Settings.countDocuments();
  if (count === 0) {
    await Settings.create({ adminEmail: 'Anileshamin@hotmail.com' });
  }
}
initSettings();

// 2. Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true }, // 'plates', 'bowls', 'containers', 'paper-bags', 'tissue-papers'
  material: { type: String, required: true }, // 'Bagasse', 'Paper', 'Plastic (RPET/PP)'
  size: { type: String, required: true },
  priceCAD: { type: Number, required: true },
  sku: { type: String, required: true, unique: true },
  imageUrl: { type: String, default: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&auto=format&fit=crop' },
  stockQty: { type: Number, default: 100 },
  inStock: { type: Boolean, default: true }
});
const Product = mongoose.model('Product', productSchema);

// 3. Order Schema
const orderSchema = new mongoose.Schema({
  businessName: String,
  contactName: String,
  email: String,
  phone: String,
  address: String,
  itemsOrdered: Array,
  totalCAD: Number,
  paymentType: String,
  paymentMethod: String,
  paymentStatus: { type: String, default: 'Pending Verification' },
  fulfillmentStatus: { type: String, default: 'Pending Warehouse Packing' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// Email Notification Helper
async function sendOrderNotification(orderData) {
  const currentSettings = await Settings.findOne();
  const recipientEmail = currentSettings ? currentSettings.adminEmail : 'Anileshamin@hotmail.com';

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER || 'Anileshamin@hotmail.com',
      pass: process.env.EMAIL_PASS || 'your_gmail_app_password'
    }
  });

  const itemSummary = orderData.itemsOrdered.map(item => 
    `- ${item.name} [${item.material} | ${item.size}] x ${item.quantity} case(s) @ $${item.priceCAD} CAD/ea`
  ).join('\n');

  const mailOptions = {
    from: process.env.EMAIL_USER || 'Anileshamin@hotmail.com',
    to: recipientEmail,
    subject: `🚨 NEW WHOLESALE ORDER [${orderData.paymentType}]: ${orderData.businessName}`,
    text: `NEW ORDER RECEIVED - PRAMUKH WHOLESALE INC.

CLIENT DETAILS:
- Business Name: ${orderData.businessName}
- Contact Person: ${orderData.contactName}
- Email: ${orderData.email}
- Phone: ${orderData.phone}
- Delivery Address: ${orderData.address}

PAYMENT DETAILS:
- Account Type: ${orderData.paymentType}
- Selected Method: ${orderData.paymentMethod}
- Total Amount: $${orderData.totalCAD.toFixed(2)} CAD

ORDER BREAKDOWN:
${itemSummary}`
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order notification emailed to ${recipientEmail}`);
  } catch (err) {
    console.error('Email Delivery Error:', err);
  }
}

// --- API ROUTES ---

// Fetch Catalog
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({});
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Order
app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;
    for (let item of orderData.itemsOrdered) {
      const prod = await Product.findById(item._id);
      if (prod && prod.stockQty < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${prod.name}` });
      }
    }

    const newOrder = new Order(orderData);
    await newOrder.save();

    for (let item of orderData.itemsOrdered) {
      const prod = await Product.findById(item._id);
      if (prod) {
        const updatedQty = prod.stockQty - item.quantity;
        await Product.findByIdAndUpdate(item._id, {
          stockQty: updatedQty,
          inStock: updatedQty > 0
        });
      }
    }

    sendOrderNotification(orderData);
    res.json({ success: true, orderId: newOrder._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PDF Packing Slip Endpoint
app.get('/api/orders/:id/pdf', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).send('Order not found');

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=PackingSlip-${order._id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text('PRAMUKH WHOLESALE INC.', { align: 'center' });
    doc.fontSize(10).text('Toronto, ON Distribution Hub | Packing Slip', { align: 'center' });
    doc.moveDown();
    doc.text(`Business Name: ${order.businessName}`);
    doc.text(`Contact: ${order.contactName}`);
    doc.text(`Delivery Address: ${order.address}`);
    doc.moveDown();
    doc.text('Items to Pack:');
    order.itemsOrdered.forEach(item => {
      doc.text(`- ${item.name} [${item.material} | ${item.size}] x ${item.quantity} case(s)`);
    });
    doc.end();
  } catch (err) {
    res.status(500).send('Error generating PDF');
  }
});

// Admin Auth & Management
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'pramukh2026')) {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false, error: 'Invalid password' });
  }
});

app.post('/api/admin/products', async (req, res) => {
  try {
    const productData = req.body;
    productData.inStock = productData.stockQty > 0;
    const prod = new Product(productData);
    await prod.save();
    res.json({ success: true, product: prod });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:id', async (req, res) => {
  try {
    const productData = req.body;
    productData.inStock = productData.stockQty > 0;
    const updated = await Product.findByIdAndUpdate(req.params.id, productData, { new: true });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/settings', async (req, res) => {
  const settings = await Settings.findOne();
  res.json(settings);
});

app.put('/api/admin/settings', async (req, res) => {
  try {
    const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  const orders = await Order.find({}).sort({ createdAt: -1 });
  res.json(orders);
});

// WMS Endpoint
app.get('/api/wms/inventory', async (req, res) => {
  const inventory = await Product.find({}, 'sku name stockQty inStock category');
  res.json({ warehouseHub: 'Toronto, ON', inventory });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Pramukh Wholesale App running on port ${PORT}`));
