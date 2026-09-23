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
    // .trim() removes accidental trailing spaces from the text message
    const cleanQuery = query.trim(); 
    const url = `https://catalog.denverlibrary.org/search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(cleanQuery)}`;
    
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    
    // NEW: Extract only the readable text from links to bypass the invisible HTML <head> code
    const allLinks = $('a').map((i, el) =>$(el).text().trim()).get().filter(text => text.length > 3);
    console.log(`--- VISIBLE LINKS FOR "${cleanQuery}" ---`);
    console.log(allLinks.slice(0, 40).join(' | ')); 
    console.log(`--------------------------------------`);
    
    let results = [];
    
    // Broadened the search net to catch anything that looks like a Polaris title link
    $('a[id*="Title"], a[id*="title"], .ns-title, .title').each((i, el) => {
      const titleText = $(el).text().trim().replace(/\s+/g, ' ');
      if (titleText && !results.includes(titleText) && results.length < 3) { 
        results.push(titleText);
      }
    });

    if (results.length === 0) {
      return `No results found for "${cleanQuery}" at the Denver Public Library.`;
    }

    return `DPL Results for "${cleanQuery}":\n\n1. ${results[0] || ''}\n2. ${results[1] || ''}\n3. ${results[2] || ''}`;
  } catch (error) {
    console.error("Scraper error:", error.message);
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
