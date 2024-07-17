require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// User-Agent pool
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.0) Gecko/20100101 Firefox/84.0',
  // Add more user-agents as needed
];

// Rate limiting variables
let requestCount = 0;
const MAX_REQUESTS_PER_MINUTE = 60;
let lastReset = Math.floor(Date.now() / 60000); // Start of current minute in milliseconds

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

// Function to fetch HTML content from a URL with random User-Agent header
const fetchHtmlContent = async (url) => {
  try {
    // Randomly select a user-agent from the pool
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    const response = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent,
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    console.error('Error fetching URL:', error);
    throw error;
  }
};

// Function to generate a random app name
const generateRandomAppName = () => {
  const randomString = crypto.randomBytes(4).toString('hex');
  return `MyApp-${randomString}`;
};

// Function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Function to remove duplicates from an array
const removeDuplicates = (array) => [...new Set(array)];

// Route to handle email extraction with rate limiting
app.post('/extract-emails', async (req, res) => {
  const { url } = req.body;

  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided.');
    }

    // Rate limiting logic
    const currentMinute = Math.floor(Date.now() / 60000);
    if (currentMinute > lastReset) {
      lastReset = currentMinute;
      requestCount = 0;
    }

    if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    requestCount++;

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
