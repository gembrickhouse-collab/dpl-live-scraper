import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, AgentSession, Agent, function_tool, RunContext
from livekit.plugins import google

# 1. Trick Render by opening a dummy web port in the background
def run_dummy_server():
    port = int(os.environ.get("PORT", 10000))
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"LiveKit Agent is running!")
    httpd = HTTPServer(('', port), Handler)
    httpd.serve_forever()

threading.Thread(target=run_dummy_server, daemon=True).start()

# 2. Normal LiveKit logic below
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

class LiveVoiceAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions="You are a helpful voice assistant conversing over a phone call. Keep responses natural, brief, and conversational."
        )

    @function_tool()
    async def get_weather(self, context: RunContext, location: str):
        """Get the current weather for a location."""
        # Add your wttr.in fetch logic here
        return f"Weather info for {location} is unavailable."

    @function_tool()
    async def save_memory(self, context: RunContext, fact: str):
        """Save a fact to memory."""
        # Add your Upstash Redis logic here
        return "Fact saved permanently."

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    session = AgentSession(
        stt=google.STT(),
        llm=google.LLM(model="gemini-3.8-live"),
        tts=google.TTS(),
    )

    await session.start(room=ctx.room, agent=LiveVoiceAgent())
    await session.generate_reply(instructions="Greet the caller and say you are connected and ready.")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
