const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/contact', async (req, res) => {
  const { name, email, phone, businessName, message, items } = req.body;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: `New B2B Inquiry from ${businessName || name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nBusiness: ${businessName || 'N/A'}\n\nMessage:\n${message}`
  };

  try {
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      await transporter.sendMail(mailOptions);
    }
    res.status(200).json({ success: true, message: 'Inquiry received!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send inquiry.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
