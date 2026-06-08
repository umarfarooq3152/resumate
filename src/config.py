from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Safety
    dry_run: bool = Field(default=True)

    # Supabase
    supabase_url: str = Field(default="")
    supabase_service_key: str = Field(default="")
    supabase_anon_key: str = Field(default="")    # used by frontend / Storage

    # Gemini
    gemini_api_key: str = Field(default="")
    gemini_model: str = Field(default="gemini-2.5-flash")

    # Adzuna
    adzuna_app_id: str = Field(default="")
    adzuna_app_key: str = Field(default="")
    adzuna_country: str = Field(default="gb")
    adzuna_max_results: int = Field(default=50)

    # Groq (fallback LLM for text generation when Gemini is unavailable)
    groq_api_key: str = Field(default="")
    groq_api_key_2: str = Field(default="")   # secondary key, used when primary hits rate limit
    groq_model: str = Field(default="llama-3.3-70b-versatile")

    # Rate limiting
    rate_limit_delay: float = Field(default=2.0)

    # WhatsApp local sidecar (whatsapp-web.js — no Twilio needed)
    whatsapp_service_url: str = Field(default="http://localhost:3001")

    # Gmail OAuth2 (for reading + sending emails)
    gmail_client_id: str = Field(default="")
    gmail_client_secret: str = Field(default="")
    gmail_redirect_uri: str = Field(default="http://localhost:8000/auth/gmail/callback")

    # Hunter.io (HR email discovery — 25 free searches/month)
    hunter_api_key: str = Field(default="")

    # Base URL for OAuth callbacks (override in production)
    app_base_url: str = Field(default="http://localhost:3000")
    api_base_url: str = Field(default="http://localhost:8000")

    # Kept for backwards compat (ignored)
    anthropic_api_key: str = Field(default="")
    anthropic_model: str = Field(default="")

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key)

    # Legacy alias used by /health
    @property
    def anthropic_configured(self) -> bool:
        return self.gemini_configured

    @property
    def adzuna_configured(self) -> bool:
        return bool(self.adzuna_app_id and self.adzuna_app_key)

    @property
    def whatsapp_configured(self) -> bool:
        """True when the local Node.js sidecar URL is set (it's always set by default)."""
        return bool(self.whatsapp_service_url)

    @property
    def groq_configured(self) -> bool:
        return bool(self.groq_api_key)

    @property
    def gmail_configured(self) -> bool:
        return bool(self.gmail_client_id and self.gmail_client_secret)


settings = Settings()
