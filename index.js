// Add the Twilio client at the top of your file
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.post('/sms', async (req, res) => {
  // 1. Instantly tell Twilio "I received the message" so it doesn't time out
  res.status(200).end();

  const userPhoneNumber = req.body.From;
  const twilioPhoneNumber = req.body.To;
  const searchQuery = req.body.Body;

  // 2. Run your slow scraping logic in the background
  try {
    const libraryResults = await scrapeDPL(searchQuery); 

    // 3. Send the results back as a new outbound message
    await client.messages.create({
      body: libraryResults,
      from: twilioPhoneNumber,
      to: userPhoneNumber
    });
    console.log("Results sent successfully!");
  } catch (error) {
    console.error("Scraping failed:", error);
  }
});
