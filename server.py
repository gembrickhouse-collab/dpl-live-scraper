import os
import httpx
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    Agent,
    AgentSession,
    function_tool,
    RunContext,
)
from livekit.plugins import google, deepgram, silero, openai

# Map your existing variable so the Gemini plugin can find it
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]


# 1. PREWARM FIX: Load VAD into RAM at container startup so the first ring is instant
def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


class LiveVoiceAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=(
                "You are a helpful voice assistant for Keyshawn Bannister Initiatives. "
                "Keep your answers concise, warm, and conversational."
            )
        )

    # 2. ASYNC WEATHER FIX: Uses httpx.AsyncClient so audio never stutters or blocks
    @function_tool()
    async def get_weather(self, context: RunContext, location: str):
        """Get the current weather for a location."""
        url = f"https://wttr.in/{location}?format=%C+%t"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    return f"The current weather in {location} is {response.text.strip()}."
        except Exception:
            pass
        return f"Unable to fetch live weather for {location} right now."

    # 3. ASYNC MEMORY FIX: Non-blocking Upstash Redis REST call (with safe fallback)
    @function_tool()
    async def save_memory(self, context: RunContext, fact: str):
        """Save an important fact or caller detail to memory."""
        redis_url = os.environ.get("UPSTASH_REDIS_REST_URL")
        redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")

        if redis_url and redis_token:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(
                        f"{redis_url}/lpush/agent_memories",
                        headers={"Authorization": f"Bearer {redis_token}"},
                        json=[fact],
                    )
                    return "Fact saved permanently to memory."
            except Exception:
                return "Noted for this call, though permanent database storage timed out."
        return f"Noted in session memory: {fact}"


async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Pull pre-loaded Silero VAD from RAM (or load as fallback)
    vad_instance = ctx.proc.userdata.get("vad") or silero.VAD.load()

    # 4. RATE-LIMIT FALLBACK: Uses OpenAI if OPENAI_API_KEY is added to Railway, else Gemini
    if os.environ.get("OPENAI_API_KEY"):
        llm_engine = openai.LLM(model="gpt-4o-mini")
    else:
        llm_engine = google.LLM(model="gemini-2.0-flash")

    session = AgentSession(
        vad=vad_instance,
        stt=deepgram.STT(),
        llm=llm_engine,
        tts=deepgram.TTS(),
    )

    await session.start(room=ctx.room, agent=LiveVoiceAgent())

    # Speak first immediately when the call connects
    await session.generate_reply(
        instructions="Greet the caller warmly on behalf of Keyshawn Bannister Initiatives and ask how you can help them today."
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        )
    )
