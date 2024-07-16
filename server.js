require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Function to extract emails from HTML content
const extractEmails = (html) => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const $ = cheerio.load(html);
  const text = $('body').text();
  const foundEmails = text.match(emailRegex);

  return foundEmails ? foundEmails.map(email => email.trim()) : [];
};

// Function to fetch HTML content from a URL
const fetchHtmlContent = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    console.error('Error fetching URL:', error);
    throw error;
  }
};

// Function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Function to remove duplicates from an array
const removeDuplicates = (array) => [...new Set(array)];

// Route to handle email extraction
app.post('/extract-emails', async (req, res) => {
  const { url } = req.body;

  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided.');
    }

    const html = await fetchHtmlContent(url);
    console.log('Fetched HTML content length:', html.length); // Debugging log

    let emails = extractEmails(html);
    console.log('Extracted emails:', emails); // Debugging log

    // Validate emails and remove duplicates
    emails = emails.filter(email => isValidEmail(email));
    emails = removeDuplicates(emails);

    if (emails.length === 0) {
      res.json({ message: 'No valid emails found.' });
    } else {
      // Save emails to CSV
      await saveEmailsToCsv(emails, 'emails.csv');

      // Send full emails.csv to Telegram after saving
      await sendCsvToTelegram('emails.csv');

      res.json({ emails, count: emails.length });
    }
  } catch (error) {
    console.error('Error extracting emails:', error.message);
    res.status(500).send(`Error extracting emails: ${error.message}`);
  }
});

// Function to save emails to CSV
const saveEmailsToCsv = async (emails, filePath) => {
  try {
    const existingEmails = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      fileContent.split(',').forEach(email => {
        if (email.trim()) existingEmails.push(email.trim());
      });
    }

    const allEmails = removeDuplicates([...existingEmails, ...emails]);

    const csv = allEmails.join(',');

    fs.writeFileSync(filePath, csv);
    console.log(`Emails saved to ${filePath}`);
  } catch (error) {
    console.error('Error saving emails to CSV:', error);
    throw error;
  }
};

// Function to send CSV file to Telegram
const sendCsvToTelegram = async (filePath) => {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;

    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('document', fs.createReadStream(filePath));

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        ...formData.getHeaders()
      },
    });

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Telegram API error: ${result.description}`);
    }

    console.log('CSV file sent to Telegram.');
  } catch (error) {
    console.error('Error sending CSV to Telegram:', error.message);
    throw error;
  }
};

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
