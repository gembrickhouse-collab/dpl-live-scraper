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
    
    await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    const searchUrl = `https://catalog.denverlibrary.org/search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(cleanQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    
    const results = await page.evaluate(() => {
      let titles = [];
      const elements = document.querySelectorAll('.nsm-brief-action-link');
      for (let el of elements) {
        const text = el.innerText.trim().replace(/\s+/g, ' ');
        if (text && !titles.includes(text) && titles.length < 3) {
          titles.push(text);
        }
      }
      return titles;
    });

    await browser.close();

    if (results.length === 0) return `No results found for "${cleanQuery}".`;
    return `DPL Results for "${cleanQuery}":\n\n1. ${results[0] || ''}\n2. ${results[1] || ''}\n3. ${results[2] || ''}`;
    
  } catch (error) {
    if (browser) await browser.close();
    console.error("Scraper error:", error.message);
    return "Error: Could not reach the library catalog.";
  }
}

app.post('/sms', async (req, res) => {
  res.status(200).end();
  
  try {
    const libraryResults = await scrapeDPL(req.body.Body); 
    await client.messages.create({
      body: libraryResults,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: req.body.From
    });
  } catch (error) {
    console.error("Twilio error:", error);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Library Server Online'));
