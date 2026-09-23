const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Twilio Client using Render Environment Variables
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Denver Public Library Scraping Logic
async function scrapeDPL(query) {
  try {
    // Search the actual DPL catalog
    const url = `https://catalog.denverlibrary.org/Search/Results?lookfor=${encodeURIComponent(query)}&type=AllFields`;
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    let results = [];
    
    // DPL's catalog uses specific classes for titles. 
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
  // 1. Instantly acknowledge the request so Twilio doesn't time out after 15 seconds
  res.status(200).end();

  const userPhoneNumber = req.body.From;
  const twilioPhoneNumber = req.body.To;
  const searchQuery = req.body.Body;

  // 2. Run the scraper in the background
  try {
    const libraryResults = await scrapeDPL(searchQuery); 

    // 3. Send the results back to the user as a new outbound text message
    await client.messages.create({
      body: libraryResults,
      from: twilioPhoneNumber,
      to: userPhoneNumber
    });
    console.log("Library results sent successfully!");
  } catch (error) {
    console.error("Failed to send message via Twilio:", error);
  }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
