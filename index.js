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

// Helper function to talk directly to Upstash without any extra npm packages
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
    console.error(`Upstash error on ${command}:`, err);
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

  // Retrieve existing caller memories from Upstash via fetch
  let pastMemoriesArray = [];
  try {
    const result = await redisCommand('LRANGE', callerId, '0', '-1');
    if (Array.isArray(result)) pastMemoriesArray = result;
  } catch (err) {
    console.error('Redis memory retrieval error:', err);
  }
  const pastMemories = pastMemoriesArray.length > 0
    ? pastMemoriesArray.join('. ')
    : 'No previous conversations recorded.';

  // Connect to Gemini Live WebSocket
  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
  const geminiWs = new WebSocket(geminiUrl);

  geminiWs.on('open', () => {
    console.log(`Connected to Gemini Live API for ${callerId}`);

    const setupMessage = {
      setup: {
        model: 'models/gemini-2.0-flash-exp',
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

  // Handle messages received from Gemini
  geminiWs.on('message', async (data) => {
    let response;
    try {
      response = JSON.parse(data);
    } catch (err) {
      console.error('Failed to parse Gemini response JSON:', err);
      return;
    }

    if (response.setupComplete) {
      console.log('Gemini Live session ready for audio exchange.');
      isGeminiReady = true;
      return;
    }

    // FUNCTION CALL HANDLING
    if (response.toolCall) {
      const calls = response.toolCall.functionCalls || [];
      const functionResponses = [];

      for (const call of calls) {
        if (call.name === 'save_memory') {
          const fact = call.args.fact;
          try {
            await redisCommand('RPUSH', callerId, fact);
            console.log(`Stored fact for ${callerId}: ${fact}`);
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { status: 'Success. Fact saved permanently.' }
            });
          } catch (err) {
            console.error('Redis save failure:', err);
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { error: 'Failed to write to database.' }
            });
          }
        } else if (call.name === 'get_weather') {
          const location = call.args.location;
          let forecast = `Weather information for ${location} is currently unavailable.`;
          try {
            const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=%C,+%t+(Feels+like+%f),+Wind:+%w`);
            if (res.ok) {
              const text = await res.text();
              forecast = `Current conditions for ${location}: ${text.trim()}`;
            }
          } catch (err) {
            console.error('Weather fetch failure:', err);
          }

          functionResponses.push({
            id: call.id,
            name: call.name,
            response: { forecast }
          });
        }
      }

      geminiWs.send(JSON.stringify({
        toolResponse: { functionResponses }
      }));
      return;
    }

    // AUDIO OUTPUT (Gemini -> Twilio)
    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          try {
            const wav = new WaveFile();
            wav.fromScratch(1, 24000, '16', Buffer.from(part.inlineData.data, 'base64'));
            wav.toSampleRate(8000);
            wav.toMuLaw();

            const twilioPayload = Buffer.from(wav.data.samples).toString('base64');

            if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: twilioPayload }
              }));
            }
          } catch (err) {
            console.error('Gemini -> Twilio audio transcoding error:', err);
          }
        }
      }
    }
  });

  geminiWs.on('error', (err) => {
    console.error('Gemini WebSocket error:', err);
  });

  // AUDIO INPUT (Twilio -> Gemini)
  twilioWs.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (err) {
      return;
    }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        console.log(`Stream active: ${streamSid}`);
        break;

      case 'media':
        if (geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
          try {
            const wav = new WaveFile();
            wav.fromScratch(1, 8000, '8m', Buffer.from(msg.media.payload, 'base64'));
            wav.fromMuLaw();
            wav.toSampleRate(16000);

            const pcmData = new Int16Array(wav.data.samples);
            const geminiPayload = Buffer.from(pcmData.buffer).toString('base64');

            geminiWs.send(JSON.stringify({
              realtimeInput: {
                mediaChunks: [{
                  mimeType: 'audio/pcm;rate=16000',
                  data: geminiPayload
                }]
              }
            }));
          } catch (err) {
            console.error('Twilio -> Gemini audio transcoding error:', err);
          }
        }
        break;

      case 'stop':
        console.log(`Call ended: ${streamSid}`);
        if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
        break;
    }
  });

  twilioWs.on('close', () => {
    if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
  });

  geminiWs.on('close', (code, reason) => {
    console.log(`Gemini session closed. Code: ${code}, Reason: ${reason}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice server active on port ${PORT}`);
});
