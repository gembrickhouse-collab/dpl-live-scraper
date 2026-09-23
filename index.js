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

// --- UPSTASH REDIS HELPER ---
async function redisCommand(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([command, ...args]),
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    return null;
  }
}

// 1. INITIAL CALL HANDLER
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const callerId = req.body.From || 'Unknown';

  twiml.say({ voice: 'Polly.Joanna' }, "Connecting to Gemini Live.");

  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.get('host')}/stream?caller=${encodeURIComponent(callerId)}`
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// 2. BIDIRECTIONAL STREAM HANDLER
wss.on('connection', async (twilioWs, req) => {
  console.log('Twilio Media Stream connected');

  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const callerId = urlParams.get('caller') || 'Unknown';

  let streamSid = null;
  let isGeminiReady = false;
  let audioBuffer = []; 
  let twilioOutboundBuffer = Buffer.alloc(0); 

  let pastMemoriesArray = [];
  try {
    const result = await redisCommand('LRANGE', callerId, '0', '-1');
    if (Array.isArray(result)) pastMemoriesArray = result;
  } catch (err) {}
  const pastMemories = pastMemoriesArray.length > 0
    ? pastMemoriesArray.join('. ')
    : 'No previous conversations recorded.';

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
  const geminiWs = new WebSocket(geminiUrl);

  geminiWs.on('open', () => {
    console.log(`Connected to Gemini Live API for ${callerId}`);

    const setupMessage = {
      setup: {
        model: 'models/gemini-3.8-live', 
        systemInstruction: {
          parts: [{
            text: `You are a helpful voice assistant conversing over a phone call with caller ID ${callerId}. Keep responses natural, brief, and conversational. Saved facts from past calls: ${pastMemories}. If the caller shares important personal facts, invoke the save_memory tool. If they ask about the weather, invoke the get_weather tool.`
          }]
        },
        tools: [{
          functionDeclarations: [
            {
              name: 'save_memory',
              description: 'Persist a specific fact about the caller into the database.',
              parameters: {
                type: 'object',
                properties: {
                  fact: { type: 'string', description: 'The exact fact or note to store.' }
                },
                required: ['fact']
              }
            },
            {
              name: 'get_weather',
              description: 'Fetch current weather and temperature for a given location.',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'The city or area to query (e.g., Denver, CO).' }
                },
                required: ['location']
              }
            }
          ]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          }
        }
      }
    };
    geminiWs.send(JSON.stringify(setupMessage));
  });

  geminiWs.on('message', async (data) => {
    let response;
    try { response = JSON.parse(data); } catch (err) { return; }

    if (response.setupComplete) {
      console.log('Gemini Live session ready. Forcing initial greeting.');
      isGeminiReady = true;
      
      geminiWs.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ text: 'System connection successful. Please briefly introduce yourself and let me know you are listening.' }]
          }],
          turnComplete: true
        }
      }));
      return;
    }

    if (response.serverContent?.interrupted) {
      console.log('Gemini detected user interruption. Clearing audio buffer.');
      twilioOutboundBuffer = Buffer.alloc(0);
      return;
    }

    if (response.toolCall) {
      const calls = response.toolCall.functionCalls || [];
      const functionResponses = [];

      for (const call of calls) {
        if (call.name === 'save_memory') {
          const fact = call.args.fact;
          try {
            await redisCommand('RPUSH', callerId, fact);
            functionResponses.push({ id: call.id, name: call.name, response: { status: 'Success. Fact saved permanently.' } });
          } catch (err) {
            functionResponses.push({ id: call.id, name: call.name, response: { error: 'Database fail.' } });
          }
        } else if (call.name === 'get_weather') {
          const location = call.args.location;
          console.log(`Gemini requested weather for: ${location}`); 
          let forecast = `Weather information for ${location} is unavailable.`;
          try {
            const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=%C,+%t+(Feels+like+%f),+Wind:+%w`);
            if (res.ok) {
              const text = await res.text();
              forecast = `Current conditions for ${location}: ${text.trim()}`;
            }
          } catch (err) {}
          functionResponses.push({ id: call.id, name: call.name, response: { forecast } });
        }
      }

      geminiWs.send(JSON.stringify({ toolResponse: { functionResponses } }));
      return;
    }

    // --- AUDIO OUTPUT (Gemini -> Twilio) ---
    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          try {
            const geminiBytes = Buffer.from(part.inlineData.data, 'base64');
            console.log(`[Gemini] Transcoding ${geminiBytes.length} bytes of raw audio.`);
            
            // Mathematically perfect transcoding via wavefile
            const pcm16 = new Int16Array(geminiBytes.buffer, geminiBytes.byteOffset, geminiBytes.byteLength / 2);
            const wav = new WaveFile();
            wav.fromScratch(1, 24000, '16', pcm16);
            wav.toSampleRate(8000);
            wav.toMuLaw();
            
            const muLawBuffer = Buffer.from(wav.data.samples);
            twilioOutboundBuffer = Buffer.concat([twilioOutboundBuffer, muLawBuffer]);
          } catch (err) {
            console.error('Wavefile Outbound Transcode Error:', err);
          }
        }
      }
    }
  });

  geminiWs.on('error', (err) => console.error('Gemini error:', err));

  // --- AUDIO INPUT (Twilio -> Gemini) ---
  twilioWs.on('message', (message) => {
    let msg;
    try { msg = JSON.parse(message); } catch (err) { return; }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        break;

      case 'media':
        if (geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
          try {
            const twilioBytes = Buffer.from(msg.media.payload, 'base64');
            
            const wav = new WaveFile();
            wav.fromScratch(1, 8000, '8m', twilioBytes);
            wav.fromMuLaw();
            wav.toSampleRate(16000);
            wav.toBitDepth('16');
            
            const pcm16 = new Int16Array(wav.data.samples);
            const pcmBuffer = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);

            audioBuffer.push(pcmBuffer);
            
            if (audioBuffer.length >= 5) {
              const combinedBuffer = Buffer.concat(audioBuffer);
              audioBuffer = []; 
              
              geminiWs.send(JSON.stringify({
                realtimeInput: {
                  mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: combinedBuffer.toString('base64') }]
                }
              }));
            }
          } catch (err) {}
        }
        
        // PERFECT PACING: Drain exactly 160 bytes (20ms) per Twilio tick to match real-time playback
        if (streamSid && twilioOutboundBuffer.length >= 160) {
          const frame = twilioOutboundBuffer.subarray(0, 160);
          twilioOutboundBuffer = Buffer.from(twilioOutboundBuffer.subarray(160));
          
          twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: { payload: frame.toString('base64') }
          }));
        }
        break;
        
      case 'stop':
        if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
        break;
    }
  });

  twilioWs.on('close', () => {
    if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice server active on port ${PORT}`);
});
