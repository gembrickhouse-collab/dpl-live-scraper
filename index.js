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
// Instead of <Gather>, we immediately connect the call to a WebSocket stream.
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, "Terminal connected. Connecting to Gemini Live Engine.");
  
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

  // 3. OPEN THE GEMINI LIVE API CONNECTION
  // We use the v1beta BidiGenerateContent endpoint specifically for WebSocket streaming
  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
  const geminiWs = new WebSocket(geminiUrl);

  geminiWs.on('open', () => {
    console.log("Connected to Gemini Live API");
    // Send the initial setup configuration required by Gemini
    const setupMessage = {
      setup: {
        model: "models/gemini-2.0-flash-exp", // The Live API currently runs on the experimental model
        generation_config: {
          response_modalities: ["AUDIO"], // Force the model to natively generate audio
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
    
    if (response.serverContent && response.serverContent.modelTurn) {
      const parts = response.serverContent.modelTurn.parts;
      for (let part of parts) {
        if (part.inlineData && part.inlineData.data) {
          try {
            // Gemini sends 24kHz 16-bit PCM. Twilio needs 8kHz 8-bit mu-law.
            const geminiAudioBase64 = part.inlineData.data;
            const wav = new WaveFile();
            
            // Read Gemini's PCM data
            wav.fromScratch(1, 24000, '16', Buffer.from(geminiAudioBase64, 'base64'));
            // Resample down to telephone quality
            wav.toSampleRate(8000);
            // Encode to mu-law
            wav.toMuLaw();
            
            const twilioPayload = Buffer.from(wav.data.samples).toString('base64');

            // Send transcoded chunk to Twilio
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

  // 5. HANDLE AUDIO COMING FROM TWILIO -> GEMINI
  twilioWs.on('message', (message) => {
    const msg = JSON.parse(message);
    
    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        console.log(`Stream started: ${streamSid}`);
        break;
        
      case 'media':
        if (geminiWs.readyState === WebSocket.OPEN) {
          try {
            // Twilio sends 8kHz 8-bit mu-law. Gemini needs 16kHz 16-bit PCM.
            const twilioAudioBase64 = msg.media.payload;
            const wav = new WaveFile();
            
            // Read Twilio's mu-law data
            wav.fromScratch(1, 8000, '8m', Buffer.from(twilioAudioBase64, 'base64'));
            // Decode to PCM
            wav.fromMuLaw();
            // Resample up to Gemini's expected rate
            wav.toSampleRate(16000);
            
            // The wav.data.samples array is now 16-bit PCM data. 
            // We must convert it to a true Uint8Array buffer before base64 encoding it.
            const pcmData = new Int16Array(wav.data.samples);
            const geminiPayload = Buffer.from(pcmData.buffer).toString('base64');

            // Send transcoded chunk to Gemini
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
  
  geminiWs.on('close', () => {
     console.log('Gemini disconnected.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Live Multimodal Server online on port ${PORT}`);
});
