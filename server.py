import os
import uvicorn
from fastapi import FastAPI, WebSocket
from pipecat.transports.network.fastapi_websocket import FastAPIWebsocketTransport
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.google import GeminiLiveLLMService
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

    # 2. Automatically handle Twilio's exact audio format
    serializer = TwilioFrameSerializer(stream_sid="temp")
    
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketTransport.Params(
            audio_out_enabled=True,
            vad_enabled=True,
        ),
        serializer=serializer
    )

    # 3. Native connection to Gemini 3.8 Live API
    llm = GeminiLiveLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        settings=GeminiLiveLLMService.Settings(
            model="gemini-3.8-live",
            system_instruction="You are a helpful voice assistant.",
        ),
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
            audio_out_sample_rate=8000, 
            allow_interruptions=True
        )
    )
    
    runner = PipelineRunner()
    await runner.run(task)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT",
                                                        3000)))
