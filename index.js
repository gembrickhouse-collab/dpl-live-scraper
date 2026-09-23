const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Denver Public Library Scraping Logic
async function scrapeDPL(query) {
  try {
    const url = `https://catalog.denverlibrary.org/Search/Results?lookfor=${encodeURIComponent(query)}&type=AllFields`;
    
    // Add a User-Agent so the library firewall thinks this is a normal person using Chrome
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    
    let results = [];
    $('.title, .result-title').each((i, el) => {
      if (i < 3) { 
        results.push($(el).text().trim().replace(/\s+/g, ' '));
      }
    });

    if (results.length === 0) {
      return `No results found for "${query}" at the Denver Public Library.`;
    }

    return `DPL Results for "${query}":\n\n1. ${results[0] || 'No title extracted'}\n2. ${results[1] || 'No title extracted'}\n3. ${results[2] || 'No title extracted'}`;
  } catch (error) {
    console.error("Scraper error:", error);
    return "Error: Could not reach the library catalog.";
  }
}

// Twilio Webhook Endpoint
app.post('/sms', async (req, res) => {
  res.status(200).end();

  const userPhoneNumber = req.body.From;
  const searchQuery = req.body.Body;

  try {
    const libraryResults = await scrapeDPL(searchQuery); 

    // Send using your A2P-compliant Messaging Service instead of the raw phone number
    await client.messages.create({
      body: libraryResults,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: userPhoneNumber
    });
    console.log("Library results sent successfully!");
  } catch (error) {
    console.error("Failed to send message via Twilio:", error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
