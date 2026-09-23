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
    
    console.log("Establishing session with library server...");
    await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    console.log(`Searching for: ${cleanQuery}`);
    const searchUrl = `https://catalog.denverlibrary.org/search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(cleanQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    
    // THE ULTIMATE INSPECTOR: Grab every link's text, ID, and Class
    const linkMap = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .filter(a => a.innerText.trim().length > 0)
        .map(a => `[TEXT: ${a.innerText.trim().replace(/\n/g, ' ').substring(0, 40)}] [ID: ${a.id}] [CLASS: ${a.className}]`)
        .join('\n');
    });

    console.log(`\n--- DOM LINK MAP FOR "${cleanQuery}" ---`);
    console.log(linkMap.substring(0, 4000)); 
    console.log(`--------------------------------------\n`);

    await browser.close();

    // Send a temporary diagnostic text to your phone
    return `Diagnostic run complete for "${cleanQuery}". Check the Render logs!`;
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
    console.log("Diagnostic message sent successfully!");
  } catch (error) {
    console.error("Failed to send message via Twilio:", error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
