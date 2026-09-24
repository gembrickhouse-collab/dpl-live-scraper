import os
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, Agent, AgentSession, function_tool
from livekit.plugins import google, deepgram

# Map your existing Render variable so the Gemini plugin can find it
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

class LiveVoiceAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions="You are a helpful voice assistant for Keyshawn Bannister Initiatives."
        )

    @function_tool()
    async def get_weather(self, context, location: str):
        """Get the current weather for a location."""
        # Add your wttr.in fetch logic here
        return f"Weather info for {location}"

    @function_tool()
    async def save_memory(self, context):
        """Save a fact to memory."""
        # Add your Upstash Redis logic here
        return "Fact saved permanently."

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # AgentSession handles VAD, STT, LLM, and TTS
    session = AgentSession(
        stt=deepgram.STT(),
        llm=google.LLM(model="gemini-3.8-live"),
        tts=deepgram.TTS(),
    )

    # Start the session with your custom agent
    await session.start(room=ctx.room, agent=LiveVoiceAgent())

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
