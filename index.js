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
    
    // Click availability button and wait for dynamic elements to populate
    try {
      await page.click('#buttonAvailability_1');
      await new Promise(resolve => setTimeout(resolve, 2500));
    } catch (e) {
      // Continue even if button is absent
    }

    const items = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('.c-title-detail__container, .nsm-brief-action-link');
      
      // Fallback extraction pairing titles with availability spans
      const titleEls = Array.from(document.querySelectorAll('.nsm-brief-action-link')).slice(0, 3);
      
      titleEls.forEach((titleEl, idx) => {
        const title = titleEl.innerText.trim().replace(/\s+/g, ' ');
        
        // Find the nearest container or secondary zone holding copy counts
        let container = titleEl.closest('.c-title-detail__container') || titleEl.parentElement;
        for (let i = 0; i < 4 && container && !container.classList.contains('c-title-detail__container'); i++) {
          if (container.parentElement) container = container.parentElement;
        }

        let copiesText = 'Availability not listed';
        if (container) {
          const availEl = container.querySelector('.nsm-brief-secondary-zone, .nsm-brief-standard-group');
          if (availEl && availEl.innerText.toLowerCase().includes('copies')) {
            copiesText = availEl.innerText.trim().replace(/\s+/g, ' ');
          } else {
            const match = container.innerText.match(/Available Copies:\s*\d+\s*\(of\s*\d+\)/i);
            if (match) copiesText = match[0];
          }
        }

        results.push(`${idx + 1}. ${title}\n   [${copiesText}]`);
      });

      return results;
    });

    await browser.close();

    if (items.length === 0) return `No results found for "${cleanQuery}".`;
    return `DPL Search for "${cleanQuery}":\n\n${items.join('\n\n')}`;
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
    console.log("Scrape message dispatched to Twilio!");
  } catch (error) {
    console.error("Failed to send message via Twilio:", error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Library scraper online on port ${PORT}`);
});
