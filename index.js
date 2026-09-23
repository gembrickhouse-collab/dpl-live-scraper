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
      
      const prompt = `${userSpeech} (Keep your answer conversational, natural, and brief, as this is being read over a live phone call.)`;
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
      
      const gather = twiml.gather({
        input: 'speech',
        action: '/voice',
        speechTimeout: 'auto'
      });
      gather.say({ voice: 'Polly.Joanna' }, "I didn't quite catch that. Could you please repeat your question?");
    }
  } else {
    // Initial greeting introducing itself and asking for the caller's identity
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      speechTimeout: 'auto'
    });
    gather.say(
      { voice: 'Polly.Joanna' },
      "Hello! I am your AI assistant. May I ask who is calling, and how can I help you today?"
    );
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice AI Server online on port ${PORT}`);
});
