const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/sms', async (req, res) => {
  // Acknowledge receipt immediately to prevent Twilio from timing out
  res.status(200).end();
  
  const userPhoneNumber = req.body.From;
  const userMessage = req.body.Body;

  console.log(`Incoming SMS: ${userMessage}`);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(userMessage);
    const responseText = result.response.text();

    await twilioClient.messages.create({
      // Truncate at 1500 chars to avoid carrier delivery limits on long texts
      body: responseText.substring(0, 1500), 
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: userPhoneNumber
    });
    
    console.log("AI response dispatched to carrier network.");
  } catch (error) {
    console.error("Pipeline failure:", error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Server online on port ${PORT}`);
});
