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
    
    // NEW: Force the browser to click the "Where is it?" button
    console.log("Clicking the availability button...");
    try {
      await page.click('#buttonAvailability_1');
      // Wait 2 seconds for the hidden inventory drawer to slide open
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.log("Could not find or click the availability button.");
    }
    
    // THE AVAILABILITY INSPECTOR (Round 2)
    const diagnosticData = await page.evaluate(() => {
      const firstTitle = document.querySelector('.nsm-brief-action-link');
      if (!firstTitle) return "No titles found.";

      // Go up 4 levels to grab the whole "book card" container
      let container = firstTitle.parentElement;
      for (let i = 0; i < 4; i++) {
        if (container.parentElement) container = container.parentElement;
      }

      // Map out every class and the newly revealed text inside it
      let elementsMap = [];
      const elements = container.querySelectorAll('*');
      for (let el of elements) {
        if (el.className && typeof el.className === 'string') {
          const text = el.innerText ? el.innerText.trim().replace(/\n/g, ' ').substring(0, 60) : '';
          if (text.length > 0 && text.length < 60) { 
             elementsMap.push(`[CLASS: ${el.className.trim()}] TEXT: ${text}`);
          }
        }
      }
      
      // Expanded the raw text grab to 500 characters to catch the drawer contents
      return `--- EXPANDED CARD TEXT ---\n${container.innerText.substring(0, 500)}\n\n--- CLASS MAP ---\n${[...new Set(elementsMap)].join('\n')}`;
    });

    console.log(`\n--- AVAILABILITY DIAGNOSTIC ---`);
    console.log(diagnosticData);
    console.log(`-------------------------------\n`);

    await browser.close();

    return `Expanded diagnostic complete for "${cleanQuery}". Check the Render logs!`;
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
