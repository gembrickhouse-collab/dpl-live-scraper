const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const { WaveFile } = require('wavefile');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stream' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 1. THE INITIAL CALL HANDLER
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, "Terminal connected. Connecting to Gemini live engine.");
  
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.get('host')}/stream`, 
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// 2. THE WEBSOCKET SERVER
wss.on('connection', (twilioWs) => {
  console.log('Twilio Media Stream Connected');
  let streamSid = null;
  let isGeminiReady = false; // THE FIX: Gatekeeper flag

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
  const geminiWs = new WebSocket(geminiUrl);

  geminiWs.on('open', () => {
    console.log("Connected to Gemini Live API. Sending setup...");
    const setupMessage = {
      setup: {
        model: "models/gemini-2.0-flash-exp",
        generation_config: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: { prebuilt_voice_config: { voice_name: "Puck" } }
          }
        }
      }
    };
    geminiWs.send(JSON.stringify(setupMessage));
  });

  // 4. HANDLE AUDIO COMING FROM GEMINI -> TWILIO
  geminiWs.on('message', (data) => {
    const response = JSON.parse(data);
    
    // Check if Gemini finished setting up
    if (response.setupComplete) {
      console.log("Gemini setup complete! Ready to receive audio.");
      isGeminiReady = true;
      return;
    }
    
    if (response.serverContent && response.serverContent.modelTurn) {
      const parts = response.serverContent.modelTurn.parts;
      for (let part of parts) {
        if (part.inlineData && part.inlineData.data) {
          try {
            const geminiAudioBase64 = part.inlineData.data;
            const wav = new WaveFile();
            
            wav.fromScratch(1, 24000, '16', Buffer.from(geminiAudioBase64, 'base64'));
            wav.toSampleRate(8000);
            wav.toMuLaw();
            
            const twilioPayload = Buffer.from(wav.data.samples).toString('base64');

            if (streamSid) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: twilioPayload }
              }));
            }
          } catch (err) {
            console.error("Transcoding error (Gemini -> Twilio):", err);
          }
        }
      }
    }
  });

  geminiWs.on('error', (error) => {
    console.error("CRITICAL GEMINI ERROR:", error);
  });

  // 5. HANDLE AUDIO COMING FROM TWILIO -> GEMINI
  twilioWs.on('message', (message) => {
    const msg = JSON.parse(message);
    
    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        console.log(`Stream started: ${streamSid}`);
        break;
        
      case 'media':
        // THE FIX: Do not send audio until Gemini says setupComplete
        if (geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
          try {
            const twilioAudioBase64 = msg.media.payload;
            const wav = new WaveFile();
            
            wav.fromScratch(1, 8000, '8m', Buffer.from(twilioAudioBase64, 'base64'));
            wav.fromMuLaw();
            wav.toSampleRate(16000);
            
            const pcmData = new Int16Array(wav.data.samples);
            const geminiPayload = Buffer.from(pcmData.buffer).toString('base64');

            geminiWs.send(JSON.stringify({
              realtimeInput: {
                mediaChunks: [{
                  mimeType: "audio/pcm;rate=16000",
                  data: geminiPayload
                }]
              }
            }));
          } catch (err) {
             console.error("Transcoding error (Twilio -> Gemini):", err);
          }
        }
        break;
        
      case 'stop':
        console.log(`Twilio stream ${streamSid} ended.`);
        geminiWs.close();
        break;
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio disconnected.');
    geminiWs.close();
  });
  
  geminiWs.on('close', (code, reason) => {
     console.log(`Gemini disconnected. Code: ${code}, Reason: ${reason}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Live Multimodal Server online on port ${PORT}`);
});
