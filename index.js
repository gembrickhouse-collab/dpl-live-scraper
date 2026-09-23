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
    
    console.log("Clicking the availability button...");
    try {
      await page.click('#buttonAvailability_1');
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
      console.log("Could not find or click the availability button.");
    }
    
    // THE ULTIMATE AVAILABILITY HUNTER
    const diagnosticData = await page.evaluate(() => {
      let findings = [];
      const allElements = document.querySelectorAll('*');
      
      for (let el of allElements) {
        // Filter for specific text nodes to keep the log clean
        if (el.children.length < 5 && el.className && typeof el.className === 'string') {
          const text = el.innerText ? el.innerText.trim().replace(/\n/g, ' ') : '';
          const lowerText = text.toLowerCase();
          
          // Hunt for words that indicate library stock anywhere on the page
          if (lowerText.includes('copies') || lowerText.includes('available') || lowerText.includes('call number') || lowerText.includes('shelf')) {
            if (text.length > 0 && text.length < 150) { 
               findings.push(`[CLASS: ${el.className.trim()}] TEXT: ${text}`);
            }
          }
        }
      }
      return `--- AVAILABILITY HUNTER ---\n${[...new Set(findings)].join('\n')}`;
    });

    console.log(`\n${diagnosticData}\n`);

    await browser.close();
    return `Hunter diagnostic complete for "${cleanQuery}". Check the Render logs!`;
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

app.listen(process.env.PORT || 3000, () => console.log('Server Online'));
