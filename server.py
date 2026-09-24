import asyncio
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import gemini, silero

async def entrypoint(ctx: JobContext):
    # Set the AI's personality and instructions
    initial_ctx = llm.ChatContext().append(
        role="system",
        text="You are a helpful voice assistant conversing over a phone call. Keep responses natural, brief, and conversational."
    )
    
    # Connect to the LiveKit SIP audio stream
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Build the Voice Pipeline using Gemini 3.8 Live
    agent = VoicePipelineAgent(
        vad=silero.VAD.load(),
        stt=gemini.STT(),
        llm=gemini.LLM(model="gemini-3.8-live"),
        tts=gemini.TTS(),
        chat_ctx=initial_ctx,
    )

    agent.start(ctx.room)
    await asyncio.sleep(1)
    await agent.say("Hi there. I am connected and ready.", allow_interruptions=True)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
