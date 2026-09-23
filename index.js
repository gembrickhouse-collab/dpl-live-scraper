const express = require('express');
const twilio = require('twilio');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function scrapeDPL(query) {
  const cleanQuery = query.trim();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
    
    // STEP 1: Visit the homepage first to establish a secure session cookie
    console.log("Establishing session with library server...");
    await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // STEP 2: Navigate to the actual search results
    console.log(`Searching for: ${cleanQuery}`);
    const searchUrl = `https://catalog.denverlibrary.org/search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(cleanQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    
    const results = await page.evaluate(() => {
      let titles = [];
      // Target the exact anchor link IDs that Polaris uses for book titles, ignoring the sidebar
      const elements = document.querySelectorAll('a[id*="lnkTitle"]');
      for (let el of elements) {
        const text = el.innerText.trim().replace(/\s+/g, ' ');
        if (text && !titles.includes(text) && titles.length < 3) {
          titles.push(text);
        }
      }
      return titles;
    });

    await browser.close();

    if (results.length === 0) {
      return `No results found for "${cleanQuery}" at the Denver Public Library.`;
    }

    return `DPL Results for "${cleanQuery}":\n\n1. ${results[0] || ''}\n2. ${results[1] || ''}\n3. ${results[2] || ''}`;
  } catch (error) {
    if (browser) await browser.close();
    console.error("Scraper error:", error.message);
    return "Error: Could not reach the library catalog.";
  }
}

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
