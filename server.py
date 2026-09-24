import os
import uvicorn
from fastapi import FastAPI, WebSocket

from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner

app = FastAPI()

# 1. Define tools natively in Python
async def get_weather(location: str):
    # Add your wttr.in fetch logic here
    return f"Weather info for {location} is unavailable."

async def save_memory(fact: str):
    # Add your Upstash Redis logic here
    return "Fact saved permanently."

@app.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # 2. Automatically handle Twilio's exact audio format, disabling the credential-required auto hang-up
    serializer = TwilioFrameSerializer(
        stream_sid="temp",
        auto_hang_up=False
    )
    
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            vad_enabled=True,
            vad_audio_passthrough=True,
            serializer=serializer
        )
    )

    # 3. Native connection to Gemini 3.8 Live API
    llm = GeminiLiveLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        model="gemini-3.8-live",
        system_instruction="You are a helpful voice assistant conversing over a phone call. Keep responses natural, brief, and conversational.",
        tools=[get_weather, save_memory]
    )

    # 4. The Pipeline connects Twilio IN -> Gemini -> Twilio OUT
    pipeline = Pipeline([
        transport.input(),
        llm,
        transport.output(),
    ])

    # 5. Tell the task to run at Twilio's required 8kHz sample rate
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000, 
            allow_interruptions=True
        )
    )
    
    runner = PipelineRunner()
    await runner.run(task)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 3000)))
