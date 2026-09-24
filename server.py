import os
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, Agent, AgentSession, function_tool, RunContext
from livekit.plugins import google, deepgram, silero

# Fallback in case DEEPGRAM_API_KEY isn't loaded from Railway Variables
os.environ.setdefault("DEEPGRAM_API_KEY", "2366a2fe2925224723c4d068213e2712f0b3a0be")

# Map your existing variable so the Gemini plugin can find it
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

class LiveVoiceAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions="You are a helpful voice assistant for Keyshawn Bannister Initiatives. Keep your answers concise and conversational."
        )

    @function_tool()
    async def get_weather(self, context: RunContext, location: str):
        """Get the current weather for a location."""
        # Add your wttr.in fetch logic here
        return f"Weather info for {location}"

    @function_tool()
    async def save_memory(self, context: RunContext, fact: str):
        """Save a fact to memory."""
        # Add your Upstash Redis logic here
        return "Fact saved permanently."

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # AgentSession using Silero for VAD, Deepgram for STT/TTS, and Gemini for LLM
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(),
        llm=google.LLM(model="gemini-2.0-flash"),
        tts=deepgram.TTS(),
    )

    # Start the session with your custom agent
    await session.start(room=ctx.room, agent=LiveVoiceAgent())

    # Have the AI speak first as soon as the call connects
    await session.generate_reply(
        instructions="Greet the caller warmly on behalf of Keyshawn Bannister Initiatives and ask how you can help them today."
    )

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
