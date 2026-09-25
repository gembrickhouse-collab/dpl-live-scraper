import os
import logging
from urllib.parse import quote
import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
    llm,
)
from livekit.plugins import deepgram, google, silero

load_dotenv()

logger = logging.getLogger("keyshawn-voice-agent")
logger.setLevel(logging.INFO)


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.8,
    )


@function_tool
async def get_weather(context: RunContext, location: str) -> str:
    """Get the current weather for a given city or location."""
    try:
        safe_location = quote(location.strip())
        url = f"https://wttr.in/{safe_location}?format=3"
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.get(url)
            if response.status_code == 200 and response.text.strip():
                return response.text.strip()
            return f"Could not retrieve weather for {location} right now."
    except Exception as e:
        logger.warning(f"Weather tool failed: {e}")
        return f"Weather service is temporarily unavailable for {location}."


@function_tool
async def save_memory(context: RunContext, key: str, value: str) -> str:
    """Save an important piece of information or note to persistent memory."""
    redis_url = os.getenv("UPSTASH_REDIS_REST_URL")
    redis_token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
    if not redis_url or not redis_token:
        return "Memory storage is not configured yet."

    try:
        headers = {"Authorization": f"Bearer {redis_token}"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(
                f"{redis_url.rstrip('/')}/set/{quote(key)}/{quote(value)}",
                headers=headers,
            )
            if res.status_code == 200:
                return f"Saved {key} to memory."
            return "Failed to save that note right now."
    except Exception as e:
        logger.warning(f"Redis save_memory failed: {e}")
        return "Memory service is temporarily unreachable."


@function_tool
async def get_memory(context: RunContext, key: str) -> str:
    """Retrieve a previously saved piece of information from persistent memory."""
    redis_url = os.getenv("UPSTASH_REDIS_REST_URL")
    redis_token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
    if not redis_url or not redis_token:
        return "Memory storage is not configured yet."

    try:
        headers = {"Authorization": f"Bearer {redis_token}"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                f"{redis_url.rstrip('/')}/get/{quote(key)}",
                headers=headers,
            )
            if res.status_code == 200:
                data = res.json()
                result = data.get("result")
                return f"Memory for {key}: {result}" if result else f"No saved memory found for {key}."
            return f"Could not look up {key} right now."
    except Exception as e:
        logger.warning(f"Redis get_memory failed: {e}")
        return "Memory service is temporarily unreachable."


class KeyshawnAssistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are the official AI voice assistant for Keyshawn Bannister Initiatives. "
                "You are speaking live on a phone call. Keep all answers concise, warm, and "
                "conversational—ideally one to two short sentences at a time. "
                "Never use markdown, asterisks, bullet points, or emojis, because your text "
                "is read aloud directly by a text-to-speech engine."
            ),
            tools=[get_weather, save_memory, get_memory],
        )


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    logger.info(f"Connected to call room: {ctx.room.name}")

    vad = ctx.proc.userdata.get("vad") or silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.8,
    )

    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

    # Automatically falls back if any model hits a 503 High Demand spike
    fallback_llm = llm.FallbackAdapter(
        [
            google.LLM(model="gemini-3.5-flash-lite", api_key=api_key),
            google.LLM(model="gemini-3.7-flash", api_key=api_key),
            google.LLM(model="gemini-3.8-flash", api_key=api_key),
        ]
    )

    session = AgentSession(
        vad=vad,
        stt=deepgram.STT(),
        llm=fallback_llm,
        tts=deepgram.TTS(),
    )

    await session.start(agent=KeyshawnAssistant(), room=ctx.room)

    try:
        await session.say(
            "Hello, thanks for calling Keyshawn Bannister Initiatives! How can I help you today?"
        )
    except Exception as e:
        logger.error(f"Opening greeting failed: {e}")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        )
    )
