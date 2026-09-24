import os
import asyncio
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import google, silero

# 1. Map your existing Render variable so the Google plugin can find it
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

# 2. Define tools using LiveKit's native function context
class AssistantFunctions(llm.FunctionContext):
    @llm.ai_callable(description="Get the current weather for a location")
    async def get_weather(self, location: str):
        # Add your wttr.in fetch logic here
        return f"Weather info for {location} is unavailable."

    @llm.ai_callable(description="Save a fact to memory")
    async def save_memory(self, fact: str):
        # Add your Upstash Redis logic here
        return "Fact saved permanently."

async def entrypoint(ctx: JobContext):
    initial_ctx = llm.ChatContext().append(
        role="system",
        text="You are a helpful voice assistant conversing over a phone call. Keep responses natural, brief, and conversational."
    )
    
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # 3. Pass the function context into the Voice Pipeline
    agent = VoicePipelineAgent(
        vad=silero.VAD.load(),
        stt=google.STT(),
        llm=google.LLM(model="gemini-3.8-live"),
        tts=google.TTS(),
        chat_ctx=initial_ctx,
        fnc_ctx=AssistantFunctions(),
    )

    agent.start(ctx.room)
    await asyncio.sleep(1)
    await agent.say("Hi there. I am connected and ready.", allow_interruptions=True)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
