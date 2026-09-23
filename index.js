const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stream' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- AUDIO TRANSCODING TABLES & FUNCTIONS ---
const muLawToPcm = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xFF;
  let sign = (mu & 0x80) ? -1 : 1;
  let exponent = (mu & 0x70) >> 4;
  let data = mu & 0x0F;
  let magnitude = (((data << 3) + 132) << exponent) - 132;
  muLawToPcm[i] = sign * magnitude;
}

function pcmToMuLaw(pcm) {
  const MAX = 32635;
  if (pcm > MAX) pcm = MAX;
  if (pcm < -MAX) pcm = -MAX;
  let sign = (pcm < 0) ? 0x80 : 0x00;
  if (pcm < 0) pcm = -pcm;
  pcm += 132;
  if (pcm > 32767) pcm = 32767;
  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  let mantissa = (pcm >> (exponent === 0 ? 1 : exponent + 3)) & 0x0F;
  let mu = ~(sign | (exponent << 4) | mantissa);
  return mu & 0xFF;
}

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
    url: `wss://${req.get('host')}/stream?caller=${encodeURIComponent(callerId)}`,
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

    // Clear the outbound buffer if Gemini detects the user interrupted it
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

    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          const geminiBytes = Buffer.from(part.inlineData.data, 'base64');
          console.log(`[Gemini] Dropped ${geminiBytes.length} bytes of raw audio into the holding tank.`);
          
          const muLawBuffer = Buffer.alloc(Math.floor(geminiBytes.length / 6));
          let outIdx = 0;
          for (let i = 0; i < geminiBytes.length; i += 6) {
            if (outIdx >= muLawBuffer.length) break;
            const pcm16 = geminiBytes.readInt16LE(i);
            muLawBuffer[outIdx++] = pcmToMuLaw(pcm16);
          }

          twilioOutboundBuffer = Buffer.concat([twilioOutboundBuffer, muLawBuffer]);
        }
      }
    }
  });

  geminiWs.on('error', (err) => console.error('Gemini error:', err));

  twilioWs.on('message', (message) => {
    let msg;
    try { msg = JSON.parse(message); } catch (err) { return; }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        break;

      case 'media':
        // 1. Send Twilio's audio up to Gemini
        if (geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
          const twilioBytes = Buffer.from(msg.media.payload, 'base64');
          const pcmBuffer = Buffer.alloc(twilioBytes.length * 4);

          for (let i = 0; i < twilioBytes.length; i++) {
            const pcm16 = muLawToPcm[twilioBytes[i]];
            pcmBuffer.writeInt16LE(pcm16, i * 4);      
            pcmBuffer.writeInt16LE(pcm16, i * 4 + 2);  
          }

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
        }
        
        // 2. THE FIX: Use Twilio's incoming media tick as a perfect 20ms clock to send audio back!
        if (streamSid && twilioOutboundBuffer.length >= 160) {
          const frame = twilioOutboundBuffer.subarray(0, 160);
          twilioOutboundBuffer = twilioOutboundBuffer.subarray(160);
          
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
