const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const VoiceResponse = twilio.twiml.VoiceResponse;

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const userSpeech = req.body.SpeechResult;

  if (userSpeech) {
    console.log(`Heard: ${userSpeech}`);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
      
      // We append a hidden instruction so the AI keeps responses brief for a phone call
      const prompt = userSpeech + " (Keep your answer conversational and brief, I am listening to this on a phone call.)";
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const gather = twiml.gather({
        input: 'speech',
        action: '/voice',
        speechTimeout: 'auto'
      });
      gather.say({ voice: 'Polly.Joanna' }, responseText);

    } catch (error) {
      console.error("AI Error:", error);
      twiml.say("My system encountered an error. Please try again.");
      twiml.hangup();
    }
  } else {
    // Initial greeting when the call connects
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      speechTimeout: 'auto'
    });
    gather.say({ voice: 'Polly.Joanna' }, "Hello Keyshawn, I am online. What's on your mind?");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice AI Server online on port ${PORT}`);
});
